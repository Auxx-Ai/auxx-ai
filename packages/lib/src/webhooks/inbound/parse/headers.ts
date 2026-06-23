// packages/lib/src/webhooks/inbound/parse/headers.ts
// Normalize a request's headers into a lowercased plain Record — the shape every
// preset/verifier reads (HMAC headers are matched case-insensitively). Reading the
// raw body stays at the call site (framework-specific).

/** Lowercase header keys into a plain Record. Accepts a `Headers` or `[k,v]` iterable. */
export function normalizeHeaders(
  headers: Headers | Iterable<[string, string]>
): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof (headers as Headers).forEach === 'function' && !Array.isArray(headers)) {
    ;(headers as Headers).forEach((value, key) => {
      out[key.toLowerCase()] = value
    })
  } else {
    for (const [key, value] of headers as Iterable<[string, string]>) {
      out[key.toLowerCase()] = value
    }
  }
  return out
}
