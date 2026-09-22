// packages/database/src/db/schema/export-batch.ts
// One export batch is one provider object: a frozen payload, the provider's id
// for it, its state, and the detail postings it rolls up. In Transaction mode a
// batch holds exactly one posting. See plans/accounting/TARGET.md §3.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from './_shared'
import { ExternalAccountingBook } from './external-accounting-book'
import { ExternalBookConnection } from './external-book-connection'
import { GlPosting } from './gl-posting'
import { Organization } from './organization'

/**
 * `ready → sending → sent`, `sending → failed → ready` on retry, and
 * `sent → withdrawn` on a rollback. `withdrawn` is terminal; the next build
 * makes a new batch out of the freed postings.
 */
export const EXPORT_BATCH_STATES = ['ready', 'sending', 'sent', 'failed', 'withdrawn'] as const

export const ExportBatch = pgTable(
  'ExportBatch',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    bookId: text().notNull(),
    connectionId: text().notNull(),
    /** Which export mode built this batch. A mode switch leaves earlier batches alone. */
    mode: text().notNull().$type<'transaction' | 'summary'>(),
    /** The posting type's export lane — `avenueOfPostingType` in `postings/export-settings.ts`. */
    avenue: text().notNull(),
    /** `'2026-09-14'`, `'2026-09'`, or the single posting id in Transaction mode. */
    grainKey: text().notNull(),
    storeId: text(),
    railId: text(),
    currency: text().notNull(),
    /** A plain namespaced string, not a DB enum: step 4 adds object types without a migration. */
    objectType: text().notNull(),
    /** Provider-neutral, frozen at build time and never rebuilt in place. */
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    payloadHash: text().notNull(),
    state: text().notNull().$type<(typeof EXPORT_BATCH_STATES)[number]>().default('ready'),
    providerObjectId: text(),
    /** The provider's optimistic-concurrency token; a withdrawal needs the current one. */
    providerSyncToken: text(),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }),
    leaseToken: text(),
    leaseExpiresAt: timestamp({ withTimezone: true }),
    lastError: text(),
    /** The adapter's own verdict on the last refusal; null on a thrown error or before any send. */
    failureClass: text().$type<'configuration' | 'data' | 'transport'>(),
    /** The refusal as pieces of work (`ExportFailureItem` in `@auxx/lib/accounting/export/client`). */
    failureItems:
      jsonb().$type<
        Array<{
          key: 'unmapped_account' | 'invalid_mapping'
          ref: string
          label: string
          remedy: string
        }>
      >(),
    /** Both totals of the rolled-up postings, integer minor units. */
    totalMinor: bigint({ mode: 'number' }).notNull().default(0),
    sentAt: timestamp({ withTimezone: true }),
    withdrawnAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('ExportBatch_org_id_key').on(t.organizationId, t.id),
    // One live batch per grain bucket. `coalesce` because NULLs are DISTINCT in
    // a unique index, so two store-less summary rows would not collide.
    uniqueIndex('ExportBatch_grain_key')
      .using(
        'btree',
        t.organizationId.asc().nullsLast(),
        t.bookId.asc().nullsLast(),
        t.avenue.asc().nullsLast(),
        t.grainKey.asc().nullsLast(),
        sql`coalesce(${t.storeId}, '')`,
        sql`coalesce(${t.railId}, '')`,
        t.currency.asc().nullsLast()
      )
      .where(sql`${t.state} <> 'withdrawn'`),
    foreignKey({
      name: 'ExportBatch_book_scope_fk',
      columns: [t.organizationId, t.bookId],
      foreignColumns: [ExternalAccountingBook.organizationId, ExternalAccountingBook.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'ExportBatch_connection_scope_fk',
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [ExternalBookConnection.organizationId, ExternalBookConnection.id],
    }).onDelete('no action'),
    // The queue read, and the sweep's "what is due".
    index('ExportBatch_org_state_idx').on(t.organizationId, t.state),
    index('ExportBatch_sweep_idx').on(t.state, t.nextAttemptAt),
    check(
      'ExportBatch_state_check',
      sql`${t.state} IN ('ready','sending','sent','failed','withdrawn') AND ${t.mode} IN ('transaction','summary') AND ${t.attempts} >= 0`
    ),
    check('ExportBatch_payloadHash_check', sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'ExportBatch_failureClass_check',
      sql`${t.failureClass} IS NULL OR ${t.failureClass} IN ('configuration','data','transport')`
    ),
  ]
)

/**
 * One detail posting inside a batch.
 *
 * `withdrawnAt` rather than a mirrored batch state: the partial unique below is
 * what makes a posting un-batchable while it is live somewhere, and a rollback
 * stamps this one column in the same statement that withdraws the batch, so the
 * membership history survives instead of being deleted.
 */
export const ExportBatchPosting = pgTable(
  'ExportBatchPosting',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    batchId: text().notNull(),
    glPostingId: text()
      .notNull()
      .references(() => GlPosting.id, { onDelete: 'no action' }),
    withdrawnAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ExportBatchPosting_live_posting_key')
      .using('btree', t.organizationId.asc().nullsLast(), t.glPostingId.asc().nullsLast())
      .where(sql`${t.withdrawnAt} IS NULL`),
    index('ExportBatchPosting_batch_idx').on(t.organizationId, t.batchId),
    foreignKey({
      name: 'ExportBatchPosting_batch_scope_fk',
      columns: [t.organizationId, t.batchId],
      foreignColumns: [ExportBatch.organizationId, ExportBatch.id],
    }).onDelete('cascade'),
  ]
)

export type ExportBatchEntity = typeof ExportBatch.$inferSelect
export type CreateExportBatchInput = typeof ExportBatch.$inferInsert
export type ExportBatchPostingEntity = typeof ExportBatchPosting.$inferSelect
export type ExportBatchState = (typeof EXPORT_BATCH_STATES)[number]
