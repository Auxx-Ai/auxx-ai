// packages/lib/src/utils/headers.ts

/**
 * Patterns for identifying sensitive HTTP headers that should be filtered
 * from webhook test events and logs to prevent credential exposure
 */
const SENSITIVE_HEADER_PATTERNS = [
  // Authentication headers
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /^bearer$/i,

  // API keys and tokens
  /api[-_]?key/i,
  /[-_]?token/i,
  /[-_]?secret/i,
  /[-_]?password/i,
  /[-_]?credential/i,

  // Webhook signatures (contain sensitive signing secrets)
  /^x-stripe-signature$/i,
  /^x-shopify-hmac/i,
  /^x-hub-signature/i,
  /^x-slack-signature$/i,
  /^x-github-signature/i,
]

/**
 * Filters out sensitive headers from a headers object to prevent
 * credential exposure in webhook test events and logs.
 *
 * Completely removes sensitive headers (both key and value) rather than
 * redacting them, which is more secure as it doesn't reveal that
 * authentication was used.
 *
 * Safe headers like content-type, user-agent, etc. are preserved for
 * debugging purposes.
 *
 * @param headers - The original headers object from an HTTP request
 * @returns A new headers object with sensitive headers removed
 *
 * @example
 * ```typescript
 * const headers = {
 *   'authorization': 'Bearer sk_live_xxx',
 *   'content-type': 'application/json',
 *   'x-api-key': 'secret123'
 * }
 *
 * const filtered = filterSensitiveHeaders(headers)
 * // Result: { 'content-type': 'application/json' }
 * ```
 */
export function filterSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    // Check if this header matches any sensitive patterns
    const isSensitive = SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(key))

    // Only include non-sensitive headers
    if (!isSensitive) {
      filtered[key] = value
    }
  }

  return filtered
}
