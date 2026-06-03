// packages/lib/src/knowledge-sources/crawl/url.ts
// Pure URL helpers shared by the crawl provider + website connector. Kept provider-
// agnostic so the normalized externalId (and thus orphan reconciliation) is stable
// regardless of which CrawlProvider produced the page.

/** Strip the fragment and any trailing slash (except root) → a stable externalId. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    let s = u.toString()
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1)
    return s
  } catch {
    return raw
  }
}

/** Escape a string for safe literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A section path prefix → a pathname regex Firecrawl matches with `includePaths`.
 * `'/products'` → `^/products` (matches `/products` and `/products/...`).
 */
export function toPathRegex(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `^${escapeRegExp(normalized)}`
}
