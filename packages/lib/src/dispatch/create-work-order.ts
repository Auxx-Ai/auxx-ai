// packages/lib/src/dispatch/create-work-order.ts
//
// Slot-click create's server write (plans/dispatch/37c-calendar-create-copy-paste.md §7, §2.5
// correction). Unlike `convert-to-work-order.ts`/`create-from-ticket.ts` (which copy fields off
// an existing source record), this is the "build a work order from nothing" path — a mini
// contact + title + time form, not a conversion.

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud'
import type { CreateWorkOrderInput, CreateWorkOrderResult } from './types'
import { scheduleVisit } from './visit-mutations'

/**
 * Create a work order from the board's slot-click "New job" popover (§7). **Mechanism
 * (§2.5 correction)**: neither this function nor `handler.create` calls
 * `ensureVisitForWorkOrder` directly — the field-change hook `ensureVisitOnWorkOrderCreate`
 * (`visit-hooks.ts`) auto-creates exactly ONE unscheduled visit the instant `work_order_number`
 * first lands, and that hook fires (and is awaited) synchronously inside `handler.create`
 * (`setValueWithBuiltIn`'s post-write hook chain), so by the time `create` resolves the row
 * already exists. This function looks that row up (it isn't returned synchronously) and then
 * `scheduleVisit`s it with the slot's times/assignee — the same call every other visit-create
 * flow ends at (mirror, roll-up, sequence enrollment, broadcast).
 *
 * `work_order_job_type` is left at its schema default (`'one_off'`) — this is always a
 * from-scratch job, never a conversion, so (unlike `convertRequestToWorkOrder`) there's nothing
 * to explain about not setting it; it's just never touched.
 *
 * @param input - organizationId, userId (acting user), contactRecordId, optional title (falls
 * back to the contact's displayName), the slot's startTime/endTime, optional assigneeUserId.
 * @returns The new work order's RecordId and the id of the visit that was scheduled onto it.
 */
export async function createWorkOrder(input: CreateWorkOrderInput): Promise<CreateWorkOrderResult> {
  const { organizationId, userId, contactRecordId, startTime, endTime, assigneeUserId } = input
  const handler = new UnifiedCrudHandler(organizationId, userId)

  let title = input.title?.trim()
  if (!title) {
    const { entityInstanceId: contactInstanceId } = parseRecordId(contactRecordId)
    const contact = await database.query.EntityInstance.findFirst({
      where: and(
        eq(schema.EntityInstance.id, contactInstanceId),
        eq(schema.EntityInstance.organizationId, organizationId)
      ),
      columns: { displayName: true },
    })
    title = contact?.displayName || 'New job'
  }

  const values: Record<string, unknown> = {
    work_order_title: title,
    work_order_status: 'new',
    work_order_contact: contactRecordId,
  }

  // Events ON (user-triggered, no skipEvents): timeline + realtime `record:created` + the
  // §F.4a number pre-hook + the visit auto-create hook all fire from this call — by the time it
  // resolves, the hook-created visit row below already exists.
  const created = await handler.create('work_order', values)

  const visit = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.organizationId, organizationId),
      eq(schema.WorkOrderVisit.workOrderId, created.instance.id)
    ),
  })
  if (!visit) {
    // Defensive only — `ensureVisitOnWorkOrderCreate` guarantees exactly one row per work-order
    // create; a miss here means the hook chain didn't run, which is a bug elsewhere, not a
    // recoverable input error.
    throw new NotFoundError('Work order created without its auto-created visit')
  }

  const scheduled = await scheduleVisit({
    organizationId,
    userId,
    visitId: visit.id,
    startTime,
    endTime,
    assigneeUserId,
    excludeSocketId: input.excludeSocketId,
  })

  return { workOrderRecordId: created.recordId, visitId: scheduled.id }
}
