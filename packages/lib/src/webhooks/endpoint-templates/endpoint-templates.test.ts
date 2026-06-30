// packages/lib/src/webhooks/endpoint-templates/endpoint-templates.test.ts

import { describe, expect, it } from 'vitest'
import { metaPreset, shopifyPreset } from '../inbound/presets'
import { getWebhookEndpointTemplate, listWebhookEndpointTemplates } from './queries'
import { webhookEndpointTemplates } from './templates'

const VERIFICATIONS = new Set(['none', 'token', 'hmac', 'stripe'])
const ENCODINGS = new Set(['hex', 'base64'])

describe('webhook endpoint templates', () => {
  it('have unique, non-empty ids and providers', () => {
    const ids = webhookEndpointTemplates.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of webhookEndpointTemplates) {
      expect(t.id).toBeTruthy()
      expect(t.provider).toBeTruthy()
      expect(t.name).toBeTruthy()
    }
  })

  it('use valid verification + encoding values', () => {
    for (const t of webhookEndpointTemplates) {
      expect(VERIFICATIONS.has(t.config.verification)).toBe(true)
      if (t.config.signatureEncoding) {
        expect(ENCODINGS.has(t.config.signatureEncoding)).toBe(true)
      }
    }
  })

  it('declare a topic source whenever they ship topics (service normalizeTopics invariant)', () => {
    for (const t of webhookEndpointTemplates) {
      if (t.topics.length > 0) expect(t.config.topicSource).toBeDefined()
    }
  })

  it('have unique topic keys per template', () => {
    for (const t of webhookEndpointTemplates) {
      const keys = t.topics.map((x) => x.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('derive Shopify/GitHub config from the shared presets (drift guard)', () => {
    const shopify = getWebhookEndpointTemplate('shopify')!
    expect(shopify.config.signatureHeader).toBe(shopifyPreset.header)
    expect(shopify.config.signatureEncoding).toBe(shopifyPreset.encoding)

    const github = getWebhookEndpointTemplate('github')!
    expect(github.config.signatureHeader).toBe(metaPreset.header)
    expect(github.config.signaturePrefix).toBe(metaPreset.prefix)
    expect(github.config.signatureEncoding).toBe(metaPreset.encoding)
  })

  it('ships Stripe as stripe-verification with a path topic source', () => {
    const stripe = getWebhookEndpointTemplate('stripe')!
    expect(stripe.config.verification).toBe('stripe')
    expect(stripe.config.topicSource).toEqual({ kind: 'path', value: 'type' })
  })

  it('marks the blank custom template and omits a topic source', () => {
    const custom = getWebhookEndpointTemplate('custom')!
    expect(custom.blank).toBe(true)
    expect(custom.topics).toHaveLength(0)
  })

  it('list projection carries a topic count and matches the registry size', () => {
    const list = listWebhookEndpointTemplates()
    expect(list).toHaveLength(webhookEndpointTemplates.length)
    const shopify = list.find((t) => t.id === 'shopify')!
    expect(shopify.topicCount).toBe(getWebhookEndpointTemplate('shopify')!.topics.length)
  })

  it('returns null for an unknown template id', () => {
    expect(getWebhookEndpointTemplate('nope')).toBeNull()
  })
})
