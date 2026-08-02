// packages/database/src/db/schema/mail-filter.ts
// Drizzle tables: MailFilter + MailFilterRun — Gmail-style inbound mail filters
// ("when a new message in this inbox matches X, do Y"). Copied in shape from
// `record-rule.ts` rather than folded into it (see plans/mail-filter/01-record-rules-reuse.md).
// Filters are ordered per inbox, run in the `publishEventJob` gate for
// `message:received`, and log one MailFilterRun per firing.
// See plans/mail-filter/02-mail-filters-plan.md.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

export const MailFilter = pgTable(
  'MailFilter',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    // The inbox this filter governs — an `EntityInstance` id on the `inbox` or
    // `personal_inbox` def, matching `Thread.inboxId`. NOT NULL: a filter always belongs
    // to exactly one inbox, and personal-ness derives from that inbox's definition
    // (D6), exactly like channels.
    //
    // THE CONTAINMENT BOUNDARY (invariant 18): the engine refuses to act on a thread
    // whose `inboxId` differs, so a filter can never reach mail outside its inbox.
    // Cascade delete follows from that — a deleted inbox takes its filters with it,
    // because an orphaned filter would have no boundary left to enforce.
    inboxId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    name: text().notNull(),
    // Evaluation order within the inbox (drag-to-reorder). Filters run ascending; a
    // matching filter with `stopProcessing` halts the rest. NB: `order` is a SQL
    // reserved word — Drizzle quotes identifiers, so the column is `"order"`.
    order: integer().notNull(),
    // Halt evaluation of subsequent filters in this inbox when this one matches (D3).
    stopProcessing: boolean().default(false).notNull(),
    enabled: boolean().default(true).notNull(),
    // Existing conditions system (`@auxx/lib/conditions` ConditionGroup[]) — the same
    // shape the searchbar and mail views produce, so one evaluator serves live firing,
    // preview counts and retroactive apply. Groups are AND'd; empty array = always match.
    conditions: jsonb().$type<unknown[]>().default([]).notNull(),
    // Ordered action array (MailFilterAction[] — typed in @auxx/lib/mail-filters).
    // Failure semantics: continue-and-report; per-action outcomes land in MailFilterRun.
    actions: jsonb().$type<unknown[]>().notNull(),
    createdByUserId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    // Idempotency key for seeded suggested filters. NULL for ordinary user-authored
    // filters. Unique per org when set (see index below). Copies `RecordRule.templateKey`.
    templateKey: text(),
    // Last time this filter matched and executed. Display-only (list subtitle / staleness
    // hints) — never part of the idempotency decision, which is the MailFilterRun claim.
    lastFiredAt: timestamp({ precision: 3 }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // Ordered load for one inbox — the list UI and the engine's evaluation sequence.
    index('MailFilter_organizationId_inboxId_order_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.inboxId.asc().nullsLast(),
      table.order.asc().nullsLast()
    ),
    // Hot path: the gate only ever loads ENABLED filters, so the disabled rows are
    // excluded from the index rather than filtered out of it.
    index('MailFilter_organizationId_inboxId_enabled_idx')
      .using('btree', table.organizationId.asc().nullsLast(), table.inboxId.asc().nullsLast())
      .where(sql`enabled`),
    // Suggested-filter seeding idempotency: one row per (org, templateKey).
    // Partial — templateKey is null for the vast majority of (ordinary user) filters.
    uniqueIndex('MailFilter_organizationId_templateKey_idx')
      .using('btree', table.organizationId.asc().nullsLast(), table.templateKey.asc().nullsLast())
      .where(sql`"templateKey" IS NOT NULL`),
  ]
)

export const MailFilterRun = pgTable(
  'MailFilterRun',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    // Plain text on purpose (no FK): a deleted filter's history must survive — deleting
    // a filter must not erase the audit trail of what it already did to people's mail.
    // The `RecordRuleRun.ruleId` precedent. Retention pruning handles cleanup.
    filterId: text().notNull(),
    // Plain text on purpose (no FK): a purged or hard-deleted thread must not take its
    // audit trail with it.
    threadId: text().notNull(),
    // Plain text on purpose (no FK): same reasoning as threadId — and the message row may
    // be gone while the run row still explains why the thread looks the way it does.
    messageId: text().notNull(),
    // Per-action outcomes ([{ actionIndex, type, status: 'ok'|'failed'|'skipped', error? }]).
    outcomes: jsonb().$type<unknown[]>().default([]).notNull(),
    status: text().$type<'ok' | 'partial' | 'failed'>().notNull(),
    // Pre-action state for the reversible actions: `{ status, assigneeId, inboxId, tagIds, read }`.
    // Written by the post-execution UPDATE, not the claim insert (the claim is written
    // before the actions run, when the pre-state has not been captured yet).
    undo: jsonb().$type<unknown>(),
    // Set when a user reverses this firing. NULL = still applied.
    undoneAt: timestamp({ precision: 3 }),
    // Which door fired this run. Part of the unique claim key below, so a retroactive
    // backfill and a live firing on the same message are DISTINCT rows: without it the
    // backfill would collide with the existing live row and `DO NOTHING` would silently
    // discard the retroactive outcome and its undo blob.
    source: text().$type<'live' | 'retroactive'>().default('live').notNull(),
    firedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    // Run history per filter, newest first.
    index('MailFilterRun_organizationId_filterId_firedAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.filterId.asc().nullsLast(),
      table.firedAt.desc().nullsLast()
    ),
    // Run history per thread, newest first — powers the thread "filtered" badge and undo.
    index('MailFilterRun_organizationId_threadId_firedAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.threadId.asc().nullsLast(),
      table.firedAt.desc().nullsLast()
    ),
    // Retention pruning sweeps by age.
    index('MailFilterRun_firedAt_idx').using('btree', table.firedAt.asc().nullsLast()),
    // THE IDEMPOTENCY CLAIM KEY — load-bearing, not merely a de-duplicated log.
    // The run row is inserted as a CLAIM with `ON CONFLICT (filterId, messageId, source)
    // DO NOTHING` **BEFORE** the actions execute; if no row was inserted, the engine
    // bails without executing. Only then is the row UPDATEd with outcomes and the undo
    // blob. As a post-hoc log write this index would deduplicate the audit trail while
    // letting non-idempotent actions (run-agent, run-workflow) fire twice on a BullMQ
    // retry of the gate job — e.g. two agent replies to the same customer.
    uniqueIndex('MailFilterRun_filterId_messageId_source_idx').using(
      'btree',
      table.filterId.asc().nullsLast(),
      table.messageId.asc().nullsLast(),
      table.source.asc().nullsLast()
    ),
  ]
)

/** Selected MailFilter entity type */
export type MailFilterEntity = typeof MailFilter.$inferSelect
/** Selected MailFilterRun entity type */
export type MailFilterRunEntity = typeof MailFilterRun.$inferSelect
