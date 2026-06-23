// packages/lib/src/webhooks/inbound/types.ts
// Shared types for the inbound webhook primitives (verify / secret / parse / dedupe).
// These are the seed of the future declarative WebhookSpec — providers are described
// as DATA (scheme + header + encoding), never as bespoke verify logic.

/** HMAC digest algorithm a provider signs with. */
export type HmacAlgo = 'sha256' | 'sha1'

/** Wire encoding of the HMAC digest a provider compares against. */
export type HmacEncoding = 'base64' | 'hex'

/** Parameters for the one parametric, timing-safe HMAC verifier. */
export interface HmacVerifyParams {
  /** The RAW request bytes (HMAC is never computed over re-serialized JSON). */
  rawBody: string
  /** The provided signature header value (prefix is stripped here if `prefix` is set). */
  signature: string
  /** The signing secret. Interpreted per {@link HmacVerifyParams.secretEncoding}. */
  secret: string
  /** Digest algorithm. Default `'sha256'`. */
  algo?: HmacAlgo
  /** Digest encoding. Default `'base64'`. */
  encoding?: HmacEncoding
  /** Builds the signed message from the raw body. Default identity (sign the raw body). */
  signedPayload?: (rawBody: string) => string
  /** Header prefix to strip before compare, e.g. `'sha256='` (Meta) or `'v1,'` (Svix). */
  prefix?: string
  /**
   * How `secret` is decoded into the HMAC key. `'utf8'` (default) uses the string
   * bytes; `'base64'` decodes it first (Svix/Recall keys are base64 after `whsec_`).
   */
  secretEncoding?: 'utf8' | 'base64'
}

/**
 * Verification scheme a provider preset uses. App-proxy (Shopify storefront proxy)
 * verifies over sorted query params rather than headers/body, so it is NOT dispatched
 * through {@link WebhookVerifyPreset}; call `verifyShopifyAppProxy` directly.
 */
export type WebhookScheme = 'hmac' | 'stripe-sig' | 'shared-token'

/** A provider's verification knowledge as data — the unit `verifyWebhook` dispatches on. */
export interface WebhookVerifyPreset {
  scheme: WebhookScheme
  /** Lowercased header carrying the signature (hmac/stripe-sig) or token (shared-token). */
  header: string
  /** hmac only — digest algorithm. Default `'sha256'`. */
  algo?: HmacAlgo
  /** hmac only — digest encoding. Default `'base64'`. */
  encoding?: HmacEncoding
  /** hmac only — header prefix to strip before compare (Meta `'sha256='`). */
  prefix?: string
  /** hmac only — builds the signed message from the raw body. Default identity. */
  signedPayload?: (rawBody: string) => string
  /** stripe-sig only — replay tolerance window in seconds. Default 300. */
  toleranceSec?: number
}

/**
 * Where a webhook signing secret lives. One read interface over the stores secrets
 * use today — we unify the READ, not the location (storage migration is out of scope).
 */
export type SecretSource =
  /** Process env via configService (Shopify `SHOPIFY_API_SECRET`, Meta `FACEBOOK_APP_SECRET`). */
  | { kind: 'env'; key: string }
  /** The connector's `AppWebhookHandler.metadata` `{ secret }` JSON blob. */
  | { kind: 'handlerMetadata'; metadata: string | null }
  /** An encrypted Credential field (OpenPhone `webhookSigningSecret`). */
  | { kind: 'credentialField'; credentialId: string; organizationId: string; field: string }
