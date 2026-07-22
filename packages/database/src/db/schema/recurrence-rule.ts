// packages/database/src/db/schema/recurrence-rule.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { DispatchWorker } from './dispatch-worker'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'

/**
 * A structured `RecurrencePattern` (frequency/interval/weekdays/monthDay/nthWeekday/until/count —
 * see `packages/lib/src/recurrence/types.ts` §2.1). Kept as a locally-declared structural type
 * here (not imported from `@auxx/lib`) because `database` is a lower dependency tier than `lib`
 * and must never import from it.
 */
type RecurrenceRulePattern = Record<string, unknown>

/**
 * One recurring engagement's schedule rule (plans/dispatch/06-recurring-engine.md §3.1).
 * `subjectType`/`subjectId` generalize the rule beyond dispatch visits — `'work_order_visits'`
 * is the first consumer, `'invoice_drafts'` (money MI2) reuses the same table with a second
 * `subjectType`. One rule per subject (unique below); the visit-template columns
 * (`startMinute`/`durationMinutes`/`defaultAssigneeWorkerId`) are nullable because non-visit
 * subjects don't need them.
 *
 * `effectiveFrom` is the three-way-edit anchor (06 §4.3): occurrences on/after this date follow
 * the CURRENT `pattern`/template; regeneration boundaries are computed from it, never from
 * `anchor` (the immutable series-start date used only as the expansion origin).
 *
 * `materializedUntil` is the materializer's horizon high-water mark (06 §4.4) — the daily sweep
 * job queries rules whose horizon is behind `now + RECURRENCE_HORIZON_DAYS`.
 */
export const RecurrenceRule = pgTable(
  'RecurrenceRule',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** 'work_order_visits' now; 'invoice_drafts' in money MI2 */
    subjectType: text().notNull(),
    /** The EntityInstance this rule schedules — the work order instance for dispatch visits */
    subjectId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    /** RecurrencePattern (frequency/interval/weekdays/monthDay/nthWeekday/until/count) */
    pattern: jsonb().$type<RecurrenceRulePattern>().notNull(),
    timezone: text().notNull(),
    /** Series start (local date) — the expansion origin; immutable after creation */
    anchor: date().notNull(),
    /** Edit anchor: occurrences on/after this date follow the CURRENT pattern/template */
    effectiveFrom: date().notNull(),
    /** Wall-clock minutes since local midnight; null for subject types without a visit template */
    startMinute: integer(),
    /** Default visit duration in minutes; null for subject types without a visit template */
    durationMinutes: integer(),
    /** null = unassigned rail; per-visit assignee override still possible after materialization.
     * References the dispatchable worker row (individual or team), matching
     * `WorkOrderVisit.assigneeWorkerId` (plans/dispatch/45-teams.md §5.7). */
    defaultAssigneeWorkerId: text().references((): AnyPgColumn => DispatchWorker.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** Materializer horizon high-water mark; null = never materialized */
    materializedUntil: timestamp({ precision: 3, withTimezone: true }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One engagement, one rule
    uniqueIndex('RecurrenceRule_subjectType_subjectId_key').using(
      'btree',
      table.subjectType.asc().nullsLast(),
      table.subjectId.asc().nullsLast()
    ),
    // Sweep query: rules whose horizon is behind, scoped by org + subjectType
    index('RecurrenceRule_organizationId_subjectType_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.subjectType.asc().nullsLast()
    ),
  ]
)

export type RecurrenceRuleEntity = typeof RecurrenceRule.$inferSelect
export type RecurrenceRuleInsert = typeof RecurrenceRule.$inferInsert
