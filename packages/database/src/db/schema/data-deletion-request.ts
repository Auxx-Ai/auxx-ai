// packages/database/src/db/schema/data-deletion-request.ts
// Drizzle table: DataDeletionRequest — the durable audit trail behind the provider
// data-deletion / deauthorize callbacks (Meta signed_request today, Shopify
// customers/redact + shop/redact on the same module).
// See plans/channels/meta-data-deletion-callback.md §4.1.

import { createId } from '@paralleldrive/cuid2'
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from './_shared'

/**
 * One deletion/deauthorize request received from a provider.
 *
 * Deliberately has NO `organizationId` column and NO FK to `Organization`: a request
 * arrives before we know which orgs it touches, may touch several (one Facebook login
 * administering Pages in two orgs), and must survive the org being deleted — that is the
 * whole point of an audit trail.
 *
 * Not Redis: Shopify's obligation is *demonstrable* redaction within 30 days, the status
 * URL is a cold read, and a Redis flush would silently void every outstanding confirmation
 * code that Meta's contract says stays resolvable.
 */
export const DataDeletionRequest = pgTable(
  'DataDeletionRequest',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    /** Public, alphanumeric, returned to Meta and used in the status URL. Not the pk. */
    confirmationCode: text().notNull(),
    provider: text().$type<'facebook' | 'instagram' | 'shopify'>().notNull(),
    /** Meta app-scoped user id, or Shopify shop domain / customer id. */
    externalId: text().notNull(),
    /** Which contract fired. Drives what the job does. */
    kind: text()
      .$type<
        | 'data_deletion'
        | 'deauthorize'
        | 'customer_redact'
        | 'shop_redact'
        | 'customer_data_request'
      >()
      .notNull(),
    status: text()
      .$type<'received' | 'processing' | 'completed' | 'failed'>()
      .default('received')
      .notNull(),
    /** Orgs touched — may stay empty because we may resolve nothing (already gone). */
    organizationIds: jsonb().$type<string[]>().default([]).notNull(),
    /** Integration ids actually torn down. Audit trail; small by construction. */
    integrationIds: jsonb().$type<string[]>().default([]).notNull(),
    error: text(),
    receivedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    completedAt: timestamp({ precision: 3 }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // The status-page lookup: one code, one row.
    uniqueIndex('DataDeletionRequest_confirmationCode_idx').using(
      'btree',
      table.confirmationCode.asc().nullsLast()
    ),
    // "What have we already done for this external id?"
    index('DataDeletionRequest_provider_externalId_idx').using(
      'btree',
      table.provider.asc().nullsLast(),
      table.externalId.asc().nullsLast()
    ),
  ]
)

/** Selected DataDeletionRequest entity type */
export type DataDeletionRequestEntity = typeof DataDeletionRequest.$inferSelect
