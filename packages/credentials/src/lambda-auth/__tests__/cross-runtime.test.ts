// packages/credentials/src/lambda-auth/__tests__/cross-runtime.test.ts

/**
 * Cross-runtime compatibility test.
 *
 * Signs a request using the Node.js signing module (node:crypto),
 * then verifies the signature by reimplementing the Deno Web Crypto
 * verification algorithm using Node.js webcrypto.
 *
 * This proves that the two implementations (inbound-signing.ts and
 * verify-inbound.ts) produce and accept identical signatures.
 */

import { createHash, webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { signInboundRequest } from '../inbound-signing'

const TEST_SECRET = 'cross-runtime-test-secret-key-32-chars'

// Reimplementation of the Deno verification using Node.js webcrypto
// This mirrors apps/lambda/src/auth/verify-inbound.ts exactly
async function verifyWithWebCrypto(params: {
  headers: Record<string, string>
  body: string
  secret: string
}): Promise<{ valid: boolean; caller?: string }> {
  const { headers, body, secret } = params

  const signature = headers['X-Auxx-Signature']
  const timestamp = headers['X-Auxx-Timestamp']
  const nonce = headers['X-Auxx-Nonce']
  const caller = headers['X-Auxx-Caller']
  const keyId = headers['X-Auxx-Key-Id']

  if (!signature || !timestamp || !nonce || !caller || !keyId) {
    return { valid: false }
  }

  // Strip "sha256=" prefix
  const mac = signature.startsWith('sha256=') ? signature.slice(7) : signature

  // SHA-256 of body using webcrypto
  const encoder = new TextEncoder()
  const bodyHash = await webcrypto.subtle.digest('SHA-256', encoder.encode(body))
  const bodySha256 = Array.from(new Uint8Array(bodyHash))
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('')

  // Build canonical message (same format as Deno verifier)
  const canonical = ['v1', timestamp, nonce, caller, keyId, bodySha256].join('\n')
  const message = `inbound:v1:${canonical}`

  // HMAC-SHA256 verify using webcrypto
  const key = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

  const sigBytes = new Uint8Array(mac.length / 2)
  for (let i = 0; i < mac.length; i += 2) {
    sigBytes[i / 2] = Number.parseInt(mac.slice(i, i + 2), 16)
  }

  const valid = await webcrypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(message))
  return { valid, caller: valid ? caller : undefined }
}

describe('cross-runtime compatibility', () => {
  it('Node.js node:crypto signature is verified by webcrypto', async () => {
    const body =
      '{"type":"function","functionIdentifier":"actions/test.server","functionArgs":"[]"}'

    // Sign with node:crypto (what @auxx/credentials uses)
    const headers = signInboundRequest({
      body,
      caller: 'api',
      secret: TEST_SECRET,
    })

    // Verify with webcrypto (mirrors what Deno Lambda does)
    const result = await verifyWithWebCrypto({
      headers,
      body,
      secret: TEST_SECRET,
    })

    expect(result.valid).toBe(true)
    expect(result.caller).toBe('api')
  })

  it('body SHA-256 matches between node:crypto and webcrypto', async () => {
    const body = '{"test":"data","nested":{"key":"value"}}'

    // node:crypto hash
    const nodeHash = createHash('sha256').update(body).digest('hex')

    // webcrypto hash
    const encoder = new TextEncoder()
    const webHash = await webcrypto.subtle.digest('SHA-256', encoder.encode(body))
    const webHashHex = Array.from(new Uint8Array(webHash))
      .map((b: number) => b.toString(16).padStart(2, '0'))
      .join('')

    expect(nodeHash).toBe(webHashHex)
  })

  it('different callers produce different valid signatures', async () => {
    const body = '{"type":"webhook"}'

    const apiHeaders = signInboundRequest({ body, caller: 'api', secret: TEST_SECRET })
    const workerHeaders = signInboundRequest({ body, caller: 'worker', secret: TEST_SECRET })

    // Both should be valid
    const apiResult = await verifyWithWebCrypto({ headers: apiHeaders, body, secret: TEST_SECRET })
    const workerResult = await verifyWithWebCrypto({
      headers: workerHeaders,
      body,
      secret: TEST_SECRET,
    })

    expect(apiResult.valid).toBe(true)
    expect(apiResult.caller).toBe('api')
    expect(workerResult.valid).toBe(true)
    expect(workerResult.caller).toBe('worker')

    // But signatures differ
    expect(apiHeaders['X-Auxx-Signature']).not.toBe(workerHeaders['X-Auxx-Signature'])
  })

  it('tampered body fails webcrypto verification', async () => {
    const body = '{"type":"function"}'
    const headers = signInboundRequest({ body, caller: 'api', secret: TEST_SECRET })

    const result = await verifyWithWebCrypto({
      headers,
      body: '{"type":"tampered"}',
      secret: TEST_SECRET,
    })

    expect(result.valid).toBe(false)
  })

  it('wrong secret fails webcrypto verification', async () => {
    const body = '{"type":"function"}'
    const headers = signInboundRequest({ body, caller: 'api', secret: TEST_SECRET })

    const result = await verifyWithWebCrypto({
      headers,
      body,
      secret: 'wrong-secret',
    })

    expect(result.valid).toBe(false)
  })
})
