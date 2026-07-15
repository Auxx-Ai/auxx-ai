// packages/lib/src/dispatch/notify.ts
//
// Dispatch (notify) action (07 §B.5) — a separate explicit action, NOT part of scheduling
// (04-ui §7). Requires a scheduled visit with an assignee; stamps `dispatchedAt`; notifies
// the assignee in-app (NotificationService has NO email rail — notification-service.ts:102)
// and via the separate email rail (`enqueueEmailJob`). Re-dispatch is allowed — it re-stamps
// and re-notifies.

import { WEBAPP_URL } from '@auxx/config/urls'
import { database, schema } from '@auxx/database'
import type { NotificationType } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, NotFoundError } from '../errors'
import { enqueueEmailJob } from '../jobs/email/enqueue-email-job'
import { NotificationService } from '../notifications/notification-service'
import { getUserSetting } from '../settings'
import type { DispatchVisitInput } from './types'
import { afterVisitWrite } from './visit-mutations'
import { getWorkOrderProjections } from './work-order-fields'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/** Resolve the work order's number/title/address for the notification/email content — one
 * narrow read. Exported for reuse by `worker-notifications.ts` (reschedule/cancel/reassign). */
export async function getWorkOrderLabel(
  organizationId: string,
  userId: string,
  workOrderId: string
): Promise<{ number: string | undefined; title: string | undefined; address: string | undefined }> {
  const projections = await getWorkOrderProjections(
    organizationId,
    userId,
    [workOrderId],
    ['number', 'title', 'address']
  )
  const info = projections.get(workOrderId)
  return { number: info?.number, title: info?.title, address: info?.address }
}

/**
 * Dispatch (notify) a visit's assignee (07 §B.5). Requires `startTime`/`endTime` and an
 * assignee — `BadRequestError` otherwise. Stamps `dispatchedAt`, sends the in-app
 * notification, enqueues the dispatch email, then runs the shared mirror/roll-up/broadcast
 * (`afterVisitWrite`, trigger `dispatched`).
 */
export async function dispatchVisit(input: DispatchVisitInput): Promise<WorkOrderVisitRow> {
  const { organizationId, userId, visitId, excludeSocketId } = input

  const visit = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.id, visitId),
      eq(schema.WorkOrderVisit.organizationId, organizationId)
    ),
  })
  if (!visit) throw new NotFoundError('Visit not found')
  if (!visit.startTime || !visit.endTime) {
    throw new BadRequestError('Visit must be scheduled before it can be dispatched')
  }
  if (!visit.assigneeUserId) {
    throw new BadRequestError('Visit must have an assignee before it can be dispatched')
  }

  const [updated] = await database
    .update(schema.WorkOrderVisit)
    .set({ dispatchedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.WorkOrderVisit.id, visitId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      )
    )
    .returning()
  if (!updated) throw new NotFoundError('Visit not found')

  const { number, title } = await getWorkOrderLabel(organizationId, userId, updated.workOrderId)
  const workOrderLabel = number && title ? `${number} — ${title}` : (number ?? title ?? 'your job')
  const workOrderUrl = `${WEBAPP_URL}/app/work-orders/${updated.workOrderId}`

  const assignee = await database.query.User.findFirst({
    where: eq(schema.User.id, updated.assigneeUserId!),
  })

  await new NotificationService().sendNotification({
    // ⚠️ NotificationType.WORK_ORDER_DISPATCHED added to the schema pgEnum (needs a
    // migration — not generated here, see the build report).
    type: 'WORK_ORDER_DISPATCHED' as NotificationType,
    userId: updated.assigneeUserId!,
    actorId: userId,
    entityId: updated.workOrderId,
    entityType: 'work_order',
    message: `You've been dispatched to ${workOrderLabel}`,
    organizationId,
    data: { visitId: updated.id },
  })

  // Plan 19 §4.9: the dispatch email is gated on `notification.dispatch.email` too (default
  // true — an explicit `false` opts out); the in-app notification above always fires.
  const emailEnabled = await getUserSetting({
    organizationId,
    userId: updated.assigneeUserId!,
    key: 'notification.dispatch.email',
  })
  if (assignee?.email && emailEnabled !== false) {
    await enqueueEmailJob('visit-dispatched', {
      recipient: { email: assignee.email, name: assignee.name ?? undefined },
      workOrderNumber: number ?? '',
      workOrderTitle: title ?? 'Work order',
      startTime: updated.startTime!.toISOString(),
      endTime: updated.endTime!.toISOString(),
      timezone: updated.timezone,
      workOrderUrl,
      source: 'dispatch.dispatchVisit',
      organizationId,
      actorId: userId,
    })
  }

  await afterVisitWrite(updated, { userId, trigger: 'dispatched', excludeSocketId })
  return updated
}
