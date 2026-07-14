// packages/lib/src/dispatch/route-planner/route-order.ts
//
// Bulk `routeOrder` write (plans/dispatch/09-route-planner.md §F, build contract item 4) — the
// only writer of `WorkOrderVisit.routeOrder`. A full-list rewrite per reorder, not gap-based
// ordering (design doc §B: a worker's day rarely exceeds ~15-20 stops).

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, gte, isNotNull, lte, notInArray } from 'drizzle-orm'
import { afterVisitWrite } from '../visit-mutations'
import { autoApplyRouteTimes } from './apply-times'
import type { PlannerDayWindow } from './types'

const logger = createScopedLogger('dispatch:route-planner:route-order')

/** Input for {@link setRouteOrder}. */
export interface SetRouteOrderInput {
  organizationId: string
  userId: string
  assigneeUserId: string
  /** The planned day, client-resolved ({@link PlannerDayWindow}). */
  window: Pick<PlannerDayWindow, 'from' | 'to'>
  /** `yyyy-MM-dd` label of the planned day, client-resolved — the Directions cache-key day
   * (same as `ApplyRouteTimesInput.dateKey`). */
  dateKey: string
  /** Ordered visit ids — index in the array becomes the new `routeOrder`. */
  visitIds: string[]
  excludeSocketId?: string
}

/**
 * Set `routeOrder` for `visitIds` (index in the array = new order) for one worker's day, and
 * null out `routeOrder` on any OTHER visit of that assignee+day that previously had a non-null
 * `routeOrder` but isn't in the new list (contract item 4 — a stop dragged out of the route
 * loses its position). Calls {@link afterVisitWrite} per touched row so realtime broadcast
 * keeps other open tabs' maps in sync (the mirror/roll-up steps are no-ops for `routeOrder`
 * since it isn't a mirrored field — `afterVisitWrite` is called without a `trigger`).
 */
export async function setRouteOrder(input: SetRouteOrderInput): Promise<void> {
  const { organizationId, userId, assigneeUserId, window, dateKey, visitIds, excludeSocketId } =
    input
  const { from, to } = window

  const nullOutConditions = [
    eq(schema.WorkOrderVisit.organizationId, organizationId),
    eq(schema.WorkOrderVisit.assigneeUserId, assigneeUserId),
    gte(schema.WorkOrderVisit.startTime, from),
    lte(schema.WorkOrderVisit.startTime, to),
    isNotNull(schema.WorkOrderVisit.routeOrder),
  ]
  if (visitIds.length > 0) {
    nullOutConditions.push(notInArray(schema.WorkOrderVisit.id, visitIds))
  }

  const nulledRows = await database
    .update(schema.WorkOrderVisit)
    .set({ routeOrder: null, updatedAt: new Date() })
    .where(and(...nullOutConditions))
    .returning()

  const reorderedRows: (typeof schema.WorkOrderVisit.$inferSelect)[] = []
  for (const [index, visitId] of visitIds.entries()) {
    const [row] = await database
      .update(schema.WorkOrderVisit)
      .set({ routeOrder: index, updatedAt: new Date() })
      .where(
        and(
          eq(schema.WorkOrderVisit.id, visitId),
          eq(schema.WorkOrderVisit.organizationId, organizationId)
        )
      )
      .returning()
    if (row) reorderedRows.push(row)
  }

  for (const row of [...nulledRows, ...reorderedRows]) {
    await afterVisitWrite(row, { userId, excludeSocketId })
  }

  // Auto-sync (plan 20 §5): with `dispatch.routes.autoApplyTimes` on, re-chain the route's
  // provisional times in the same request. The `routeOrder` writes above are already committed
  // — a failure here (settings read included) must never fail the reorder, so the whole block
  // is caught-and-logged.
  if (visitIds.length > 0) {
    try {
      const { getOrganizationSetting } = await import('../../settings/settings-service')
      const autoApplyTimes = await getOrganizationSetting({
        organizationId,
        key: 'dispatch.routes.autoApplyTimes',
      })
      if (autoApplyTimes) {
        await autoApplyRouteTimes({
          organizationId,
          userId,
          assigneeUserId,
          dateKey,
          window,
          visitIds,
          excludeSocketId,
        })
      }
    } catch (error) {
      logger.error('Auto-apply route times failed after reorder', {
        organizationId,
        assigneeUserId,
        dateKey,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
