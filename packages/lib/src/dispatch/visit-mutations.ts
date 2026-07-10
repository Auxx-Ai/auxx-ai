// packages/lib/src/dispatch/visit-mutations.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'

/**
 * Ensure exactly one `WorkOrderVisit` row exists for a work order. Idempotent by
 * construction — selects first, inserts only if absent. The 1:1 invariant (one visit per
 * work order, 01 §2) is service-enforced by this being the single creation door, not a DB
 * constraint. Inserted with `startTime: null` (unscheduled) — the board (M2) fills it in.
 *
 * @param organizationId - Organization the work order belongs to
 * @param workOrderInstanceId - EntityInstance id of the work order (not the RecordId)
 */
export async function ensureVisitForWorkOrder(
  organizationId: string,
  workOrderInstanceId: string
): Promise<void> {
  const existing = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.organizationId, organizationId),
      eq(schema.WorkOrderVisit.workOrderId, workOrderInstanceId)
    ),
  })
  if (existing) return

  await database.insert(schema.WorkOrderVisit).values({
    organizationId,
    workOrderId: workOrderInstanceId,
    status: 'scheduled',
    timezone: 'UTC',
    updatedAt: new Date(),
  })
}
