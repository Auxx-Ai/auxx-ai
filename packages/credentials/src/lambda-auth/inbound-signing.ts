// packages/credentials/src/lambda-auth/inbound-signing.ts

import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { InboundAuthHeaders } from './types'

/**
 * Build the canonical message for HMAC signing.
 *
 * Format: v1\n<timestamp>\n<nonce>\n<caller>\n<keyId>\n<bodySha256>
 */
function buildCanonical(parts: {
  timestamp: string
  nonce: string
  caller: string
  keyId: string
  bodySha256: string
}): string {
  return ['v1', parts.timestamp, parts.nonce, parts.caller, parts.keyId, parts.bodySha256].join(
    '\n'
  )
}

/**
 * Sign an outbound Lambda invocation request with HMAC-SHA256.
 *
 * Returns headers that must be included in the HTTP request.
 * The Lambda function verifies these headers before executing.
 *
 * Domain prefix "inbound:v1:" prevents cross-purpose replay with callback tokens.
 */
export function signInboundRequest(params: {
  body: string
  caller: string
  secret: string
  keyId?: string
}): InboundAuthHeaders {
  const { body, caller, secret, keyId = 'v1' } = params
  const timestamp = String(Date.now())
  const nonce = randomUUID()
  const bodySha256 = createHash('sha256').update(body).digest('hex')

  const canonical = buildCanonical({ timestamp, nonce, caller, keyId, bodySha256 })
  const mac = createHmac('sha256', secret).update(`inbound:v1:${canonical}`).digest('hex')

  return {
    'X-Auxx-Signature': `sha256=${mac}`,
    'X-Auxx-Timestamp': timestamp,
    'X-Auxx-Nonce': nonce,
    'X-Auxx-Caller': caller,
    'X-Auxx-Key-Id': keyId,
  }
}
