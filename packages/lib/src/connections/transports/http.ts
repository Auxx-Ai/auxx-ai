// packages/lib/src/connections/transports/http.ts
// The HTTP transport — the one place a resolved connection becomes an outgoing HTTP
// call. Composes the shared `applyAuth` (auth insertion) with URL/query assembly,
// body encoding, timeout, and response normalization that consumers previously
// hand-rolled. Consumers: generic-rest data connectors today; the workflow HTTP node
// and connection-backed agent tools next.

import { applyAuth, type RequestParts } from '../auth-apply'
import type { RuntimeConnectionData } from '../resolve-connection-for-runtime'
import type { HttpResponse, HttpTransport } from './types'

const DEFAULT_TIMEOUT_MS = 30_000

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

export const httpTransport: HttpTransport = {
  kind: 'http',

  async request(conn, req) {
    const headers: Record<string, string> = { ...(req.headers ?? {}) }
    const body = encodeBody(req.body, headers)

    // Auth runs last so query auth appends to the fully-assembled URL.
    let parts: RequestParts = { headers, url: buildUrl(resolveUrl(req.url, conn), req.query) }
    if (conn) parts = applyAuth(parts, conn, conn.authApply)

    const res = await fetch(parts.url, {
      method: req.method,
      headers: parts.headers,
      body,
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      redirect: 'follow',
    })

    const text = await res.text()
    let parsed: unknown
    let parsedDone = false

    return {
      status: res.status,
      ok: res.ok,
      headers: normalizeHeaders(res.headers),
      body: text,
      json<T = unknown>(): T {
        if (!parsedDone) {
          parsed = text.length ? JSON.parse(text) : undefined
          parsedDone = true
        }
        return parsed as T
      },
    } satisfies HttpResponse
  },
}
