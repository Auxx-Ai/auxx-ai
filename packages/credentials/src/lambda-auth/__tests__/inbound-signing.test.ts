// packages/credentials/src/lambda-auth/__tests__/inbound-signing.test.ts

import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { signInboundRequest } from '../inbound-signing'

const TEST_SECRET = 'test-secret-key-for-hmac-signing-32chars'

describe('inbound-signing', () => {
  it('produces all required auth headers', () => {
    const headers = signInboundRequest({
      body: '{"type":"function"}',
      caller: 'api',
      secret: TEST_SECRET,
    })

    expect(headers['X-Auxx-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(headers['X-Auxx-Timestamp']).toMatch(/^\d+$/)
    expect(headers['X-Auxx-Nonce']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(headers['X-Auxx-Caller']).toBe('api')
    expect(headers['X-Auxx-Key-Id']).toBe('v1')
  })

  it('signature changes when body changes', () => {
    const headers1 = signInboundRequest({
      body: '{"type":"function","data":"a"}',
      caller: 'api',
      secret: TEST_SECRET,
    })
    const headers2 = signInboundRequest({
      body: '{"type":"function","data":"b"}',
      caller: 'api',
      secret: TEST_SECRET,
    })

    expect(headers1['X-Auxx-Signature']).not.toBe(headers2['X-Auxx-Signature'])
  })

  it('signature changes when caller changes', () => {
    const body = '{"type":"function"}'
    const headers1 = signInboundRequest({ body, caller: 'api', secret: TEST_SECRET })
    const headers2 = signInboundRequest({ body, caller: 'worker', secret: TEST_SECRET })

    expect(headers1['X-Auxx-Signature']).not.toBe(headers2['X-Auxx-Signature'])
  })

  it('generates different nonce per call', () => {
    const body = '{"type":"function"}'
    const headers1 = signInboundRequest({ body, caller: 'api', secret: TEST_SECRET })
    const headers2 = signInboundRequest({ body, caller: 'api', secret: TEST_SECRET })

    expect(headers1['X-Auxx-Nonce']).not.toBe(headers2['X-Auxx-Nonce'])
  })

  it('uses custom keyId when provided', () => {
    const headers = signInboundRequest({
      body: '{"type":"function"}',
      caller: 'api',
      secret: TEST_SECRET,
      keyId: 'v2',
    })

    expect(headers['X-Auxx-Key-Id']).toBe('v2')
  })

  it('produces a verifiable signature', () => {
    const body = '{"type":"function"}'
    const headers = signInboundRequest({ body, caller: 'api', secret: TEST_SECRET })

    // Manually verify the signature using the same algorithm
    const bodySha256 = createHash('sha256').update(body).digest('hex')
    const canonical = [
      'v1',
      headers['X-Auxx-Timestamp'],
      headers['X-Auxx-Nonce'],
      'api',
      'v1',
      bodySha256,
    ].join('\n')
    const expectedMac = createHmac('sha256', TEST_SECRET)
      .update(`inbound:v1:${canonical}`)
      .digest('hex')

    expect(headers['X-Auxx-Signature']).toBe(`sha256=${expectedMac}`)
  })
})
