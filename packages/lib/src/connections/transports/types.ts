// packages/lib/src/connections/transports/types.ts
// The transport seam: one runtime client per connection transport (http, postgres,
// imap, smtp). Consumers (data-connectors, workflow nodes, agent tools) bind a
// resolved connection and invoke transport operations instead of re-implementing
// auth + the wire call. Only the HTTP transport is implemented today; the rest are
// scaffolded so future consumers can be written against a stable signature.

import type { RuntimeConnectionData } from '../resolve-connection-for-runtime'

/** The transport a connection speaks. Mirrors the connection's transport class. */
export type TransportKind = 'http' | 'postgres' | 'imap' | 'smtp'

/** A transport binds a resolved connection and exposes its native operations. */
export interface Transport<Kind extends TransportKind = TransportKind> {
  kind: Kind
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

/** A transport-level HTTP request. The transport applies the connection's auth,
 *  assembles the URL + query, encodes the body, and sends it. */
export interface HttpRequest {
  method: HttpMethod
  /** Absolute URL (query params may be supplied separately via `query`). */
  url: string
  headers?: Record<string, string>
  /** Appended to the URL's query string. */
  query?: Record<string, string>
  /** Strings / URLSearchParams / FormData / binary pass through verbatim; plain
   *  objects are JSON-encoded and default a `application/json` Content-Type. */
  body?: unknown
  /** Per-request timeout. Defaults to 30s. */
  timeoutMs?: number
}

/** A normalized HTTP response. Returned for ANY completed exchange — a 4xx/5xx is
 *  `ok: false`, not a throw; only a network/transport failure throws. */
export interface HttpResponse {
  status: number
  ok: boolean
  /** Header names lowercased (HTTP headers are case-insensitive). */
  headers: Record<string, string>
  /** The raw response body as text. */
  body: string
  /** Parse `body` as JSON (cached). Throws only on invalid JSON, only when called. */
  json<T = unknown>(): T
}

export interface HttpTransport extends Transport<'http'> {
  /** Apply the connection's auth (`null` = none) and send. */
  request(conn: RuntimeConnectionData | null, req: HttpRequest): Promise<HttpResponse>
}

// ── SQL (scaffold — interface locked, impl lands with its consumer) ─────────────

export interface SqlRow {
  [column: string]: unknown
}

export interface SqlTransport extends Transport<'postgres'> {
  /** Open from `conn.fields` (host/port/user/password/db), run, close. */
  query(conn: RuntimeConnectionData, sql: string, params?: unknown[]): Promise<{ rows: SqlRow[] }>
}
