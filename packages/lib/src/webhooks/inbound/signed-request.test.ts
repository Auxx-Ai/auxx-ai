// packages/lib/src/webhooks/inbound/signed-request.test.ts
// Golden-vector tests for Meta's `signed_request` contract. Fixtures are signed with a real
// HMAC over the base64url payload string exactly as Meta transmits it, so the happy path is
// genuine rather than mocked.

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseSignedRequest } from './signed-request'

const APP_SECRET = 'app-secret-abc123'
const NOW = 1_700_000_000

function encodePayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function sign(encodedPayload: string, secret = APP_SECRET): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

function buildSignedRequest(
  payload: Record<string, unknown> = {
    algorithm: 'HMAC-SHA256',
    issued_at: NOW - 5,
    user_id: '10175030062710640',
  },
  secret = APP_SECRET
): { signedRequest: string; encodedPayload: string; signature: string } {
  const encodedPayload = encodePayload(payload)
  const signature = sign(encodedPayload, secret)
  return { signedRequest: `${signature}.${encodedPayload}`, encodedPayload, signature }
}

describe('parseSignedRequest', () => {
  it('verifies a real Meta-shaped signed_request', () => {
    const { signedRequest } = buildSignedRequest()
    const result = parseSignedRequest(signedRequest, APP_SECRET, NOW)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({ userId: '10175030062710640', issuedAt: NOW - 5 })
  })

  it('signs the ENCODED payload string, not the decoded JSON', () => {
    const { encodedPayload } = buildSignedRequest()
    const jsonSigned = createHmac('sha256', APP_SECRET)
      .update(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
      .digest('base64url')
    const result = parseSignedRequest(`${jsonSigned}.${encodedPayload}`, APP_SECRET, NOW)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('signature mismatch')
  })

  it('rejects a tampered payload', () => {
    const { signature } = buildSignedRequest()
    const tampered = encodePayload({
      algorithm: 'HMAC-SHA256',
      issued_at: NOW - 5,
      user_id: 'attacker-id',
    })
    const result = parseSignedRequest(`${signature}.${tampered}`, APP_SECRET, NOW)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('signature mismatch')
  })

  it('rejects a tampered signature (same length) and a truncated one', () => {
    const { signature, encodedPayload } = buildSignedRequest()
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`
    expect(parseSignedRequest(`${flipped}.${encodedPayload}`, APP_SECRET, NOW).isErr()).toBe(true)
    expect(
      parseSignedRequest(`${signature.slice(0, 10)}.${encodedPayload}`, APP_SECRET, NOW).isErr()
    ).toBe(true)
  })

  it('rejects a signature made with the wrong app secret', () => {
    const { signedRequest } = buildSignedRequest(undefined, 'not-our-secret')
    const result = parseSignedRequest(signedRequest, APP_SECRET, NOW)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('signature mismatch')
  })

  it('rejects a wrong algorithm even when the signature is valid', () => {
    const { signedRequest } = buildSignedRequest({
      algorithm: 'HMAC-SHA1',
      issued_at: NOW - 5,
      user_id: '10175030062710640',
    })
    const result = parseSignedRequest(signedRequest, APP_SECRET, NOW)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('unsupported algorithm')
  })

  it('rejects a stale issued_at and one implausibly in the future', () => {
    const stale = buildSignedRequest({
      algorithm: 'HMAC-SHA256',
      issued_at: NOW - 11 * 60,
      user_id: '10175030062710640',
    })
    expect(
      parseSignedRequest(stale.signedRequest, APP_SECRET, NOW)._unsafeUnwrapErr().message
    ).toContain('too old')

    const future = buildSignedRequest({
      algorithm: 'HMAC-SHA256',
      issued_at: NOW + 60 * 60,
      user_id: '10175030062710640',
    })
    expect(
      parseSignedRequest(future.signedRequest, APP_SECRET, NOW)._unsafeUnwrapErr().message
    ).toContain('in the future')

    // Just inside the window is still accepted.
    const fresh = buildSignedRequest({
      algorithm: 'HMAC-SHA256',
      issued_at: NOW - 9 * 60,
      user_id: '10175030062710640',
    })
    expect(parseSignedRequest(fresh.signedRequest, APP_SECRET, NOW).isOk()).toBe(true)
  })

  it('rejects a missing or non-string user_id', () => {
    const missing = buildSignedRequest({ algorithm: 'HMAC-SHA256', issued_at: NOW - 5 })
    expect(
      parseSignedRequest(missing.signedRequest, APP_SECRET, NOW)._unsafeUnwrapErr().message
    ).toContain('missing user_id')

    const numeric = buildSignedRequest({
      algorithm: 'HMAC-SHA256',
      issued_at: NOW - 5,
      user_id: 10175030062710640,
    })
    expect(parseSignedRequest(numeric.signedRequest, APP_SECRET, NOW).isErr()).toBe(true)
  })

  it('rejects a missing issued_at', () => {
    const { signedRequest } = buildSignedRequest({
      algorithm: 'HMAC-SHA256',
      user_id: '10175030062710640',
    })
    expect(parseSignedRequest(signedRequest, APP_SECRET, NOW)._unsafeUnwrapErr().message).toContain(
      'missing issued_at'
    )
  })

  it('rejects malformed envelopes without throwing', () => {
    const { signature, encodedPayload } = buildSignedRequest()
    const cases: string[] = [
      '',
      'no-dot-at-all',
      `${signature}.${encodedPayload}.extra`,
      `.${encodedPayload}`,
      `${signature}.`,
      '.',
      `${signature}.not+base64url/`,
      `sig with spaces.${encodedPayload}`,
    ]
    for (const input of cases) {
      const result = parseSignedRequest(input, APP_SECRET, NOW)
      expect(result.isErr(), `expected err for ${JSON.stringify(input)}`).toBe(true)
      expect(result._unsafeUnwrapErr().statusCode).toBe(400)
    }
  })

  it('rejects a payload that is valid base64url but not JSON', () => {
    const encoded = Buffer.from('not json at all', 'utf8').toString('base64url')
    const result = parseSignedRequest(`${sign(encoded)}.${encoded}`, APP_SECRET, NOW)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('not JSON')
  })

  it('rejects when no app secret is configured', () => {
    const { signedRequest } = buildSignedRequest()
    expect(parseSignedRequest(signedRequest, '', NOW).isErr()).toBe(true)
  })
})
