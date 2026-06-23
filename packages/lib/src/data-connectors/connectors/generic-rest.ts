// packages/lib/src/data-connectors/connectors/generic-rest.ts
// No-code HTTP connector. Reads DataConnector.config.endpoint (baseUrl + auth +
// pagination) and DataConnectorStream.requestConfig (path/method/params/body/
// pagination), fetches, paginates, and yields the RAW response body per page as
// the connector payload — the source schema mirrors the live response, and the
// root mapping's `rootPath` (e.g. `[]` / `data.orders[]`) selects the records.
// The bound credential arrives already resolved + refreshed by the orchestrator
// (resolveConnectionForRuntime) and carries the definition's `authApply` spec;
// this connector sends each page through the shared HTTP transport, which applies
// the auth, sends the request, and normalizes the response.

import { createScopedLogger } from '@auxx/logger'
import { httpTransport } from '../../connections/transports'
import type { RateLimitPolicy } from '../../connections/transports/types'
import type { SyncCursor } from '../../sync-core/contracts'
import { maxWatermark } from '../watermark'
import {
  type ConnectorFetchArgs,
  ConnectorRateLimitError,
  type ConnectorYield,
  type DataConnectorDefinition,
  type FetchResult,
  type PaginationSpec,
  type StreamIncrementalConfig,
  type StreamRequestConfig,
} from './types'

const logger = createScopedLogger('data-connector-generic-rest')

/** Walk a dotted JSON path (`a.b.c`) into a value; '' / undefined → the root. */
function getByPath(obj: unknown, path?: string): unknown {
  if (!path) return obj
  let cur: unknown = obj
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/**
 * Best-effort record count in a payload — the first array found (depth-first),
 * or 1 for a lone object. Used only to detect an empty page for page/offset
 * pagination (which can't self-terminate the way cursor/link-header does); the
 * mapping's `rootPath` is the authoritative records selector at sync time.
 */
function countRecords(body: unknown, depth = 0): number {
  if (Array.isArray(body)) return body.length
  if (body && typeof body === 'object' && depth < 4) {
    for (const v of Object.values(body as Record<string, unknown>)) {
      if (Array.isArray(v)) return v.length
    }
    for (const v of Object.values(body as Record<string, unknown>)) {
      const n = countRecords(v, depth + 1)
      if (n > 0) return n
    }
  }
  return body === null || body === undefined ? 0 : 1
}

/**
 * Best-effort records array in a payload — the first array found (depth-first),
 * mirroring `countRecords`. Used only to extract the steady-mode watermark; the
 * mapping's `rootPath` remains the authoritative records selector for the sink.
 */
function findRecords(body: unknown, depth = 0): unknown[] {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object' && depth < 4) {
    for (const v of Object.values(body as Record<string, unknown>)) {
      if (Array.isArray(v)) return v
    }
    for (const v of Object.values(body as Record<string, unknown>)) {
      const found = findRecords(v, depth + 1)
      if (found.length > 0) return found
    }
  }
  return []
}

/**
 * The max `watermarkField` value across a page's records (G2). Tracked over ALL
 * records — BEFORE any content-hash skip downstream — so a page of all-unchanged
 * records still advances the watermark instead of re-fetching the same window forever.
 */
function pageWatermark(
  body: unknown,
  incremental: StreamIncrementalConfig | undefined
): string | undefined {
  if (!incremental?.watermarkField) return undefined
  let max: string | undefined
  for (const rec of findRecords(body)) {
    const val = getByPath(rec, incremental.watermarkField)
    if (val === undefined || val === null) continue
    max = maxWatermark(max, String(val))
  }
  return max
}

/** True when `value` is a full URL (carries its own scheme), not a relative path. */
function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}

/**
 * Build a URL from a connector baseUrl + a stream path. The path is normally
 * relative and joined onto baseUrl, but a full same-origin URL is also accepted
 * (handy when pasting straight from API docs). A cross-origin absolute URL is
 * rejected so a stray host can't receive the connector's credentials.
 */
function buildUrl(baseUrl: string, path: string, params?: Record<string, unknown>): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  let url: URL
  if (isAbsoluteUrl(path)) {
    url = new URL(path)
    if (url.origin !== new URL(base).origin) {
      throw new Error(
        `generic-rest: stream path "${path}" targets ${url.origin}, which differs from the connector base URL ${new URL(base).origin}. Use a relative path or a same-origin URL.`
      )
    }
  } else {
    url = new URL(path.replace(/^\//, ''), base)
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) to ms; undefined if absent. */
function parseRetryAfterMs(value: string | undefined): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const when = Date.parse(value)
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now())
  return undefined
}

