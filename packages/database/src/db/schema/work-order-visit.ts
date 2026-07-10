// packages/database/src/db/schema/work-order-visit.ts
// Canonical schedule store for dispatch work orders (plans/dispatch/01-data-model.md §2).

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

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
    /** null = unassigned rail on the board */
    assigneeUserId: text().references((): AnyPgColumn => User.id, {
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
    index('WorkOrderVisit_assigneeUserId_startTime_idx').using(
      'btree',
      table.assigneeUserId.asc().nullsLast(),
      table.startTime.asc().nullsLast()
    ),
    // Record drawer lookup
    index('WorkOrderVisit_workOrderId_idx').using('btree', table.workOrderId.asc().nullsLast()),
  ]
)

export type WorkOrderVisitEntity = typeof WorkOrderVisit.$inferSelect
export type WorkOrderVisitInsert = typeof WorkOrderVisit.$inferInsert
