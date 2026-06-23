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
import type {
  ConnectorFetchArgs,
  ConnectorRecord,
  DataConnectorDefinition,
  FetchResult,
  PaginationSpec,
  StreamRequestConfig,
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
 * Never buffers the whole result — each page is yielded as it arrives.
 */
async function* fetchRecords(args: ConnectorFetchArgs): AsyncIterable<ConnectorRecord> {
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

  // Precedence (low → high): Accept < connector-level shared headers < per-stream
  // headers < credential auth (applied last by the HTTP transport).
  const baseHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(endpoint?.headers ?? {}),
    ...(request.headers ?? {}),
  }
  const applyCredential = endpoint?.auth !== 'none' && args.credential ? args.credential : null

  let pageIndex = 0
  let cursor: string | undefined = args.mode === 'incremental' ? args.state.cursor : undefined
  const maxPages = 10_000 // hard ceiling — bounds a runaway pagination loop

  while (pageIndex < maxPages) {
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
      rateLimit: endpoint?.rateLimit,
    })
    if (!response.ok) {
      throw new Error(`generic-rest: ${method} ${url} → ${response.status}`)
    }
    const body = response.json()

    // Yield the raw response body as the payload — the mapping layer selects
    // records via the root mapping's rootPath and fans out. No envelope stripping.
    yield { streamKey: args.streamKey, fields: body }

    const next = nextPageToken(pagination, body, response.headers, pageIndex)
    // Stop when there's no next token, or a page/offset run returned an empty page.
    if (
      !next ||
      (countRecords(body) === 0 && (pagination?.kind === 'page' || pagination?.kind === 'offset'))
    ) {
      break
    }
    cursor = next
    pageIndex += 1
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
    // The records iterable is lazy; the cursor is advanced inside the iterator,
    // but the engine persists `nextState` after the stream completes. We expose
    // the prior cursor here and let the sink-side run capture the final state via
    // the connector's own bookkeeping if it needs delta resumes. For v1 generic
    // sources are snapshot-first, so a no-op next cursor is correct.
    return {
      records: fetchRecords(args),
      nextState: { ...args.state, backfillComplete: true },
    }
  },
}
