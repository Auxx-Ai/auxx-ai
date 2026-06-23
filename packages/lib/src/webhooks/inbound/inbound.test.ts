// packages/lib/src/webhooks/inbound/inbound.test.ts
// Golden-vector tests for the shared inbound webhook primitives. Each scheme is signed
// the same way its provider does, then verified; tampered bodies, wrong secrets, and
// length mismatches must return false (never throw); the Stripe tolerance window must
// reject a stale timestamp.

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { fixturePreset, metaPreset, openphonePreset, shopifyPreset, stripePreset } from './presets'
import {
  timingSafeStringEqual,
  verifyHmacSignature,
  verifyShopifyAppProxy,
  verifyStripeSignature,
  verifyWebhook,
} from './verify'

describe('timingSafeStringEqual', () => {
  it('matches equal strings and rejects mismatched/unequal-length without throwing', () => {
    expect(timingSafeStringEqual('abc', 'abc')).toBe(true)
    expect(timingSafeStringEqual('abc', 'abd')).toBe(false)
    expect(timingSafeStringEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeStringEqual('', '')).toBe(true)
  })
})

describe('verifyHmacSignature', () => {
  const secret = 'sekret'

  it('verifies base64 (Shopify-style) and rejects a tampered body', () => {
    const rawBody = '{"id":1}'
    const sig = createHmac('sha256', secret).update(rawBody).digest('base64')
    expect(verifyHmacSignature({ rawBody, signature: sig, secret })).toBe(true)
    expect(verifyHmacSignature({ rawBody: `${rawBody} `, signature: sig, secret })).toBe(false)
    expect(verifyHmacSignature({ rawBody, signature: sig, secret: 'wrong' })).toBe(false)
    expect(verifyHmacSignature({ rawBody, signature: '', secret })).toBe(false)
    expect(verifyHmacSignature({ rawBody, signature: sig, secret: '' })).toBe(false)
  })

  it('verifies hex with a stripped prefix (Meta-style)', () => {
    const rawBody = '{"object":"page"}'
    const hex = createHmac('sha256', secret).update(rawBody).digest('hex')
    expect(
      verifyHmacSignature({
        rawBody,
        signature: `sha256=${hex}`,
        secret,
        encoding: 'hex',
        prefix: 'sha256=',
      })
    ).toBe(true)
    // No prefix on the wire → mismatch (matches the old `!== sha256=...` behavior).
    expect(
      verifyHmacSignature({ rawBody, signature: hex, secret, encoding: 'hex', prefix: 'sha256=' })
    ).toBe(false)
  })

  it('signs a custom payload (Mailgun ts+token) over hex', () => {
    const timestamp = '1700000000'
    const token = 'tok_abc'
    const sig = createHmac('sha256', secret).update(`${timestamp}${token}`).digest('hex')
    expect(
      verifyHmacSignature({
        rawBody: '',
        signature: sig,
        secret,
        encoding: 'hex',
        signedPayload: () => `${timestamp}${token}`,
      })
    ).toBe(true)
  })

  it('decodes a base64 secret key (Svix/Recall-style)', () => {
    const keyB64 = Buffer.from('raw-key-bytes').toString('base64')
    const id = 'msg_1'
    const ts = '1700000000'
    const rawBody = '{"event":"x"}'
    const expected = createHmac('sha256', Buffer.from(keyB64, 'base64'))
      .update(`${id}.${ts}.${rawBody}`)
      .digest('base64')
    expect(
      verifyHmacSignature({
        rawBody,
        signature: `v1,${expected}`,
        secret: keyB64,
        secretEncoding: 'base64',
        prefix: 'v1,',
        signedPayload: () => `${id}.${ts}.${rawBody}`,
      })
    ).toBe(true)
  })
})

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret'

  function header(rawBody: string, t = Math.floor(Date.now() / 1000)): string {
    const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
    return `t=${t},v1=${v1}`
  }

  it('verifies a fresh signature and rejects a bad one', () => {
    const rawBody = '{"id":"evt_1"}'
    expect(verifyStripeSignature({ rawBody, header: header(rawBody), secret })).toBe(true)
    expect(verifyStripeSignature({ rawBody, header: 't=1,v1=deadbeef', secret })).toBe(false)
    expect(verifyStripeSignature({ rawBody, header: '', secret })).toBe(false)
  })

  it('enforces the timestamp tolerance window (replay protection / SDK parity)', () => {
    const rawBody = '{"id":"evt_2"}'
    const stale = Math.floor(Date.now() / 1000) - 10_000
    expect(verifyStripeSignature({ rawBody, header: header(rawBody, stale), secret })).toBe(false)
    // A wider tolerance accepts the same stale signature.
    expect(
      verifyStripeSignature({
        rawBody,
        header: header(rawBody, stale),
        secret,
        toleranceSec: 20_000,
      })
    ).toBe(true)
  })
})

