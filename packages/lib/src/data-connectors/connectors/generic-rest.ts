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
 * The page's record array per the pagination spec: `recordsPath` when declared
 * (Stripe `data`, HubSpot `results`), else best-effort auto-find. Used to read the
 * last record (`lastRecord` cursor) and detect an empty page.
 */
function selectRecords(body: unknown, recordsPath?: string): unknown[] {
  if (recordsPath) {
    const at = getByPath(body, recordsPath)
    return Array.isArray(at) ? at : []
  }
  return findRecords(body)
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

/** Normalize a stream/object key for loose match (lowercase, drop a trailing plural `s`). */
function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/s$/, '')
}

/**
 * Expand one event-feed page (Step 8D) into per-event records. Each event is mapped
 * to its embedded object (`objectPath`, default `data.object`); an event whose type is
 * in `deleteEventTypes` becomes a tombstone (`deleted: true`) the sink archives. Events
 * are filtered to this stream — Stripe's `/v1/events` is a single firehose carrying
 * every object type, so we keep only objects whose `object` matches the stream key.
 */
function expandEventFeed(
  body: unknown,
  streamKey: string,
  incremental: StreamIncrementalConfig
): ConnectorYield[] {
  const out: ConnectorYield[] = []
  const wantKey = normalizeKey(streamKey)
  for (const event of findRecords(body)) {
    const type = String(getByPath(event, incremental.eventTypePath ?? 'type') ?? '')
    if (!type) continue
    const object = getByPath(event, incremental.objectPath ?? 'data.object')
    if (!object || typeof object !== 'object') continue
    // Keep only this stream's object type when the object self-identifies (Stripe).
    const objectKind = getByPath(object, 'object')
    if (typeof objectKind === 'string' && normalizeKey(objectKind) !== wantKey) continue
    const deleted = incremental.deleteEventTypes?.includes(type) ?? false
    out.push({ streamKey, fields: object, deleted })
  }
  return out
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
      // cursor / next-url both resume from the token (body cursor, last-record id,
      // or a verbatim next URL) on the next slice.
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
    case 'cursor': {
      // Stripe-style: the next cursor is a field of the LAST record on the page,
      // not a fixed body path. Empty page ⇒ no last record ⇒ stop.
      if (pagination.cursorFrom === 'lastRecord') {
        const records = selectRecords(body, pagination.recordsPath)
        const last = records[records.length - 1]
        const value = getByPath(last, pagination.cursorRecordField)
        return value === undefined || value === null ? undefined : String(value)
      }
      return getByPath(body, pagination.cursorPath) as string | undefined
    }
    case 'next-url':
      // Server hands back a full next-page URL in the body (Salesforce
      // `nextRecordsUrl`); absent ⇒ exhausted.
      return getByPath(body, pagination.nextUrlPath) as string | undefined
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
  const incremental = request.incremental
  // Event-feed steady mode (Step 8D): a steady run polls the provider's event log
  // (Stripe `/v1/events`) instead of the list endpoint, so it sees updates AND
  // deletes. Backfill still crawls the normal list endpoint (full snapshot).
  const eventFeed = incremental?.kind === 'event-feed' && args.mode === 'incremental'
  const path = eventFeed ? (incremental?.eventsPath ?? request.path ?? '') : (request.path ?? '')
  const rateLimit = mergeRateLimit(endpoint?.rateLimit, args.rateLimitOverride)

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
      // offsetBase shifts the first page's offset (QuickBooks STARTPOSITION is 1-based).
      params[pagination.pageParam] =
        (pagination.offsetBase ?? 0) + pageIndex * (pagination.pageSize ?? 0)
    }
    if (pagination?.limitParam && pagination.pageSize) {
      params[pagination.limitParam] = pagination.pageSize
    }
    // Steady-mode delta floor — inject `sinceParam = watermark` only on an
    // incremental (steady) run with a watermark; backfill crawls the full range.
    if (incremental && args.mode === 'incremental' && args.state.watermark) {
      params[incremental.sinceParam] = args.state.watermark
    }
    // Backfill-window floor (Step 9 §1.2) — inject the pinned floor on EVERY page of a
    // snapshot run. `params` is rebuilt per page, and page/offset/cursor pagination
    // re-sends filters every request, so this must not be first-page-only. For
    // next-url/link-header the url-selection below GETs the server URL verbatim and
    // ignores `params`, so the floor (baked into that URL) is applied page 1 only —
    // exactly right. The pinned floor is stable across the whole chain (no drift).
    if (request.backfillWindow && args.mode === 'snapshot' && args.state.backfillFloor) {
      params[request.backfillWindow.sinceParam] = args.state.backfillFloor
    }

    // link-header hands back an absolute next URL (GET as-is); next-url hands back
    // a body URL that is often relative (Salesforce `nextRecordsUrl`) — join it onto
    // the base origin and GET it verbatim, without re-appending our paging params.
    let url: string
    if (pagination?.kind === 'link-header' && cursor) {
      url = cursor
    } else if (pagination?.kind === 'next-url' && cursor) {
      url = buildUrl(baseUrl, cursor)
    } else {
      url = buildUrl(baseUrl, path, params)
    }

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
    // For event-feed the watermark field is the EVENT's `created`, found the same way.
    watermark = maxWatermark(watermark, pageWatermark(body, incremental))

    if (eventFeed && incremental) {
      // Expand the event page into per-object records (upserts + delete tombstones).
      for (const record of expandEventFeed(body, args.streamKey, incremental)) yield record
    } else {
      // Yield the raw response body as the payload — the mapping layer selects
      // records via the root mapping's rootPath and fans out. No envelope stripping.
      yield { streamKey: args.streamKey, fields: body }
    }

    const next = nextPageToken(pagination, body, response.headers, pageIndex)
    // An explicit `has_more: false` terminates regardless of token presence
    // (Stripe/Notion); when absent we fall back to token/empty-page detection.
    const hasMore = pagination?.hasMorePath
      ? Boolean(getByPath(body, pagination.hasMorePath))
      : undefined
    // Stop when has_more says so, there's no next token, or a page/offset run
    // returned an empty page.
    if (
      hasMore === false ||
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
