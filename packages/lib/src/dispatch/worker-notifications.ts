// packages/lib/src/dispatch/worker-notifications.ts
//
// Worker-facing reschedule/cancel/reassign notices (plans/dispatch/19-client-notifications.md
// §4.9) — internal system-SES rail emails (packages/email via `enqueueEmailJob`, the same rail
// as `dispatchVisit`'s `visit-dispatched` email; NEVER the customer-facing sequences/org-mailbox
// rail) + an always-on in-app `NotificationService` write. Callers in `visit-mutations.ts` gate
// every call on `visit.dispatchedAt IS NOT NULL` — a visit nobody's been told about yet doesn't
// need a reschedule/cancel/reassign notice. The in-app notification always fires; the email is
// gated per-recipient on the `notification.dispatch.email` user setting (default true).
//
// Failures here must never fail the visit mutation that triggered them — every exported
// function swallows its own errors after logging (the `visit-mutations.ts` call sites still
// wrap in try/catch as a second layer of defense per the build brief).

import { WEBAPP_URL } from '@auxx/config/urls'
import { database, schema } from '@auxx/database'
import type { NotificationType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { enqueueEmailJob } from '../jobs/email/enqueue-email-job'
import { NotificationService } from '../notifications/notification-service'
import { getUserSetting } from '../settings'
import { getWorkOrderLabel } from './notify'

const logger = createScopedLogger('dispatch:worker-notifications')

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/** `notification.dispatch.email` gate — default true, only an explicit `false` skips. */
async function emailPrefEnabled(organizationId: string, userId: string): Promise<boolean> {
  const value = await getUserSetting({
    organizationId,
    userId,
    key: 'notification.dispatch.email',
  })
  return value !== false
}

async function findUserById(userId: string) {
  return database.query.User.findFirst({ where: eq(schema.User.id, userId) })
}

/** Input for {@link notifyVisitRescheduled}. */
export interface NotifyVisitRescheduledInput {
  organizationId: string
  /** Acting user (the notification's `actorId`). */
  userId: string
  /** The visit AFTER the reschedule write (already persisted). */
  visit: WorkOrderVisitRow
  oldStartTime: Date
  oldEndTime: Date
}

/**
 * Notify a visit's assignee that its time changed (old → new). No-op when the visit has never
 * been dispatched, has no assignee, or isn't currently scheduled.
 */
export async function notifyVisitRescheduled(input: NotifyVisitRescheduledInput): Promise<void> {
  const { organizationId, userId, visit, oldStartTime, oldEndTime } = input
  if (!visit.dispatchedAt || !visit.assigneeUserId || !visit.startTime || !visit.endTime) return
  const assigneeUserId = visit.assigneeUserId

  try {
    const { number, title, address } = await getWorkOrderLabel(
      organizationId,
      userId,
      visit.workOrderId
    )
    const workOrderLabel =
      number && title ? `${number} — ${title}` : (number ?? title ?? 'your job')

    await new NotificationService().sendNotification({
      type: 'VISIT_RESCHEDULED' as NotificationType,
      userId: assigneeUserId,
      actorId: userId,
      entityId: visit.workOrderId,
      entityType: 'work_order',
      message: `Your visit for ${workOrderLabel} was rescheduled`,
      organizationId,
      data: { visitId: visit.id },
    })

    if (await emailPrefEnabled(organizationId, assigneeUserId)) {
      const assignee = await findUserById(assigneeUserId)
      if (assignee?.email) {
        await enqueueEmailJob('visit-rescheduled', {
          recipient: { email: assignee.email, name: assignee.name ?? undefined },
          workOrderNumber: number ?? '',
          workOrderTitle: title ?? 'Work order',
          oldStartTime: oldStartTime.toISOString(),
          oldEndTime: oldEndTime.toISOString(),
          newStartTime: visit.startTime.toISOString(),
          newEndTime: visit.endTime.toISOString(),
          timezone: visit.timezone,
          workOrderUrl: `${WEBAPP_URL}/app/work-orders/${visit.workOrderId}`,
          address,
          source: 'dispatch.notifyVisitRescheduled',
          organizationId,
          actorId: userId,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to notify visit reschedule', { error, visitId: visit.id, organizationId })
  }
}

/** Input for {@link notifyVisitCanceled}. */
export interface NotifyVisitCanceledInput {
  organizationId: string
  userId: string
  /** The visit as it stood immediately BEFORE the cancel/unschedule write (needs the old
   * startTime/endTime/assignee — the post-write row may already be nulled out). */
  visit: WorkOrderVisitRow
}

/**
 * Notify a visit's assignee that it was canceled/unscheduled. No-op when the visit has never
 * been dispatched, has no assignee, or was never scheduled (nothing to cancel).
 */
export async function notifyVisitCanceled(input: NotifyVisitCanceledInput): Promise<void> {
  const { organizationId, userId, visit } = input
  if (!visit.dispatchedAt || !visit.assigneeUserId || !visit.startTime || !visit.endTime) return
  const assigneeUserId = visit.assigneeUserId

  try {
    const { number, title } = await getWorkOrderLabel(organizationId, userId, visit.workOrderId)
    const workOrderLabel =
      number && title ? `${number} — ${title}` : (number ?? title ?? 'your job')

    await new NotificationService().sendNotification({
      type: 'VISIT_CANCELED' as NotificationType,
      userId: assigneeUserId,
      actorId: userId,
      entityId: visit.workOrderId,
      entityType: 'work_order',
      message: `Your visit for ${workOrderLabel} was canceled`,
      organizationId,
      data: { visitId: visit.id },
    })

    if (await emailPrefEnabled(organizationId, assigneeUserId)) {
      const assignee = await findUserById(assigneeUserId)
      if (assignee?.email) {
        await enqueueEmailJob('visit-canceled', {
          recipient: { email: assignee.email, name: assignee.name ?? undefined },
          workOrderNumber: number ?? '',
          workOrderTitle: title ?? 'Work order',
          startTime: visit.startTime.toISOString(),
          endTime: visit.endTime.toISOString(),
          timezone: visit.timezone,
          source: 'dispatch.notifyVisitCanceled',
          organizationId,
          actorId: userId,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to notify visit cancellation', {
      error,
      visitId: visit.id,
      organizationId,
    })
  }
}

/** Input for {@link notifyVisitReassigned}. */
export interface NotifyVisitReassignedInput {
  organizationId: string
  userId: string
  /** The visit AFTER the reassignment write (already persisted — carries the NEW assignee +
   * current schedule). */
  visit: WorkOrderVisitRow
  /** Assignee before the write; `null` if it was previously unassigned. */
  oldAssigneeUserId: string | null
}

/**
 * Notify BOTH sides of a reassignment: a "removed" notice to the old assignee (if any) and an
 * "assigned" notice to the new one (if any) — never the full dispatch email (Dispatch stays the
 * only sender of that). No-op entirely when the visit has never been dispatched.
 */
export async function notifyVisitReassigned(input: NotifyVisitReassignedInput): Promise<void> {
  const { organizationId, userId, visit, oldAssigneeUserId } = input
  if (!visit.dispatchedAt || !visit.startTime || !visit.endTime) return
  const newAssigneeUserId = visit.assigneeUserId
  if (oldAssigneeUserId === newAssigneeUserId) return

  const startTime = visit.startTime
  const endTime = visit.endTime

  const { number, title } = await getWorkOrderLabel(
    organizationId,
    userId,
    visit.workOrderId
  ).catch((error) => {
    logger.error('Failed to load work order label for reassignment notice', {
      error,
      visitId: visit.id,
      organizationId,
    })
    return { number: undefined, title: undefined, address: undefined }
  })
  const workOrderLabel = number && title ? `${number} — ${title}` : (number ?? title ?? 'your job')
  const workOrderUrl = `${WEBAPP_URL}/app/work-orders/${visit.workOrderId}`

  const notifySide = async (
    targetUserId: string,
    variant: 'removed' | 'assigned',
    notificationType: NotificationType,
    message: string
  ): Promise<void> => {
    try {
      await new NotificationService().sendNotification({
        type: notificationType,
        userId: targetUserId,
        actorId: userId,
        entityId: visit.workOrderId,
        entityType: 'work_order',
        message,
        organizationId,
        data: { visitId: visit.id },
      })

      if (await emailPrefEnabled(organizationId, targetUserId)) {
        const target = await findUserById(targetUserId)
        if (target?.email) {
          await enqueueEmailJob('visit-reassigned', {
            recipient: { email: target.email, name: target.name ?? undefined },
            variant,
            workOrderNumber: number ?? '',
            workOrderTitle: title ?? 'Work order',
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            timezone: visit.timezone,
            workOrderUrl,
            source: 'dispatch.notifyVisitReassigned',
            organizationId,
            actorId: userId,
          })
        }
      }
    } catch (error) {
      logger.error('Failed to notify visit reassignment', {
        error,
        visitId: visit.id,
        organizationId,
        targetUserId,
        variant,
      })
    }
  }

  if (oldAssigneeUserId) {
    await notifySide(
      oldAssigneeUserId,
      'removed',
      'VISIT_REASSIGNED' as NotificationType,
      `You've been removed from the visit for ${workOrderLabel}`
    )
  }
  if (newAssigneeUserId) {
    await notifySide(
      newAssigneeUserId,
      'assigned',
      'VISIT_REASSIGNED' as NotificationType,
      `You've been assigned to the visit for ${workOrderLabel}`
    )
  }
}
