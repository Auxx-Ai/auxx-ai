// packages/utils/src/url.ts

/**
 * Ensures the URL includes a protocol and is syntactically valid. Prepends
 * `https://` when no protocol is present, then validates with `new URL()`.
 * Returns `null` when the input cannot be parsed (e.g. contains whitespace).
 *
 * Mirrors the existing FieldType.URL display behavior — keep them in sync so
 * URL handling is consistent across the app.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`
  try {
    return new URL(candidate).toString()
  } catch {
    return null
  }
}

/** Human-friendly URL label without protocol noise. Mirrors `display-url.tsx`. */
export function formatUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname
    const search = parsed.search
    const hash = parsed.hash
    const host = parsed.hostname.replace(/^www\./, '')
    return `${host}${pathname}${search}${hash}` || host
  } catch {
    return url
  }
}

/**
 * Strict heuristic for "did the user type a URL?" — used for smart-paste
 * detection in inputs where URL is one possibility among others (e.g. an
 * inline title field that may also be plain text).
 *
 * Stricter than `normalizeUrl` to avoid treating bare words like `hello`
 * as URLs (the WHATWG URL parser happily accepts `https://hello` as a host).
 *
 * Returns true when the input has no whitespace AND either has a protocol
 * or contains a dot (looks like a hostname or path).
 */
export function isLikelyUrlInput(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  if (/\s/.test(trimmed)) return false
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return normalizeUrl(trimmed) !== null
  }
  if (!/\./.test(trimmed)) return false
  return normalizeUrl(trimmed) !== null
}

/** Display label for a URL when no title is set — host + first path segment. */
export function deriveTitleFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/^\/+|\/+$/g, '')
    const host = u.host.replace(/^www\./, '')
    return path ? `${host}/${path}` : host
  } catch {
    return url
  }
}

// ─── {key} template interpolation ────────────────────────────────────
//
// The canonical `{key}` placeholder substitution shared across the connection
// runtime — auth header/query values, base-URL templates — and (eventually) the
// oauth2 connect flow. One implementation so the encode/no-encode decision is a
// caller flag, not a fork.

/**
 * Substitute `{key}` placeholders in `template` from a `vars` map.
 *
 * `encode` URI-encodes each substituted value — use it only when a value lands in
 * a URL query param or path segment where reserved characters must be escaped.
 * Default `false`: base-URL templates and header values are inserted raw, because
 * a value that is itself a URL (e.g. a Supabase project URL) or a path-safe token
 * (e.g. a Telegram bot token) must not be percent-encoded.
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string>,
  opts: { encode?: boolean } = {}
): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    const replacement = opts.encode ? encodeURIComponent(value) : value
    result = result.replaceAll(`{${key}}`, replacement)
  }
  return result
}

/** A `{key}` value would move a URL template's host off the domain the template pins. */
export class UnsafeUrlTemplateError extends Error {
  constructor(key: string) {
    super(`Connection value "${key}" is not a valid hostname part`)
    this.name = 'UnsafeUrlTemplateError'
  }
}

const TEMPLATE_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i
const HOST_PART = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i

/**
 * {@link interpolateTemplate} for a URL template. A placeholder that shares the
 * host with literal text (`https://{shop}.myshopify.com`) must be hostname
 * characters only, so a value like `evil.com/x?` cannot re-home the request.
 * A template whose whole host is one placeholder is tenant-chosen by design.
 */
export function interpolateUrlTemplate(template: string, vars: Record<string, string>): string {
  const authority = TEMPLATE_AUTHORITY.exec(template)?.[1] ?? ''
  const hostKeys = unresolvedPlaceholders(authority)
  if (hostKeys.length > 0 && !/^\{[^}]+\}$/.test(authority)) {
    for (const key of hostKeys) {
      const value = vars[key]
      if (value !== undefined && !HOST_PART.test(value)) throw new UnsafeUrlTemplateError(key)
    }
  }
  return interpolateTemplate(template, vars)
}

/** The `{key}` placeholder names left unresolved in `template` (for validation). */
export function unresolvedPlaceholders(template: string): string[] {
  return [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!)
}

// ─── auxx:// internal URI scheme ─────────────────────────────────────
//
// Internal references inside the product use opaque `auxx://...` URIs that
// resolve to the current slug at render time. This keeps links stable when
// the targeted entity is renamed.

const AUXX_KB_ARTICLE_PREFIX = 'auxx://kb/article/'

export interface AuxxArticleRef {
  kind: 'kb-article'
  articleId: string
}

export function buildAuxxArticleUrl(articleId: string): string {
  return `${AUXX_KB_ARTICLE_PREFIX}${articleId}`
}

export function isAuxxUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith('auxx://')
}

export function parseAuxxArticleUrl(url: string | null | undefined): AuxxArticleRef | null {
  if (typeof url !== 'string') return null
  if (!url.startsWith(AUXX_KB_ARTICLE_PREFIX)) return null
  const articleId = url.slice(AUXX_KB_ARTICLE_PREFIX.length)
  if (!articleId) return null
  return { kind: 'kb-article', articleId }
}
