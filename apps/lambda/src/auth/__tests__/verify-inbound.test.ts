// apps/lambda/src/auth/__tests__/verify-inbound.test.ts

/**
 * Unit tests for inbound request verification (Deno Web Crypto).
 *
 * These tests validate the Deno-side verification logic independently.
 * The cross-runtime compatibility test (Node.js sign + Deno verify) is in
 * packages/credentials/src/lambda-auth/__tests__/inbound-signing.test.ts.
 */

import { assertEquals } from 'jsr:@std/assert'
import { verifyInboundRequest } from '../verify-inbound.ts'

const TEST_SECRET = 'test-secret-key-for-hmac-signing-32chars'

/** Helper: sign a request using Web Crypto (same algorithm as Node.js signer) */
async function signWithWebCrypto(params: {
  body: string
  caller: string
  secret: string
  timestamp?: string
  nonce?: string
  keyId?: string
}): Promise<Record<string, string>> {
  const { body, caller, secret, keyId = 'v1' } = params
  const timestamp = params.timestamp ?? String(Date.now())
  const nonce = params.nonce ?? crypto.randomUUID()

  const encoder = new TextEncoder()

  // SHA-256 of body
  const bodyHash = await crypto.subtle.digest('SHA-256', encoder.encode(body))
  const bodySha256 = Array.from(new Uint8Array(bodyHash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Build canonical message
  const canonical = ['v1', timestamp, nonce, caller, keyId, bodySha256].join('\n')
  const message = `inbound:v1:${canonical}`

  // HMAC-SHA256
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  const mac = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return {
    'x-auxx-signature': `sha256=${mac}`,
    'x-auxx-timestamp': timestamp,
    'x-auxx-nonce': nonce,
    'x-auxx-caller': caller,
    'x-auxx-key-id': keyId,
  }
}

Deno.test('verifyInboundRequest - accepts valid signature', async () => {
  const body = '{"type":"function"}'
  const headers = await signWithWebCrypto({ body, caller: 'api', secret: TEST_SECRET })

  const result = await verifyInboundRequest({ headers, body, secret: TEST_SECRET })

  assertEquals(result.valid, true)
  assertEquals(result.caller, 'api')
  assertEquals(result.reason, undefined)
})

Deno.test('verifyInboundRequest - rejects invalid signature', async () => {
  const body = '{"type":"function"}'
  const headers = await signWithWebCrypto({ body, caller: 'api', secret: TEST_SECRET })

  // Tamper with signature
  headers['x-auxx-signature'] =
    'sha256=0000000000000000000000000000000000000000000000000000000000000000'

  const result = await verifyInboundRequest({ headers, body, secret: TEST_SECRET })

  assertEquals(result.valid, false)
  assertEquals(result.reason, 'Invalid signature')
})

Deno.test('verifyInboundRequest - rejects timestamp outside ±5 min', async () => {
  const body = '{"type":"function"}'
  const oldTimestamp = String(Date.now() - 6 * 60 * 1000) // 6 minutes ago
  const headers = await signWithWebCrypto({
    body,
    caller: 'api',
    secret: TEST_SECRET,
    timestamp: oldTimestamp,
  })

  const result = await verifyInboundRequest({ headers, body, secret: TEST_SECRET })

  assertEquals(result.valid, false)
  assertEquals(result.reason, 'Timestamp out of range')
})

Deno.test('verifyInboundRequest - rejects missing headers', async () => {
  const result = await verifyInboundRequest({
    headers: {},
    body: '{"type":"function"}',
    secret: TEST_SECRET,
  })

  assertEquals(result.valid, false)
  assertEquals(result.reason, 'Missing auth headers')
})

Deno.test('verifyInboundRequest - rejects tampered body', async () => {
  const body = '{"type":"function"}'
  const headers = await signWithWebCrypto({ body, caller: 'api', secret: TEST_SECRET })

  // Verify with different body
  const result = await verifyInboundRequest({
    headers,
    body: '{"type":"tampered"}',
    secret: TEST_SECRET,
  })

  assertEquals(result.valid, false)
  assertEquals(result.reason, 'Invalid signature')
})

Deno.test('verifyInboundRequest - rejects wrong secret', async () => {
  const body = '{"type":"function"}'
  const headers = await signWithWebCrypto({ body, caller: 'api', secret: TEST_SECRET })

  const result = await verifyInboundRequest({
    headers,
    body,
    secret: 'wrong-secret',
  })

  assertEquals(result.valid, false)
  assertEquals(result.reason, 'Invalid signature')
})
