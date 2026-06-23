// packages/lib/src/webhooks/inbound/verify/index.ts
// The verify surface: a preset dispatcher plus the standalone primitives.

import type { WebhookVerifyPreset } from '../types'
import { timingSafeStringEqual } from './compare'
import { verifyHmacSignature } from './hmac'
import { verifyStripeSignature } from './stripe-sig'

export { timingSafeStringEqual } from './compare'
export { verifyHmacSignature } from './hmac'
export { verifyShopifyAppProxy } from './shopify-app-proxy'
export { parseStripeSigHeader, verifyStripeSignature } from './stripe-sig'

/**
 * Dispatch verification by a provider preset over the raw body + headers + secret.
 * `secret` null ⇒ false (untrusted). App-proxy is NOT handled here (it verifies over
 * query params) — call `verifyShopifyAppProxy` directly.
 */
export function verifyWebhook(
  preset: WebhookVerifyPreset,
  input: { rawBody: string; headers: Record<string, string>; secret: string | null }
): boolean {
  const { rawBody, headers, secret } = input
  if (!secret) return false

  switch (preset.scheme) {
    case 'stripe-sig':
      return verifyStripeSignature({
        rawBody,
        header: headers[preset.header] ?? '',
        secret,
        toleranceSec: preset.toleranceSec,
      })
    case 'shared-token':
      return timingSafeStringEqual(headers[preset.header] ?? '', secret)
    default:
      return verifyHmacSignature({
        rawBody,
        signature: headers[preset.header] ?? '',
        secret,
        algo: preset.algo,
        encoding: preset.encoding,
        prefix: preset.prefix,
        signedPayload: preset.signedPayload,
      })
  }
}