describe('verifyShopifyAppProxy', () => {
  const secret = 'app_secret'

  it('verifies sorted-query-param HMAC and rejects a tampered param', () => {
    const params = new URLSearchParams({ shop: 'x.myshopify.com', channel_id: 'c1' })
    const sorted = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('')
    const sig = createHmac('sha256', secret).update(sorted).digest('hex')
    params.set('signature', sig)
    expect(verifyShopifyAppProxy(params, secret)).toBe(true)

    params.set('shop', 'evil.myshopify.com')
    expect(verifyShopifyAppProxy(params, secret)).toBe(false)
  })

  it('rejects a missing signature or secret', () => {
    expect(verifyShopifyAppProxy(new URLSearchParams({ shop: 'x' }), secret)).toBe(false)
    expect(verifyShopifyAppProxy(new URLSearchParams({ signature: 'a' }), '')).toBe(false)
  })
})

describe('verifyWebhook dispatcher', () => {
  it('shopify preset (hmac base64)', () => {
    const secret = 'shpss'
    const rawBody = '{"id":7}'
    const headers = {
      'x-shopify-hmac-sha256': createHmac('sha256', secret).update(rawBody).digest('base64'),
    }
    expect(verifyWebhook(shopifyPreset, { rawBody, headers, secret })).toBe(true)
    expect(verifyWebhook(shopifyPreset, { rawBody, headers, secret: null })).toBe(false)
  })

  it('meta preset (hmac hex + prefix)', () => {
    const secret = 'fbsecret'
    const rawBody = '{"object":"instagram"}'
    const headers = {
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
    }
    expect(verifyWebhook(metaPreset, { rawBody, headers, secret })).toBe(true)
    expect(verifyWebhook(metaPreset, { rawBody: 'tampered', headers, secret })).toBe(false)
  })

  it('openphone preset (hmac hex) — length mismatch returns false, not a throw', () => {
    const secret = 'opsecret'
    const rawBody = '{"type":"message.received"}'
    const headers = {
      'x-openphone-signature': createHmac('sha256', secret).update(rawBody).digest('hex'),
    }
    expect(verifyWebhook(openphonePreset, { rawBody, headers, secret })).toBe(true)
    expect(
      verifyWebhook(openphonePreset, {
        rawBody,
        headers: { 'x-openphone-signature': 'short' },
        secret,
      })
    ).toBe(false)
  })

  it('stripe preset routes to the stripe-sig verifier', () => {
    const secret = 'whsec_x'
    const rawBody = '{"id":"evt"}'
    const t = Math.floor(Date.now() / 1000)
    const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
    const headers = { 'stripe-signature': `t=${t},v1=${v1}` }
    expect(verifyWebhook(stripePreset, { rawBody, headers, secret })).toBe(true)
  })

  it('fixture preset (shared token)', () => {
    expect(
      verifyWebhook(fixturePreset, {
        rawBody: '',
        headers: { 'x-fixture-signature': 's' },
        secret: 's',
      })
    ).toBe(true)
    expect(
      verifyWebhook(fixturePreset, {
        rawBody: '',
        headers: { 'x-fixture-signature': 'x' },
        secret: 's',
      })
    ).toBe(false)
  })
})
