// packages/billing/src/utils/url-helpers.ts
/**
 * URL building utilities for billing operations.
 */

/** Build full URL from base and path */
export function buildUrl(base: string, path: string): string {
  if (path.startsWith('http')) {
    return path
  }
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${cleanBase}${cleanPath}`
}
