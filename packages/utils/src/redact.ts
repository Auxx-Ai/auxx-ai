// packages/utils/src/redact.ts

/** Options for {@link redactSecrets}. */
export interface RedactSecretsOptions {
  /** Keys matching this pattern are redacted. Defaults to common secret markers. */
  secretKeyPattern?: RegExp
  /**
   * Keys matching this pattern are preserved even when they match
   * `secretKeyPattern` — reference pointers like `credId`, `providerName`, etc.
   * Defaults to id/ref/name/provider/slug/kind/type suffixes.
   */
  safeKeyPattern?: RegExp
  /** Replacement marker for redacted values. Defaults to `'[redacted]'`. */
  placeholder?: string
}

const DEFAULT_SECRET_KEY_RE =
  /(secret|password|token|apikey|api_key|privatekey|private_key|credential)/i
// Reference-shaped keys are non-secret pointers and must survive redaction.
const DEFAULT_SAFE_KEY_RE = /(id|ref|name|provider|slug|kind|type)$/i

/**
 * Defensive deep redaction: any object key that *looks* like a secret (and isn't
 * a reference-shaped key) is replaced with a marker, recursively. Returns a new
 * value; the input is not mutated. Array order is preserved.
 *
 * Use as belt-and-suspenders so a stray decrypted value can never be persisted
 * in a snapshot, trace, log, or note even if it slips past upstream filtering.
 * PURE.
 */
export function redactSecrets<T>(value: T, options?: RedactSecretsOptions): T {
  const secretRe = options?.secretKeyPattern ?? DEFAULT_SECRET_KEY_RE
  const safeRe = options?.safeKeyPattern ?? DEFAULT_SAFE_KEY_RE
  const placeholder = options?.placeholder ?? '[redacted]'

  const redact = (val: unknown): unknown => {
    if (val === null || typeof val !== 'object') return val
    if (Array.isArray(val)) return val.map(redact)
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(val as Record<string, unknown>)) {
      out[key] = secretRe.test(key) && !safeRe.test(key) ? placeholder : redact(v)
    }
    return out
  }

  return redact(value) as T
}
