// packages/database/src/db/schema/work-order-visit.ts
// Canonical schedule store for dispatch work orders (plans/dispatch/01-data-model.md §2).

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { DispatchWorker } from './dispatch-worker'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { RecurrenceRule } from './recurrence-rule'

/**
 * One visit = one scheduled (or not-yet-scheduled) trip to the site for a work order.
 * v1 invariant: exactly one visit per work order (service-enforced, not schema —
 * multi-visit/crews are a planned extension). The board (M2) reads this table only.
 *
 * This invariant is now explicitly a ONE-OFF-job invariant, not a global one (01 §10): a
 * `recurring` work order (jobType field, §B.1) will generate N visits on a rolling window once
 * the M2+ recurring engine lands — exactly why the schedule store is a separate table and not
 * fields on the work order def. In M1, `recurring` is selectable but behaves like `one_off`
 * (single auto-created visit, §I) — the 1:1 invariant still holds for every work order that
 * exists today.
 */
export const WorkOrderVisit = pgTable(
  'WorkOrderVisit',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** The work order EntityInstance this visit belongs to */
    workOrderId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    /** null = unassigned rail on the board. References the dispatchable worker row (individual or
     * team), not a User directly — assignment is worker-based (plans/dispatch/45-teams.md §1.D). */
    assigneeWorkerId: text().references((): AnyPgColumn => DispatchWorker.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** null = not yet scheduled */
    startTime: timestamp({ precision: 3, withTimezone: true }),
    endTime: timestamp({ precision: 3, withTimezone: true }),
    timezone: text().default('UTC').notNull(),
    /** scheduled / en_route / on_site / done / canceled (01 §5) */
    status: text().default('scheduled').notNull(),
    /** Stop order per assignee+day; optimizer fills later */
    routeOrder: integer(),
    /** Geocoded from work_order_address at schedule time (M3, 02 §6); null = no pin/geofence */
    latitude: doublePrecision(),
    longitude: doublePrecision(),
    geocodedAt: timestamp({ precision: 3, withTimezone: true }),
    /** Stamped by `dispatchVisit` (M2 §B.5) — separate explicit action from scheduling. */
    dispatchedAt: timestamp({ precision: 3, withTimezone: true }),
    /** Null = the current startTime/endTime are provisional (planner math, never promised to a
     * human). Stamped by deliberate human time-writes (scheduleVisit timeWriteKind 'confirmed');
     * cleared on unschedule. Plan 20 §4. */
    timeConfirmedAt: timestamp({ precision: 3, withTimezone: true }),
    /** Intended on-site duration. Null = no explicit intent (readers fall back to scheduled
     * span, then 60 min). Stamped from span on confirmed schedule writes; survives
     * unscheduling. */
    durationMinutes: integer(),
    /** null = not part of a recurring engagement (one-off visit) */
    recurrenceRuleId: text().references((): AnyPgColumn => RecurrenceRule.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /**
     * Slot identity: the local date the pattern produced this occurrence for (06 §3.2/§4.3).
     * IMMUTABLE — a rescheduled (detached) visit keeps its slot even when `startTime` moves to
     * a different day. Null for non-recurring visits.
     */
    occurrenceDate: date(),
    /** Per-visit edit happened (this-visit-only scope, 06 §4.3) — regeneration never touches it */
    isDetached: boolean().default(false).notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Board range query
    index('WorkOrderVisit_organizationId_startTime_endTime_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.startTime.asc().nullsLast(),
      table.endTime.asc().nullsLast()
    ),
    // Per-worker day/route query
    index('WorkOrderVisit_assigneeWorkerId_startTime_idx').using(
      'btree',
      table.assigneeWorkerId.asc().nullsLast(),
      table.startTime.asc().nullsLast()
    ),
    // Record drawer lookup
    index('WorkOrderVisit_workOrderId_idx').using('btree', table.workOrderId.asc().nullsLast()),
    // Materialization idempotency: one row per rule per occurrence date
    uniqueIndex('WorkOrderVisit_recurrenceRuleId_occurrenceDate_key')
      .using(
        'btree',
        table.recurrenceRuleId.asc().nullsLast(),
        table.occurrenceDate.asc().nullsLast()
      )
      .where(sql`${table.recurrenceRuleId} IS NOT NULL`),
  ]
)

export type WorkOrderVisitEntity = typeof WorkOrderVisit.$inferSelect
export type WorkOrderVisitInsert = typeof WorkOrderVisit.$inferInsert
