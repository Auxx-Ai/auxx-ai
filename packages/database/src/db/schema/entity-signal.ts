// packages/database/src/db/schema/entity-signal.ts
// EntitySignal substrate — scoped slice of plans/signals/01-signal-store.md, built by
// plans/dispatch/19-client-notifications.md §4.1 for outbound-message tracking (v1's only
// writer). Insert-only: rows are never updated, only inserted. ALL writes must go through
// `recordSignal()` (packages/lib/src/signals/record-signal.ts) — never inline inserts, so the
// full signals plan can build additively on these rows.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'

/**
 * One row per thing-that-happened worth surfacing in a communications timeline.
 * v1's only `kind` is `'message:sent'` (outbound sequence/document email); the
 * registry grows (`'email:opened'`, `'web:page_view'`, …) as the full signals
 * plan lands. Insert-only — no `updatedAt`.
 */
export const EntitySignal = pgTable(
  'EntitySignal',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** Namespaced verb, e.g. `'message:sent'`. */
    kind: text().notNull(),
    /** Sub-discriminator: `'sequence_step' | 'document_send'`. */
    subtype: text().notNull(),
    occurredAt: timestamp({ precision: 3 }).notNull(),
    /** Idempotency key, e.g. `'seq:<runId>:<stepIndex>'` | `'doc:<messageId>'`. */
    dedupeKey: text(),
    /** Reserved for signals-plan engagement tracking (not read in v1). */
    isBot: boolean().default(false).notNull(),
    /** Recipient — the denormalized key future rollups/digests read. */
    contactEntityInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** Pointer into the mail system. */
    messageId: text(),
    threadId: text(),
    /** Subject-line snapshot, shown as the timeline row's title. */
    title: text().notNull(),
    /** `{ sequenceId, stepIndex, templateKey, recipientEmail, recurrenceRuleId?, occurrenceDate? }` */
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('EntitySignal_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    // Record timeline/digest reads — replaces the old bare contactEntityInstanceId index.
    index('EntitySignal_organizationId_contactEntityInstanceId_occurredAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.contactEntityInstanceId.asc().nullsLast(),
      table.occurredAt.desc().nullsLast()
    ),
    // Org-wide analytics + the rules door.
    index('EntitySignal_organizationId_kind_occurredAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.kind.asc().nullsLast(),
      table.occurredAt.desc().nullsLast()
    ),
    uniqueIndex('EntitySignal_organizationId_dedupeKey_key')
      .using('btree', table.organizationId.asc().nullsLast(), table.dedupeKey.asc().nullsLast())
      .where(sql`${table.dedupeKey} IS NOT NULL`),
  ]
)

/**
 * Multi-record fan-out for `EntitySignal` — THE query surface ("what have we
 * sent about this record"). String `recordKey`s because visits aren't
 * `EntityInstance`s (§3 — `WorkOrderVisit` is a plain table).
 */
export const EntitySignalLink = pgTable(
  'EntitySignalLink',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    signalId: text()
      .notNull()
      .references((): AnyPgColumn => EntitySignal.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** `'work_order:<id>' | 'visit:<id>' | 'invoice:<id>' | 'quote:<id>' | 'contact:<id>'`. */
    recordKey: text().notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // Job/contact communications-view query: all signals for a given record, newest first.
    index('EntitySignalLink_organizationId_recordKey_signalId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.recordKey.asc().nullsLast(),
      table.signalId.asc().nullsLast()
    ),
  ]
)

export type EntitySignalEntity = typeof EntitySignal.$inferSelect
export type CreateEntitySignalInput = typeof EntitySignal.$inferInsert
export type UpdateEntitySignalInput = Partial<CreateEntitySignalInput>

export type EntitySignalLinkEntity = typeof EntitySignalLink.$inferSelect
export type CreateEntitySignalLinkInput = typeof EntitySignalLink.$inferInsert
export type UpdateEntitySignalLinkInput = Partial<CreateEntitySignalLinkInput>
