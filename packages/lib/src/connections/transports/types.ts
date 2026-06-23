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

/**
 * Rate-limit handling for a request (G3). The transport ALWAYS honors a `429` +
 * `Retry-After` (the universal case); this policy adds the provider-specific
 * shapes a stateless transport can't infer from the status alone:
 *
 *  - `retry-after`   — `429`/`503` + `Retry-After: <secs|date>`. Sleep it, retry
 *                      (Shopify REST, GitHub). This is also the default.
 *  - `graphql-cost`  — throttling arrives as an **HTTP 200** whose body carries a
 *                      `Throttled` error + `extensions.cost.throttleStatus`. The
 *                      transport must inspect the body, compute the cost-restore
 *                      wait, and retry (Shopify GraphQL).
 *  - `backoff-jitter`— `429` with **no** `Retry-After`; exponential backoff with
 *                      jitter (Stripe's explicit recommendation).
 *
 * Scope: this handles a throttle the SERVER signals on a given request (retry THIS
 * request after N). Speculative pacing off a usage gauge (e.g. Shopify's
 * shop-global `X-Shopify-Shop-Api-Call-Limit`) is cross-request coordination that
 * needs shared per-connection state, so it lives in the throttle layer
 * (`UniversalThrottler` keyed by connection), not in this stateless transport.
 */
export interface RateLimitPolicy {
  strategy?: 'retry-after' | 'graphql-cost' | 'backoff-jitter'
  /** Max retry attempts on a throttle signal. Default 5. */
  maxRetries?: number
  /** Floor delay applied AFTER each request (inter-page pacing, token-bucket-lite). */
  minDelayMs?: number
}

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
  /** Rate-limit handling. Absent ⇒ the default `429`+`Retry-After` behavior. */
  rateLimit?: RateLimitPolicy
  /** Cancels in-flight waits (Retry-After/backoff sleeps) and the fetch. */
  signal?: AbortSignal
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
  /** Wall-clock spent waiting on rate limits across all retries of this request
   *  (Retry-After/backoff sleeps + reactive pacing). 0 when never throttled. The
   *  source folds this into the run ledger's `rateLimitWaitMs`. */
  rateLimitWaitMs: number
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
