// packages/lib/src/webhooks/inbound/verify/hmac.ts
// The parametric HMAC verifier — one correct, timing-safe, length-guarded
// implementation that replaces ~10 hand-rolled copies. Providers vary only by data
// (algo / encoding / signed payload / prefix / secret encoding), never by logic.

import { createHmac } from 'node:crypto'
import type { HmacVerifyParams } from '../types'
import { timingSafeStringEqual } from './compare'

/**
 * Timing-safe + length-guarded HMAC compare. The length guard is the fix for the
 * `timingSafeEqual` throw-on-mismatch bug (OpenPhone) and the non-timing-safe `!==`
 * bugs (Facebook/Instagram). Returns false on any missing input.
 */
export function verifyHmacSignature(p: HmacVerifyParams): boolean {
  const {
    rawBody,
    secret,
    algo = 'sha256',
    encoding = 'base64',
    signedPayload,
    prefix,
    secretEncoding = 'utf8',
  } = p
  if (!secret) return false

  let signature = p.signature ?? ''
  if (!signature) return false
  // When a prefix is configured the wire value MUST carry it (Meta `sha256=…`, Svix
  // `v1,…`) — reject otherwise, matching the providers' exact compare.
  if (prefix) {
    if (!signature.startsWith(prefix)) return false
    signature = signature.slice(prefix.length)
  }

  const key = secretEncoding === 'base64' ? Buffer.from(secret, 'base64') : secret
  const message = signedPayload ? signedPayload(rawBody) : rawBody
  const expected = createHmac(algo, key).update(message, 'utf8').digest(encoding)
  return timingSafeStringEqual(signature, expected)
}
