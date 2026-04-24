// apps/extension/src/lib/url-normalize.ts

/**
 * URL helpers.
 *
 * `normalizeUrl` strips the trailing slash from `origin + pathname`, with an
 * optional `search` tail. Used for the button's `data-href` dedup comparison
 * — two URLs are "the same profile/company" iff their normalized forms match.
 */

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '')
}

export function normalizeUrl(url: string, { includeSearch = false } = {}): string {
  const { origin, pathname, search } = new URL(url)
  return stripTrailingSlash(origin + pathname) + (includeSearch ? search : '')
}
