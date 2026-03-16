// packages/utils/src/oauth.ts

/**
 * Validates a redirect path from an OAuth state parameter to prevent open redirects.
 * Returns a safe path or the provided fallback.
 */
export function validateRedirectPath(path: string | undefined, fallback: string): string {
  if (!path) return fallback
  if (typeof path !== 'string') return fallback

  // Must be a relative path starting with /
  if (!path.startsWith('/')) return fallback
  // Block protocol-relative URLs (//evil.com)
  if (path.startsWith('//')) return fallback
  // Block path traversal
  if (path.includes('..')) return fallback

  return path
}
