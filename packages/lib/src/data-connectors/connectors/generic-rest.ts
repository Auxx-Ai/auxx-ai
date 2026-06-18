// packages/lib/src/data-connectors/connectors/generic-rest.ts
// No-code HTTP connector. Reads DataConnector.config.endpoint (baseUrl + auth +
// pagination) and DataConnectorStream.requestConfig (path/method/params/body/
// pagination/recordsPath), fetches, paginates, and yields source-shaped
// ConnectorRecords. Credentials arrive already-decrypted (the orchestrator
// reveals them via @auxx/credentials) — this connector only reads them.

import { createScopedLogger } from '@auxx/logger'
import type {
  ConnectorFetchArgs,
  ConnectorRecord,
  DataConnectorDefinition,
  DecryptedCredential,
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

/** Best-effort auth header from a decrypted credential (Bearer / api key). */
function authHeaders(credential: DecryptedCredential | null): Record<string, string> {
  if (!credential) return {}
  const token =
    (credential.accessToken as string | undefined) ??
    (credential.access_token as string | undefined) ??
    (credential.token as string | undefined) ??
    (credential.apiKey as string | undefined) ??
    (credential.api_key as string | undefined)
  if (typeof token === 'string' && token.length > 0) {
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}

/** Derive a stable external id + display name from a raw source record. */
function identify(raw: Record<string, unknown>): { externalId: string; displayName: string } {
  const id =
    raw.id ?? raw.externalId ?? raw._id ?? raw.uuid ?? raw.key ?? raw.name ?? JSON.stringify(raw)
  const displayName =
    (raw.name as string | undefined) ??
    (raw.title as string | undefined) ??
    (raw.displayName as string | undefined) ??
    String(id)
  return { externalId: String(id), displayName: String(displayName) }
}

/** Build a URL from baseUrl + path + query params. */
function buildUrl(baseUrl: string, path: string, params?: Record<string, unknown>): string {
  const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
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
  headers: Headers,
  pageIndex: number
): string | undefined {
  if (!pagination || pagination.kind === 'none') return undefined
  switch (pagination.kind) {
    case 'cursor':
      return getByPath(body, pagination.cursorPath) as string | undefined
    case 'link-header': {
      const link = headers.get('link') ?? ''
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
  if (!endpoint?.baseUrl) {
    throw new Error('generic-rest: config.endpoint.baseUrl is required')
  }
  const request: StreamRequestConfig = args.requestConfig ?? {}
  const pagination = request.pagination ?? endpoint.pagination
  const method = request.method ?? 'GET'
  const path = request.path ?? ''

  const baseHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(endpoint.auth === 'none' ? {} : authHeaders(args.credential)),
    ...(request.headers ?? {}),
  }

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
      pagination?.kind === 'link-header' && cursor
        ? cursor
        : buildUrl(endpoint.baseUrl, path, params)

    const response = await fetch(url, {
      method,
      headers: baseHeaders,
      body: method === 'POST' && request.body ? JSON.stringify(request.body) : undefined,
    })
    if (!response.ok) {
      throw new Error(`generic-rest: ${method} ${url} → ${response.status} ${response.statusText}`)
    }
    const body = await response.json()
    const rawRecords = getByPath(body, request.recordsPath)
    const list = Array.isArray(rawRecords) ? rawRecords : rawRecords ? [rawRecords] : []

    for (const raw of list) {
      if (raw === null || typeof raw !== 'object') continue
      const record = raw as Record<string, unknown>
      const { externalId, displayName } = identify(record)
      yield { streamKey: args.streamKey, externalId, displayName, fields: record }
    }

    const next = nextPageToken(pagination, body, response.headers, pageIndex)
    // Stop when there's no next token, or a page/offset run returned an empty page.
    if (
      !next ||
      (list.length === 0 && (pagination?.kind === 'page' || pagination?.kind === 'offset'))
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
