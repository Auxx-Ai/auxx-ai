// packages/lib/src/webhooks/inbound/presets.ts
// Provider verification knowledge as data — the seed of the future WebhookSpec.
// One preset per provider; verify logic lives in the shared primitives, never here.

import type { WebhookVerifyPreset } from './types'

/** Shopify webhooks: HMAC-SHA256 over the raw body, base64, in `x-shopify-hmac-sha256`. */
export const shopifyPreset: WebhookVerifyPreset = {
  scheme: 'hmac',
  header: 'x-shopify-hmac-sha256',
  algo: 'sha256',
  encoding: 'base64',
}

/** Stripe webhooks: the `t=,v1=` signature scheme in `stripe-signature`. */
export const stripePreset: WebhookVerifyPreset = {
  scheme: 'stripe-sig',
  header: 'stripe-signature',
}

/** Meta (Facebook / Instagram): HMAC-SHA256 hex, `sha256=`-prefixed, in `x-hub-signature-256`. */
export const metaPreset: WebhookVerifyPreset = {
  scheme: 'hmac',
  header: 'x-hub-signature-256',
  algo: 'sha256',
  encoding: 'hex',
  prefix: 'sha256=',
}

/** OpenPhone webhooks: HMAC-SHA256 hex over the raw body, in `x-openphone-signature`. */
export const openphonePreset: WebhookVerifyPreset = {
  scheme: 'hmac',
  header: 'x-openphone-signature',
  algo: 'sha256',
  encoding: 'hex',
}

/**
 * Mailgun webhooks: HMAC-SHA256 hex over `${timestamp}${token}` (NOT the raw body).
 * Those values arrive as form fields, so the call site builds the signed payload and
 * calls `verifyHmacSignature` directly — this preset records the scheme as data; it is
 * not dispatched through `verifyWebhook` (which signs over the raw body).
 */
export const mailgunPreset: WebhookVerifyPreset = {
  scheme: 'hmac',
  header: 'signature',
  algo: 'sha256',
  encoding: 'hex',
}

/**
 * Recall (Svix) webhooks: HMAC-SHA256 base64 over `${webhook-id}.${webhook-timestamp}.${rawBody}`,
 * with a base64-decoded `whsec_`-stripped key, and `v1,`-prefixed space-separated signatures
 * (key rotation) in `webhook-signature`. The call site supplies the header-derived id/timestamp,
 * loops the candidate signatures, and enforces the timestamp tolerance — so it calls
 * `verifyHmacSignature` directly (`secretEncoding: 'base64'`, `prefix: 'v1,'`) rather than going
 * through `verifyWebhook`. This preset records the scheme as data.
 */
export const recallPreset: WebhookVerifyPreset = {
  scheme: 'hmac',
  header: 'webhook-signature',
  algo: 'sha256',
  encoding: 'base64',
  prefix: 'v1,',
}

/** Provider-neutral fixture: a shared-token compare against `x-fixture-signature`. */
export const fixturePreset: WebhookVerifyPreset = {
  scheme: 'shared-token',
  header: 'x-fixture-signature',
}
