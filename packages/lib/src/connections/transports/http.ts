// packages/lib/src/connections/transports/http.ts
// The HTTP transport — the one place a resolved connection becomes an outgoing HTTP
// call. Composes the shared `applyAuth` (auth insertion) with URL/query assembly,
// body encoding, timeout, rate-limit handling (G3), and response normalization that
// consumers previously hand-rolled. Consumers: generic-rest data connectors today;
// the workflow HTTP node and connection-backed agent tools next.

import { applyAuth, type RequestParts } from '../auth-apply'
import type { RuntimeConnectionData } from '../resolve-connection-for-runtime'
import type { HttpResponse, HttpTransport, RateLimitPolicy } from './types'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RETRIES = 5
/** Ceiling for any single throttle wait — a hostile `Retry-After` can't park a worker forever. */
const MAX_WAIT_MS = 60_000
/** Backoff base for the no-`Retry-After` (Stripe) path. */
const BACKOFF_BASE_MS = 1_000

/** True when `headers` already carries `name` (case-insensitive). */
function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === lower)
}

/** True when `value` carries its own scheme (e.g. `https://…`), not a relative path. */
function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}

/**
 * Resolve the request URL. An absolute URL is used as-is; a relative path is
 * joined onto the connection's contributed `baseUrl` (§3). A relative path with no
 * connection base URL is a configuration error.
 */
function resolveUrl(reqUrl: string, conn: RuntimeConnectionData | null): string {
  if (isAbsoluteUrl(reqUrl)) return reqUrl
  const base = conn?.baseUrl
  if (!base) {
    throw new Error(
      `httpTransport: relative URL "${reqUrl}" has no connection baseUrl to resolve against`
    )
  }
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const path = reqUrl.startsWith('/') ? reqUrl : `/${reqUrl}`
  return `${trimmedBase}${path}`
}

/** Assemble the final URL, merging any `query` params into the URL's query string. */
function buildUrl(url: string, query?: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) return url
  const u = new URL(url)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
  }
  return u.toString()
}

/**
 * Encode a body for `fetch`. Pre-encoded shapes (string / URLSearchParams /
 * FormData / binary) pass through untouched; a plain object is JSON-encoded and
 * defaults a `application/json` Content-Type (unless the caller set one).
 */
function encodeBody(body: unknown, headers: Record<string, string>): BodyInit | undefined {
  if (body === undefined || body === null) return undefined
  if (
    typeof body === 'string' ||
    body instanceof URLSearchParams ||
    body instanceof FormData ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return body as BodyInit
  }
  if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json'
  return JSON.stringify(body)
}

/** Collapse a `Headers` into a lowercased plain object. */
function normalizeHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

/** Sleep `ms`, rejecting early if `signal` aborts (so a cancelled slice never parks). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date) to milliseconds.
 * Returns `undefined` when absent/unparseable so the caller can fall back to backoff.
 */
function parseRetryAfterMs(value: string | undefined): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const when = Date.parse(value)
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now())
  return undefined
}

/** Full-jitter exponential backoff for the no-header path: `random(0, base·2^n)`. */
function backoffMs(attempt: number): number {
  const ceil = Math.min(MAX_WAIT_MS, BACKOFF_BASE_MS * 2 ** attempt)
  return Math.round(Math.random() * ceil)
}

/**
 * Shopify GraphQL throttling is an **HTTP 200** — detect the `Throttled` error in
 * the body and compute the cost-restore wait `(requested − available) / restoreRate`.
 * Returns the wait in ms, or `undefined` when the body isn't a throttle signal.
 */
