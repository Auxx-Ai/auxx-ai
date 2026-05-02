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
