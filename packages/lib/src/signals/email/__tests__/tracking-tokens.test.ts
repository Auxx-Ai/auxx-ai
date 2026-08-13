// packages/lib/src/signals/email/__tests__/tracking-tokens.test.ts

import { API_URL, TRACK_URL } from '@auxx/config/urls'
import { describe, expect, it } from 'vitest'
import { Result } from '../../../result'
import {
  buildClickTrackingUrl,
  buildOpenPixelUrl,
  issueClickToken,
  issueOpenToken,
  verifyClickUrl,
  verifyTrackingToken,
} from '../tracking-tokens'

describe('tracking-tokens', () => {
  it('round-trips an open token', async () => {
    const token = await issueOpenToken({
      organizationId: 'org_1',
      messageId: 'msg_1',
      contactEntityInstanceId: 'contact_1',
      channelId: 'channel_1',
    })

    const result = await verifyTrackingToken(token)
    expect(Result.isOk(result)).toBe(true)
    if (!Result.isOk(result)) return
    expect(result.value).toEqual({
      type: 'open',
      organizationId: 'org_1',
      messageId: 'msg_1',
      contactEntityInstanceId: 'contact_1',
      channelId: 'channel_1',
    })
  })

  it('round-trips a click token, including the url hash', async () => {
    const url = 'https://example.com/product?utm=1'
    const token = await issueClickToken({
      organizationId: 'org_1',
      messageId: 'msg_1',
      url,
    })

    const result = await verifyTrackingToken(token)
    expect(Result.isOk(result)).toBe(true)
    if (!Result.isOk(result)) return
    expect(result.value.type).toBe('click')
    expect(result.value.urlHash).toBeDefined()
    expect(verifyClickUrl(result.value, url)).toBe(true)
  })

  it('omits optional claims from the payload when not provided', async () => {
    const token = await issueOpenToken({ organizationId: 'org_1', messageId: 'msg_1' })
    const result = await verifyTrackingToken(token)
    expect(Result.isOk(result)).toBe(true)
    if (!Result.isOk(result)) return
    expect(result.value.contactEntityInstanceId).toBeUndefined()
    expect(result.value.channelId).toBeUndefined()
  })

  it('fails verification for a tampered token', async () => {
    const token = await issueOpenToken({ organizationId: 'org_1', messageId: 'msg_1' })
    // Flip the FIRST character of the signature segment. The last character
    // carries only 2 significant bits of a 32-byte HS256 signature (43 base64url
    // chars encode 258 bits), so several values there decode to identical bytes
    // and "tampering" with it hands the verifier a still-valid token.
    const [header, payload, signature = ''] = token.split('.')
    const flipped = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`
    const tampered = `${header}.${payload}.${flipped}`

    const result = await verifyTrackingToken(tampered)
    expect(Result.isOk(result)).toBe(false)
  })

  it('fails verification for a token minted with a different scope', async () => {
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode('public-workflow-secret-change-me')
    const wrongScopeToken = await new SignJWT({
      scope: 'email-unsubscribe',
      t: 'o',
      o: 'org_1',
      m: 'msg_1',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .sign(secret)

    const result = await verifyTrackingToken(wrongScopeToken)
    expect(Result.isOk(result)).toBe(false)
  })

  it('rejects a click url that does not match the token hash', async () => {
    const token = await issueClickToken({
      organizationId: 'org_1',
      messageId: 'msg_1',
      url: 'https://example.com/a',
    })
    const result = await verifyTrackingToken(token)
    expect(Result.isOk(result)).toBe(true)
    if (!Result.isOk(result)) return
    expect(verifyClickUrl(result.value, 'https://example.com/b')).toBe(false)
  })

  it('builds the open-pixel and click-tracking URLs off TRACK_URL', () => {
    expect(buildOpenPixelUrl('tok')).toBe(`${TRACK_URL}/t/o/tok`)
    expect(buildClickTrackingUrl('tok', 'https://example.com/x?y=1')).toBe(
      `${TRACK_URL}/t/c/tok?u=${encodeURIComponent('https://example.com/x?y=1')}`
    )
    // Guards against TRACK_URL silently drifting from API_URL in this test env.
    expect(TRACK_URL).toBe(API_URL)
  })
})
