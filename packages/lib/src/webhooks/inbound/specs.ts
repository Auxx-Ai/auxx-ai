// packages/lib/src/webhooks/inbound/specs.ts
// Per-provider WebhookSpecs — the read-path (verify / event-id / topic→action) as data.
// Each spec is exactly the column of behavior the old hand-written driver implemented;
// the driver now compiles this with `compileWebhookSpec` + its coded registration hooks.

import { fixturePreset, shopifyPreset, stripePreset } from './presets'
import type { WebhookSpec } from './spec'

/**
 * Shopify: HMAC base64 verify, `x-shopify-event-id` idempotency, topic from
 * `x-shopify-topic`. A topic is `<resource>/<verb>` — the stream key is the resource
 * (first segment) and a `*​/delete` verb archives by the payload `id`.
 */
export const shopifySpec: WebhookSpec = {
  verify: shopifyPreset,
  eventId: { from: 'header', name: 'x-shopify-event-id' },
  resolve: {
    topic: { from: 'header', name: 'x-shopify-topic' },
    streamKey: { from: 'topicSegment', index: 0 },
    externalId: { from: 'body', path: 'id' },
    fields: { from: 'body', path: '' }, // the whole payload
    deleteWhen: { topicMatches: '*/delete' },
  },
}

/**
 * Stripe: the `t=,v1=` signature verify, event `id` from the body, topic from the event
 * `type`. The stream key is the object name (`data.object.object`), falling back to the
 * first `type` segment; `*.deleted` types archive. Upserts sink `data.object`.
 */
export const stripeSpec: WebhookSpec = {
  verify: stripePreset,
  eventId: { from: 'body', path: 'id' },
  resolve: {
    topic: { from: 'body', path: 'type' },
    streamKey: {
      from: 'body',
      path: 'data.object.object',
      fallback: { from: 'topicSegment', index: 0, separator: '.' },
      default: 'event',
    },
    externalId: { from: 'body', path: 'data.object.id' },
    fields: { from: 'body', path: 'data.object' },
    deleteWhen: { topicMatches: '*.deleted' },
  },
}

/**
 * Provider-neutral fixture: a shared-token verify (or unsigned in tests) over a
 * self-describing payload that already carries `streamKey` / `externalId` / `deleted`.
 */
export const fixtureSpec: WebhookSpec = {
  verify: fixturePreset,
  unsignedOk: true,
  eventId: { from: 'header', name: 'x-fixture-event-id' },
  resolve: {
    topic: { from: 'body', path: 'topic' },
    streamKey: { from: 'body', path: 'streamKey' },
    externalId: { from: 'body', path: 'externalId' },
    fields: { from: 'body', path: 'fields' },
    displayName: { from: 'body', path: 'displayName' },
    deleteWhen: { bodyFlag: { path: 'deleted' } },
  },
}
