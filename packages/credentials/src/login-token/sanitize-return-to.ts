// packages/credentials/src/login-token/sanitize-return-to.ts

/**
 * Sanitize a `returnTo` value to a safe relative path.
 *
 * Rejects anything that:
 * - isn't a string
 * - doesn't start with `/`
 * - starts with `//` (protocol-relative)
 * - contains `..` (parent traversal)
 *
 * Falls back to the provided `fallback` (default `/`).
 */
export function sanitizeReturnTo(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('..')) {
    return fallback
  }
  return value
}