/** Merge a per-call rate-limit override (the sliced source's `maxRetries: 0`) onto the policy. */
function mergeRateLimit(
  base: RateLimitPolicy | undefined,
  override: Partial<RateLimitPolicy> | undefined
): RateLimitPolicy | undefined {
  if (!base && !override) return undefined
  return { ...base, ...override }
}

/**
 * Seed the pagination loop from a durable resume cursor (the sliced backfill's
 * `state.backfillCursor`). Page/offset kinds restore the page index; token and
 * header-locator kinds restore the cursor string. Absent ⇒ start from the top.
 */
function seedFromCursor(resume: SyncCursor | undefined): { cursor?: string; pageIndex: number } {
  if (!resume) return { pageIndex: 0 }
  if (resume.kind === 'pageNumber' || resume.kind === 'offset') {
    return { pageIndex: Number(resume.value) || 0 }
  }
  return { cursor: resume.value, pageIndex: 0 }
}

/** Encode the next-page locator as a structured, kind-tagged `SyncCursor` (H6). */
function toSyncCursor(
  pagination: PaginationSpec | undefined,
  nextToken: string,
  pageIndex: number
): SyncCursor {
  switch (pagination?.kind) {
    case 'page':
      return { kind: 'pageNumber', value: String(pageIndex) }
    case 'offset':
      return { kind: 'offset', value: String(pageIndex) }
    case 'link-header':
      return { kind: 'headerLocator', value: nextToken }
    default:
      return { kind: 'token', value: nextToken }
  }
}

/** Extract the next-page token from a response per the pagination spec. */
function nextPageToken(
  pagination: PaginationSpec | undefined,
  body: unknown,
  headers: Record<string, string>,
  pageIndex: number
): string | undefined {
  if (!pagination || pagination.kind === 'none') return undefined
  switch (pagination.kind) {
    case 'cursor':
      return getByPath(body, pagination.cursorPath) as string | undefined
    case 'link-header': {
      const link = headers.link ?? ''
      const match = link.match(/<([^>]+)>;\s*rel="next"/)
      return match?.[1]
    }
    case 'page':
    case 'offset':
      // Caller advances the page/offset counter; signal "there may be more" only
      // if the last page was full. Without a total this is best-effort.
      return String(pageIndex + 1)
    default:
      return undefined
  }
}

/**
 * Stream one stream's records, paginating until exhausted or the spec stops.
 * Never buffers the whole result — each page's raw body is yielded as a record,
 * followed by a {@link ConnectorCheckpoint} carrying the resume cursor for the next
 * page. A sliced `SyncSource` reads those checkpoints to bound + checkpoint a slice
 * and abandons the generator at its budget; the next slice re-enters here with the
 * saved cursor (`state.backfillCursor`). Single-shot consumers ignore checkpoints
 * and drain to exhaustion.
 */
