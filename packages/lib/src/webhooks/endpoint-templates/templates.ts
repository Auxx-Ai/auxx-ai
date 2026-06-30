// packages/lib/src/webhooks/endpoint-templates/templates.ts
// The predefined webhook-endpoint templates. Verification config is derived from the
// shared `inbound/presets.ts` (the single source of truth for header/encoding/prefix) so
// the two never drift. Topic schemas are hand-authored snapshots of one delivery's common
// shape — the endpoint's Topics page still lets users capture exact schemas live.

import { metaPreset, shopifyPreset } from '../inbound/presets'
import type { WebhookEndpointTemplate, WebhookTemplateTopic } from './types'

/** A minimal JSON-Schema object for a topic payload. */
function obj(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties }
}

const str = { type: 'string' }
const num = { type: 'number' }
const bool = { type: 'boolean' }

/** Shorthand to author a curated topic with a manual schema. */
function topic(key: string, name: string, schema: Record<string, unknown>): WebhookTemplateTopic {
  return { key, name, schema, schemaSource: 'manual' }
}

// ── Shopify ────────────────────────────────────────────────────────────────
// HMAC-SHA256 base64 in `x-shopify-hmac-sha256`; topic in the `x-shopify-topic` header.
const shopifyOrder = obj({
  id: num,
  name: str,
  email: str,
  financial_status: str,
  fulfillment_status: str,
  total_price: str,
  currency: str,
  created_at: str,
})
const shopifyCustomer = obj({
  id: num,
  email: str,
  first_name: str,
  last_name: str,
  phone: str,
  state: str,
  total_spent: str,
  created_at: str,
})

const shopify: WebhookEndpointTemplate = {
  id: 'shopify',
  provider: 'shopify',
  name: 'Shopify',
  description: 'Orders, customers, and products from a Shopify store.',
  categories: ['e-commerce'],
  icon: 'brand:shopify',
  color: 'green',
  config: {
    verification: 'hmac',
    signatureHeader: shopifyPreset.header,
    signatureEncoding: shopifyPreset.encoding ?? 'base64',
    topicSource: { kind: 'header', value: 'x-shopify-topic' },
  },
  topics: [
    topic('orders/create', 'Order created', shopifyOrder),
    topic('orders/updated', 'Order updated', shopifyOrder),
    topic('orders/cancelled', 'Order cancelled', shopifyOrder),
    topic('customers/create', 'Customer created', shopifyCustomer),
    topic('customers/update', 'Customer updated', shopifyCustomer),
    topic(
      'products/update',
      'Product updated',
      obj({ id: num, title: str, handle: str, status: str, vendor: str, updated_at: str })
    ),
    topic('app/uninstalled', 'App uninstalled', obj({ id: num, name: str, domain: str })),
  ],
}

// ── Stripe ───────────────────────────────────────────────────────────────────
// `Stripe-Signature: t=,v1=` over `${t}.${rawBody}` — the dedicated `stripe-sig` scheme.
// The signing secret (`whsec_…`) is minted by Stripe and pasted into Auxx. Topic = `type`.
const stripeEventEnvelope = (dataObject: Record<string, unknown>) =>
  obj({
    id: str,
    type: str,
    created: num,
    livemode: bool,
    data: obj({ object: dataObject }),
  })

const stripe: WebhookEndpointTemplate = {
  id: 'stripe',
  provider: 'stripe',
  name: 'Stripe',
  description: 'Payments, charges, checkout, and subscription events.',
  categories: ['payments'],
  icon: 'brand:stripe',
  color: 'purple',
  config: {
    verification: 'stripe',
    topicSource: { kind: 'path', value: 'type' },
  },
  note: 'Paste your Stripe webhook signing secret (starts with whsec_) — Stripe generates it when you add the endpoint in the Stripe dashboard.',
  topics: [
    topic(
      'payment_intent.succeeded',
      'Payment succeeded',
      stripeEventEnvelope({ id: str, amount: num, currency: str, status: str, customer: str })
    ),
    topic(
      'payment_intent.payment_failed',
      'Payment failed',
      stripeEventEnvelope({ id: str, amount: num, currency: str, status: str, customer: str })
    ),
    topic(
      'charge.refunded',
      'Charge refunded',
      stripeEventEnvelope({ id: str, amount: num, amount_refunded: num, currency: str })
    ),
    topic(
      'checkout.session.completed',
      'Checkout completed',
      stripeEventEnvelope({ id: str, customer: str, amount_total: num, currency: str, mode: str })
    ),
    topic(
      'customer.subscription.created',
      'Subscription created',
      stripeEventEnvelope({ id: str, customer: str, status: str, current_period_end: num })
    ),
    topic(
      'customer.subscription.deleted',
      'Subscription deleted',
      stripeEventEnvelope({ id: str, customer: str, status: str, canceled_at: num })
    ),
    topic(
      'invoice.payment_failed',
      'Invoice payment failed',
      stripeEventEnvelope({ id: str, customer: str, amount_due: num, currency: str })
    ),
  ],
}

// ── GitHub ─────────────────────────────────────────────────────────────────
// HMAC-SHA256 hex, `sha256=`-prefixed, in `x-hub-signature-256` (same scheme as Meta).
// Topic in the `x-github-event` header.
const github: WebhookEndpointTemplate = {
  id: 'github',
  provider: 'github',
  name: 'GitHub',
  description: 'Repository pushes, pull requests, issues, and releases.',
  categories: ['developer'],
  icon: 'brand:github',
  color: 'slate',
  config: {
    verification: 'hmac',
    signatureHeader: metaPreset.header,
    signaturePrefix: metaPreset.prefix,
    signatureEncoding: metaPreset.encoding ?? 'hex',
    topicSource: { kind: 'header', value: 'x-github-event' },
  },
  topics: [
    topic(
      'push',
      'Push',
      obj({ ref: str, before: str, after: str, repository: obj({ full_name: str }) })
    ),
    topic(
      'pull_request',
      'Pull request',
      obj({ action: str, number: num, pull_request: obj({ title: str, state: str, merged: bool }) })
    ),
    topic(
      'issues',
      'Issue',
      obj({ action: str, issue: obj({ number: num, title: str, state: str }) })
    ),
    topic(
      'issue_comment',
      'Issue comment',
      obj({ action: str, comment: obj({ body: str }), issue: obj({ number: num }) })
    ),
    topic(
      'release',
      'Release',
      obj({ action: str, release: obj({ tag_name: str, name: str, draft: bool }) })
    ),
    topic(
      'workflow_run',
      'Workflow run',
      obj({ action: str, workflow_run: obj({ name: str, status: str, conclusion: str }) })
    ),
  ],
}

// ── Custom ───────────────────────────────────────────────────────────────────
// "Start from scratch" — opens the configure form with no prefill.
const custom: WebhookEndpointTemplate = {
  id: 'custom',
  provider: 'custom',
  name: 'Start from scratch',
  description: 'Configure an endpoint for any system manually.',
  categories: ['custom'],
  icon: 'webhook',
  color: 'gray',
  blank: true,
  config: { verification: 'hmac' },
  topics: [],
}

// "Start from scratch" leads; branded providers follow.
export const webhookEndpointTemplates: WebhookEndpointTemplate[] = [custom, shopify, stripe, github]
