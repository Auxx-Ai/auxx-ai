// packages/database/src/db/schema/webhook-endpoint.ts
// Drizzle table: WebhookEndpoint — provider-agnostic INBOUND webhook URLs.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp } from './_shared'
import { Organization } from './organization'
import { User } from './user'

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