async function* fetchRecords(args: ConnectorFetchArgs): AsyncIterable<ConnectorYield> {
  const endpoint = args.config.endpoint
  // The base URL comes from the bound connection's `baseUrlTemplate` (resolved into
  // `credential.baseUrl`, e.g. Shopify `{shop}`) when present, else the connector's
  // own configured base URL.
  const baseUrl = args.credential?.baseUrl ?? endpoint?.baseUrl
  if (!baseUrl) {
    throw new Error(
      'generic-rest: a base URL is required (config.endpoint.baseUrl or a connection baseUrlTemplate)'
    )
  }
  const request: StreamRequestConfig = args.requestConfig ?? {}
  const pagination = request.pagination ?? endpoint?.pagination
  const method = request.method ?? 'GET'
  const path = request.path ?? ''
  const rateLimit = mergeRateLimit(endpoint?.rateLimit, args.rateLimitOverride)
  const incremental = request.incremental

  // Running max watermark, seeded from the persisted floor so it stays monotonic
  // across slices. Always tracked when an `incremental` config is present — even
  // during backfill — so the watermark is primed when the stream flips to steady.
  let watermark = incremental ? args.state.watermark : undefined

  // Precedence (low → high): Accept < connector-level shared headers < per-stream
  // headers < credential auth (applied last by the HTTP transport).
  const baseHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(endpoint?.headers ?? {}),
    ...(request.headers ?? {}),
  }
  const applyCredential = endpoint?.auth !== 'none' && args.credential ? args.credential : null

  // Resume mid-pagination from the durable backfill cursor during a BACKFILL
  // (snapshot) run only; a steady (incremental) run starts fresh pagination each
  // time, narrowed by the `sinceParam` watermark filter below — so a leftover
  // backfill cursor never strands a steady delta window.
  const seed =
    args.mode === 'snapshot' ? seedFromCursor(args.state.backfillCursor) : { pageIndex: 0 }
  let cursor: string | undefined =
    seed.cursor ?? (args.mode === 'incremental' ? args.state.cursor : undefined)
  let pageIndex = seed.pageIndex
  const maxPages = 10_000 // hard ceiling — bounds a runaway pagination loop within one fetch()

  for (let fetched = 0; fetched < maxPages; fetched++) {
    const params: Record<string, unknown> = { ...(request.params ?? {}) }
    if (cursor !== undefined && pagination?.cursorParam) {
      params[pagination.cursorParam] = cursor
    }
    if (pagination?.kind === 'page' && pagination.pageParam) {
      params[pagination.pageParam] = pageIndex + 1
    }
    if (pagination?.kind === 'offset' && pagination.pageParam) {
      params[pagination.pageParam] = pageIndex * (pagination.pageSize ?? 0)
    }
    if (pagination?.limitParam && pagination.pageSize) {
      params[pagination.limitParam] = pagination.pageSize
    }
    // Steady-mode delta floor — inject `sinceParam = watermark` only on an
    // incremental (steady) run with a watermark; backfill crawls the full range.
    if (incremental && args.mode === 'incremental' && args.state.watermark) {
      params[incremental.sinceParam] = args.state.watermark
    }

    const url =
      pagination?.kind === 'link-header' && cursor ? cursor : buildUrl(baseUrl, path, params)

    // The HTTP transport applies the resolved connection's declarative auth
    // (header/basic/query), sends the request, handles rate limits (429 +
    // Retry-After / Shopify-GraphQL throttle / backoff), and normalizes the response.
    const response = await httpTransport.request(applyCredential, {
      method,
      url,
      headers: baseHeaders,
      body: method === 'POST' ? request.body : undefined,
      rateLimit,
    })

    // H1: a throttle the transport did NOT sleep through (the sliced source sets
    // `maxRetries: 0`) surfaces as a 429/503. Throw the typed rate-limit error so
    // the source yields the slice instead of blocking the worker lock; the
    // single-shot path (default retries) only lands here after exhausting them.
    if (response.status === 429 || response.status === 503) {
      throw new ConnectorRateLimitError(
        `generic-rest: ${method} ${url} → ${response.status} (throttled)`,
        parseRetryAfterMs(response.headers['retry-after'])
      )
    }
    if (!response.ok) {
      throw new Error(`generic-rest: ${method} ${url} → ${response.status}`)
    }
    const body = response.json()

    // Advance the watermark over this page's records (before any content-hash skip).
    watermark = maxWatermark(watermark, pageWatermark(body, incremental))

    // Yield the raw response body as the payload — the mapping layer selects
    // records via the root mapping's rootPath and fans out. No envelope stripping.
    yield { streamKey: args.streamKey, fields: body }

    const next = nextPageToken(pagination, body, response.headers, pageIndex)
    // Stop when there's no next token, or a page/offset run returned an empty page.
    if (
      !next ||
      (countRecords(body) === 0 && (pagination?.kind === 'page' || pagination?.kind === 'offset'))
    ) {
      // Final checkpoint with no cursor ⇒ this phase is exhausted. Carry the watermark.
      yield { __checkpoint: true, watermark }
      return
    }
    cursor = next
    pageIndex += 1
    // Checkpoint the resume cursor for the next page (the slice boundary).
    yield { __checkpoint: true, cursor: toSyncCursor(pagination, next, pageIndex), watermark }
  }
}

/**
 * The generic-REST connector. Schema is `inferred` from a sample fetch; the
 * request is fully described by `config.endpoint` + per-stream `requestConfig`.
 */
export const genericRestConnector: DataConnectorDefinition = {
  type: 'generic-rest',
  schemaVersion: 1,
  requestModel: 'builder',
  streams: [],

  async fetch(args: ConnectorFetchArgs): Promise<FetchResult> {
    logger.debug('generic-rest fetch', { streamKey: args.streamKey, mode: args.mode })
    // The records iterable is lazy and emits resume checkpoints between pages. The
    // sliced `SyncSource` persists those checkpoints via the `SyncStateStore`; the
    // legacy single-shot path drains to exhaustion and persists `nextState` once at
    // the end (a terminal `backfillComplete`, no mid-stream cursor).
    return {
      records: fetchRecords(args),
      nextState: { ...args.state, backfillComplete: true },
    }
  },
}
