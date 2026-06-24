// packages/lib/src/data-connectors/webhooks/webhook-capability.test.ts
// Pure tests for the provider webhook capabilities (Step 8): signature verification
// (HMAC golden vectors computed the same way the provider does), idempotency-key
// extraction, and delivery → sink-action resolution (upsert vs delete).

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { fixtureWebhookCapability } from './fixture'
import { resolveConnectionWebhookCapability } from './registry'
import { shopifyWebhookCapability } from './shopify'
import { stripeWebhookCapability } from './stripe'

describe('shopify webhook capability', () => {
  const secret = 'shpss_test_secret'

  function sign(rawBody: string): string {
    return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  }

  it('verifies a correct HMAC-SHA256 (base64) and rejects a tampered body', () => {
    const rawBody = JSON.stringify({ id: 123, total_price: '9.99' })
    const headers = { 'x-shopify-hmac-sha256': sign(rawBody) }
    expect(shopifyWebhookCapability.verify({ rawBody, headers, secret })).toBe(true)
    // Tamper: same signature, different body.
    expect(shopifyWebhookCapability.verify({ rawBody: `${rawBody} `, headers, secret })).toBe(false)
    // No secret → never trust.
    expect(shopifyWebhookCapability.verify({ rawBody, headers, secret: null })).toBe(false)
  })

  it('reads the event id from x-shopify-event-id', () => {
    expect(
      shopifyWebhookCapability.eventId({
        rawBody: '{}',
        headers: { 'x-shopify-event-id': 'evt_1' },
      })
    ).toBe('evt_1')
  })

  it('resolves a */delete topic to a delete action on the resource stream', () => {
    const actions = shopifyWebhookCapability.resolveWebhook({
      headers: { 'x-shopify-topic': 'orders/delete' },
      payload: { id: 555 },
    })
    expect(actions).toEqual([{ kind: 'delete', streamKey: 'orders', externalId: '555' }])
  })

  it('resolves a non-delete topic to an upsert of the payload', () => {
    const payload = { id: 777, name: 'Widget' }
    const actions = shopifyWebhookCapability.resolveWebhook({
      headers: { 'x-shopify-topic': 'products/update' },
      payload,
    })
    expect(actions).toEqual([
      {
        kind: 'upsert',
        streamKey: 'products',
        record: { streamKey: 'products', externalId: '777', fields: payload },
      },
    ])
  })
})

describe('stripe webhook capability', () => {
  const secret = 'whsec_test_secret'

  // Use a current timestamp — the shared verifier now enforces Stripe's replay
  // tolerance window (default 300s), so a hardcoded past `t` would be rejected.
  function sign(rawBody: string, t = String(Math.floor(Date.now() / 1000))): string {
    const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex')
    return `t=${t},v1=${v1}`
  }

  it('verifies the Stripe-Signature scheme and rejects a bad signature', () => {
    const rawBody = JSON.stringify({ id: 'evt_1', type: 'customer.updated' })
    const headers = { 'stripe-signature': sign(rawBody) }
    expect(stripeWebhookCapability.verify({ rawBody, headers, secret })).toBe(true)
    expect(
      stripeWebhookCapability.verify({
        rawBody,
        headers: { 'stripe-signature': 't=1,v1=deadbeef' },
        secret,
      })
    ).toBe(false)
  })

  it('reads the event id from the parsed body', () => {
    const rawBody = JSON.stringify({ id: 'evt_42', type: 'customer.created' })
    expect(stripeWebhookCapability.eventId({ rawBody, headers: {} })).toBe('evt_42')
  })

  it('resolves *.deleted to a delete and other events to an upsert', () => {
    const del = stripeWebhookCapability.resolveWebhook({
      headers: {},
      payload: { type: 'customer.deleted', data: { object: { id: 'cus_1', object: 'customer' } } },
    })
    expect(del).toEqual([{ kind: 'delete', streamKey: 'customer', externalId: 'cus_1' }])

    const up = stripeWebhookCapability.resolveWebhook({
      headers: {},
      payload: {
        type: 'customer.updated',
        data: { object: { id: 'cus_2', object: 'customer', email: 'a@b.c' } },
      },
    })
    expect(up[0]).toMatchObject({
      kind: 'upsert',
      streamKey: 'customer',
      record: { externalId: 'cus_2' },
    })
  })
})

describe('fixture webhook capability', () => {
  it('verifies the secret header and resolves upsert/delete', () => {
    expect(
      fixtureWebhookCapability.verify({
        rawBody: '{}',
        headers: { 'x-fixture-signature': 's' },
        secret: 's',
      })
    ).toBe(true)
    expect(
      fixtureWebhookCapability.verify({
        rawBody: '{}',
        headers: { 'x-fixture-signature': 'x' },
        secret: 's',
      })
    ).toBe(false)

    expect(
      fixtureWebhookCapability.resolveWebhook({
        headers: {},
        payload: { streamKey: 's1', externalId: 'e1', fields: { a: 1 } },
      })
    ).toEqual([
      {
        kind: 'upsert',
        streamKey: 's1',
        record: { streamKey: 's1', externalId: 'e1', displayName: undefined, fields: { a: 1 } },
      },
    ])
    expect(
      fixtureWebhookCapability.resolveWebhook({
        headers: {},
        payload: { streamKey: 's1', externalId: 'e1', deleted: true },
      })
    ).toEqual([{ kind: 'delete', streamKey: 's1', externalId: 'e1' }])
  })

  it('round-trips registration to a deterministic subscription', async () => {
    const subs = await fixtureWebhookCapability.register({
      callbackUrl: 'https://x/y',
      secret: 's',
      topics: ['fixture/upsert'],
      credential: null,
      config: {},
    })
    expect(subs).toEqual([{ topic: 'fixture/upsert', externalId: 'fixture-sub:fixture/upsert' }])
  })
})

describe('resolveTopic — the same source sink resolution reads', () => {
  it('reads the Shopify topic from the x-shopify-topic header', () => {
    expect(
      shopifyWebhookCapability.resolveTopic({
        headers: { 'x-shopify-topic': 'orders/create' },
        payload: { id: 1 },
      })
    ).toBe('orders/create')
  })

  it('reads the Stripe topic from the body type', () => {
    expect(
      stripeWebhookCapability.resolveTopic({
        headers: {},
        payload: { type: 'customer.updated', data: { object: { id: 'cus_1' } } },
      })
    ).toBe('customer.updated')
  })

  it('reads the fixture topic from the self-describing body', () => {
    expect(
      fixtureWebhookCapability.resolveTopic({
        headers: {},
        payload: { topic: 'fixture/upsert', streamKey: 's1', externalId: 'e1' },
      })
    ).toBe('fixture/upsert')
  })
})

describe('resolveConnectionWebhookCapability — keyed off the connection provider', () => {
  it('maps a connection provider (Credential.type) to its driver', () => {
    expect(resolveConnectionWebhookCapability({ type: 'shopify' })).toBe(shopifyWebhookCapability)
    expect(resolveConnectionWebhookCapability({ type: 'stripe' })).toBe(stripeWebhookCapability)
    expect(resolveConnectionWebhookCapability({ type: 'fixture' })).toBe(fixtureWebhookCapability)
  })

  it('returns null for a provider with no WebhookSpec (the v1 boundary)', () => {
    expect(resolveConnectionWebhookCapability({ type: 'gmail' })).toBeNull()
    expect(resolveConnectionWebhookCapability({ type: null })).toBeNull()
    expect(resolveConnectionWebhookCapability({})).toBeNull()
  })
})
