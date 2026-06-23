// packages/lib/src/webhooks/inbound/verify/compare.ts
// The one safe-compare everyone reuses. Length-guarded so `timingSafeEqual` never
// throws on a length mismatch (it requires equal-length buffers), and the equal-length
// path stays constant-time.

import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string equality that tolerates length mismatch (returns false rather
 * than throwing). Used for HMAC digests, shared tokens, and Outlook `clientState`.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
