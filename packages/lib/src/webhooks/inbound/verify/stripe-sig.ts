// packages/lib/src/webhooks/inbound/verify/stripe-sig.ts
// Stripe's `Stripe-Signature` scheme (`t=<ts>,v1=<hmac>,…` over `${t}.${rawBody}`).
// SDK-faithful: HMAC-SHA256 hex, timing-safe + length-guarded compare, AND the
// timestamp tolerance window for replay protection — dropping the window would make
// this primitive WEAKER than the SDK it replaces in billing (§4.1).

import { createHmac } from 'node:crypto'
import { timingSafeStringEqual } from './compare'

/** Parse `Stripe-Signature: t=<ts>,v1=<hmac>,v1=<hmac>,…` into its timestamp + v1 list. */
export function parseStripeSigHeader(header: string): { t: string; v1: string[] } {
  const parts = header.split(',').map((p) => p.trim())
  let t = ''
  const v1: string[] = []
  for (const part of parts) {
    const [k, v] = part.split('=')
    if (k === 't' && v) t = v
    if (k === 'v1' && v) v1.push(v)
  }
  return { t, v1 }
}

/**
 * Verifies the `Stripe-Signature` scheme. Behaviorally faithful to Stripe's
 * `constructEvent`: HMAC-SHA256 over `${t}.${rawBody}`, hex, compared timing-safe;
 * ANY v1 signature matching passes (Stripe may send several during secret rotation);
 * and the timestamp must fall within `toleranceSec` (default 300s) to reject replays.
 */
export function verifyStripeSignature(input: {
  rawBody: string
  header: string
  secret: string
  toleranceSec?: number
}): boolean {
  const { rawBody, header, secret, toleranceSec = 300 } = input
  if (!secret || !header) return false

  const { t, v1 } = parseStripeSigHeader(header)
  if (!t || v1.length === 0) return false

  // Replay protection — reject a stale (or future-dated) timestamp.
  const ts = Number.parseInt(t, 10)
  if (!Number.isFinite(ts)) return false
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > toleranceSec) return false

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex')
  return v1.some((sig) => timingSafeStringEqual(sig, expected))
}
