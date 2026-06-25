// packages/database/src/db/schema/webhook-endpoint.ts
// Drizzle table: WebhookEndpoint — provider-agnostic INBOUND webhook URLs.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp } from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * One declared topic an endpoint can emit. `key` is the matcher — it equals the
 * string the endpoint's `topicSource` extracts from a delivery, so consuming
 * surfaces store that exact value. The schema (when present) describes one
 * delivery's payload, inferred from a captured delivery or hand-authored.
 */
export interface WebhookEndpointTopic {
  /** Stable entry id (createId) — survives renames; identity for edit/delete. */
  id: string
  /** The matched topic value (equals the string `topicSource` extracts). */
  key: string
  /** Optional friendly label; defaults to `key` in the UI. */
  name?: string
  /** JSON Schema for one delivery's payload. Absent ⇒ shape not captured yet. */
  schema?: Record<string, unknown>
  /** Provenance of `schema`. Absent when there's no schema. */
  schemaSource?: 'inferred' | 'manual'
  /** The inspector `eventId` an inferred schema came from (provenance/debug). */
  sampleEventId?: string
}

/**
 * An org-scoped INBOUND webhook endpoint: a user-created URL that external
 * systems POST to. Bound to nothing (no app, no connection) — the id IS the
 * capability. Distinct from the OUTBOUND `Webhook` table (Auxx → other apps).
 *
 * Public URL is derived, never stored: `${API_BASE}/webhooks/endpoint/${id}`.
 */
export const WebhookEndpoint = pgTable(
  'WebhookEndpoint',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** User-facing label, e.g. "Typeform leads". */
    name: text().notNull(),
    /** How inbound deliveries are verified. */
    verification: text().$type<'none' | 'token' | 'hmac'>().default('hmac').notNull(),
    /**
     * AES-256-GCM at rest (@auxx/credentials secret-box, `v2:` format); decrypted
     * at verify. HMAC key or bearer token. Null for `verification: 'none'`.
     */
    secret: text(),
    /** hmac: header carrying the signature (e.g. 'x-hub-signature-256'). */
    signatureHeader: text(),
    /** hmac: optional prefix to strip from the signature (e.g. 'sha256='). */
    signaturePrefix: text(),
    /** hmac: digest encoding — 'hex' (GitHub/Stripe) or 'base64' (Shopify-style). */
    signatureEncoding: text().$type<'hex' | 'base64'>().default('hex').notNull(),
    /**
     * Optional topic extraction so ONE endpoint can multiplex (Stripe `type`,
     * GitHub event header). Absent ⇒ every delivery matches.
     */
    topicSource: jsonb().$type<{ kind: 'header' | 'path'; value: string }>(),
    /**
     * Optional catalog of the distinct topics this endpoint emits (the values its
     * `topicSource` extracts, e.g. Stripe `payment_intent.succeeded`). Each may carry
     * a JSON Schema describing one delivery's payload, authored from a captured live
     * delivery or by hand. Drives the topic picker in consuming surfaces (agent
     * triggers, data-connector stream bindings, workflow nodes); the schema is stored
     * for later field-binding. Empty ⇒ free-form topics, as before.
     */
    topics: jsonb().$type<WebhookEndpointTopic[]>().default([]).notNull(),
    /** Liveness — point write on each delivery (mirrors DataConnector.lastWebhookEventAt). */
    lastEventAt: timestamp({ precision: 3 }),
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('WebhookEndpoint_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
  ]
)

export type WebhookEndpointEntity = typeof WebhookEndpoint.$inferSelect
export type CreateWebhookEndpointInput = typeof WebhookEndpoint.$inferInsert
export type UpdateWebhookEndpointInput = Partial<CreateWebhookEndpointInput>