function graphqlThrottleWaitMs(body: string): number | undefined {
  let parsed: unknown
  try {
    parsed = body.length ? JSON.parse(body) : undefined
  } catch {
    return undefined
  }
  const root = parsed as
    | {
        errors?: Array<{ message?: string; extensions?: { code?: string } }>
        extensions?: {
          cost?: {
            requestedQueryCost?: number
            throttleStatus?: { currentlyAvailable?: number; restoreRate?: number }
          }
        }
      }
    | undefined
  const throttled = root?.errors?.some(
    (e) => e.message === 'Throttled' || e.extensions?.code === 'THROTTLED'
  )
  if (!throttled) return undefined
  const cost = root?.extensions?.cost
  const requested = cost?.requestedQueryCost ?? 0
  const available = cost?.throttleStatus?.currentlyAvailable ?? 0
  const restoreRate = cost?.throttleStatus?.restoreRate ?? 0
  if (restoreRate > 0 && requested > available) {
    return Math.min(MAX_WAIT_MS, Math.ceil(((requested - available) / restoreRate) * 1_000))
  }
  // Throttled but no usable cost data — let the caller backoff.
  return 0
}

/**
 * Decide whether a completed response is a throttle signal and how long to wait.
 * Honors `Retry-After` universally; adds Shopify-GraphQL 200-body detection under
 * the `graphql-cost` strategy. `waitMs: undefined` ⇒ throttle but no server hint,
 * so the caller applies jittered backoff.
 */
function detectThrottle(
  status: number,
  headers: Record<string, string>,
  body: string,
  policy: RateLimitPolicy | undefined
): { throttled: boolean; waitMs?: number } {
  if (policy?.strategy === 'graphql-cost' && status === 200) {
    const waitMs = graphqlThrottleWaitMs(body)
    if (waitMs !== undefined) return { throttled: true, waitMs: waitMs || undefined }
  }
  // The universal case: 429 (rate limited) or 503 (service asking to back off).
  if (status === 429 || status === 503) {
    return { throttled: true, waitMs: parseRetryAfterMs(headers['retry-after']) }
  }
  return { throttled: false }
}

export const httpTransport: HttpTransport = {
  kind: 'http',

  async request(conn, req) {
    const headers: Record<string, string> = { ...(req.headers ?? {}) }
    const body = encodeBody(req.body, headers)

    // Auth runs last so query auth appends to the fully-assembled URL.
    let parts: RequestParts = { headers, url: buildUrl(resolveUrl(req.url, conn), req.query) }
    if (conn) parts = applyAuth(parts, conn, conn.authApply)

    const policy = req.rateLimit
    const maxRetries = policy?.maxRetries ?? DEFAULT_MAX_RETRIES
    let rateLimitWaitMs = 0

    for (let attempt = 0; ; attempt++) {
      // Combine the caller's cancellation with the per-attempt timeout.
      const timeout = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout

      const res = await fetch(parts.url, {
        method: req.method,
        headers: parts.headers,
        body,
        signal,
        redirect: 'follow',
      })
      const text = await res.text()
      const respHeaders = normalizeHeaders(res.headers)

      const throttle = detectThrottle(res.status, respHeaders, text, policy)
      if (throttle.throttled && attempt < maxRetries) {
        const waitMs = Math.min(MAX_WAIT_MS, throttle.waitMs ?? backoffMs(attempt))
        rateLimitWaitMs += waitMs
        await sleep(waitMs, req.signal)
        continue
      }

      // Inter-page pacing: a configured floor between pages (token-bucket-lite),
      // applied after the response so a pagination loop paces before the next page.
      // NOTE: speculative pre-throttling off a usage gauge (e.g. Shopify's
      // shop-global `X-Shopify-Shop-Api-Call-Limit`) is cross-request coordination
      // and deliberately does NOT live in this stateless per-request transport — it
      // belongs in the per-connection throttle layer (sync-core `ThrottleHandle`
      // over `UniversalThrottler`, keyed by connection), wired in Steps 3/4.
      const paceMs = policy?.minDelayMs ?? 0
      if (paceMs > 0) {
        rateLimitWaitMs += paceMs
        await sleep(paceMs, req.signal)
      }

      let parsed: unknown
      let parsedDone = false
      return {
        status: res.status,
        ok: res.ok,
        headers: respHeaders,
        body: text,
        rateLimitWaitMs,
        json<T = unknown>(): T {
          if (!parsedDone) {
            parsed = text.length ? JSON.parse(text) : undefined
            parsedDone = true
          }
          return parsed as T
        },
      } satisfies HttpResponse
    }
  },
}
