// packages/lib/src/webhooks/endpoint-templates/types.ts
// Types for the predefined webhook-endpoint templates surfaced in the "Add endpoint"
// gallery. Pure data — no DB, no tRPC. A template prefills the endpoint configure form
// (verification + topic source) and seeds a curated set of topics with payload schemas.

import type { WebhookEndpointTopic } from '@auxx/database/types'

/** Gallery sidebar category. `'all'` is injected by the dialog's category constant. */
export type WebhookTemplateCategory = 'e-commerce' | 'payments' | 'developer' | 'custom'

/**
 * A curated topic in a template — the runtime {@link WebhookEndpointTopic} minus the
 * minted `id` (the install path stamps a fresh id via `generateId`).
 */
export type WebhookTemplateTopic = Omit<WebhookEndpointTopic, 'id'>

/** Prefill for the endpoint configure form. */
export interface WebhookTemplateConfig {
  /** `stripe` uses the dedicated `stripe-sig` scheme (header implied, secret pasted). */
  verification: 'none' | 'token' | 'hmac' | 'stripe'
  /** hmac only — signature header (e.g. `x-shopify-hmac-sha256`). */
  signatureHeader?: string
  /** hmac only — fixed prefix to strip (e.g. `sha256=`). */
  signaturePrefix?: string
  /** hmac only — digest encoding. */
  signatureEncoding?: 'hex' | 'base64'
  /** Optional topic extraction so one endpoint can multiplex (Stripe `type`, GitHub event header). */
  topicSource?: { kind: 'header' | 'path'; value: string }
}

/** One predefined webhook-endpoint template. */
export interface WebhookEndpointTemplate {
  /** Stable slug = the persisted `provider` value: 'shopify' | 'stripe' | 'github' | 'custom'. */
  id: string
  /** Persisted on `WebhookEndpoint.provider` for card branding + edit identity. */
  provider: string
  name: string
  description: string
  categories: WebhookTemplateCategory[]
  /** EntityIcon iconId, rendered in the gallery row + endpoint card. */
  icon: string
  /** Color id from the EntityIcon palette. */
  color: string
  /** Form prefill. */
  config: WebhookTemplateConfig
  /** Curated topics, each with an optional hand-authored JSON Schema for one delivery. */
  topics: WebhookTemplateTopic[]
  /** Optional detail-page callout (setup hint). */
  note?: string
  /** Blank "start from scratch" entry — opens an empty configure form. */
  blank?: boolean
}

/** List projection for the gallery — omits the heavy config/topics payload. */
export interface WebhookTemplateSummary {
  id: string
  provider: string
  name: string
  description: string
  categories: WebhookTemplateCategory[]
  icon: string
  color: string
  topicCount: number
  blank?: boolean
}
