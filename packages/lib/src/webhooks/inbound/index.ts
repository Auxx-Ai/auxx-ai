// packages/lib/src/webhooks/inbound/index.ts
// Inbound webhook primitives: one verifier, one secret resolver, shared parse + dedupe,
// and provider presets. All server-only (crypto, redis, credentials).

export { dedupeWebhookEvent } from './dedupe/redis'
export { normalizeHeaders } from './parse/headers'
export {
  fixturePreset,
  mailgunPreset,
  metaPreset,
  openphonePreset,
  recallPreset,
  shopifyPreset,
  stripePreset,
} from './presets'
export { resolveWebhookSecret } from './secret/resolve'
export {
  compileWebhookSpec,
  resolveWebhookActions,
  topicGlob,
  type WebhookSource,
  type WebhookSpec,
  type WebhookSpecHooks,
} from './spec'
export { fixtureSpec, shopifySpec, stripeSpec } from './specs'
export type {
  HmacAlgo,
  HmacEncoding,
  HmacVerifyParams,
  SecretSource,
  WebhookScheme,
  WebhookVerifyPreset,
} from './types'
export {
  parseStripeSigHeader,
  timingSafeStringEqual,
  verifyHmacSignature,
  verifyShopifyAppProxy,
  verifyStripeSignature,
  verifyWebhook,
} from './verify'
