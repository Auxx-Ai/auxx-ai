// packages/lib/src/events/handlers/auto-complete-tasks.ts
// Step 5 — auto-complete on reply (plans/signals/06-follow-ups-build.md). Bus consumer for
// `signal:recorded`, `message:replied` kind only: completes every open
// `autoCompleteOn: 'contact_reply'` task referencing the replying contact. Decision 17 —
// intentionally coarse: ANY reply from the contact completes ALL their `contact_reply`
// tasks, unrelated topics included (tasks don't reference threads). Snoozed tasks DO
// auto-complete (decision 10 — a reply resolves the follow-up regardless of snooze).
// Completed directly via a db update — this is a system-driven state transition, never
// routed through the task service/tRPC `update` mutation.
//
// Keep top-level imports to types/logger/db only; lazy-import the cache + notification
// service (the lib realtime barrel is reachable from NotificationService and importing it
// from an events handler creates a cycle that breaks vi.mock — see project memory).

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { AuxxEvent, SignalRecordedEvent } from '../types'

const logger = createScopedLogger('handler:auto-complete-tasks')

export const autoCompleteTasks = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'signal:recorded') return
  const data = event.data as SignalRecordedEvent['data']

  if (data.kind !== 'message:replied' || data.backfill || !data.contactEntityInstanceId) return
  const contactEntityInstanceId = data.contactEntityInstanceId

  try {
    const candidates = await db
      .select({
        id: schema.Task.id,
        title: schema.Task.title,
        organizationId: schema.Task.organizationId,
        createdById: schema.Task.createdById,
      })
      .from(schema.Task)
      .innerJoin(schema.TaskReference, eq(schema.TaskReference.taskId, schema.Task.id))
      .where(
        and(
          eq(schema.Task.organizationId, data.organizationId),
          isNull(schema.Task.completedAt),
          isNull(schema.Task.archivedAt),
          eq(schema.Task.autoCompleteOn, 'contact_reply'),
          eq(schema.TaskReference.referencedEntityInstanceId, contactEntityInstanceId),
          isNull(schema.TaskReference.deletedAt)
        )
      )

    if (candidates.length === 0) return

    const taskIds = candidates.map((t) => t.id)
    // Guarded by `completedAt IS NULL` again — idempotent under a concurrent manual
    // complete between the select above and this update. `.returning()` tells us exactly
    // which tasks this call actually completed, so notifications never fire for a task
    // someone else beat us to.
    const completed = await db
      .update(schema.Task)
      // `occurredAt` crosses BullMQ as JSON — it arrives as an ISO string, not a Date.
      .set({ completedAt: new Date(data.occurredAt), completedById: null })
      .where(and(inArray(schema.Task.id, taskIds), isNull(schema.Task.completedAt)))
      .returning({ id: schema.Task.id })

    if (completed.length === 0) return
    const completedIds = new Set(completed.map((t) => t.id))
    const completedTasks = candidates.filter((t) => completedIds.has(t.id))

    const { getOrgCache } = await import('../../cache')
    const systemUserId = await getOrgCache().get(data.organizationId, 'systemUser')

    const { NotificationService } = await import('../../notifications/notification-service')
    const notifications = new NotificationService()

    for (const task of completedTasks) {
      const recipients = await collectAutoCompleteRecipients(
        task.id,
        task.createdById,
        task.organizationId,
        systemUserId
      )
      const message = `Follow-up completed: ${task.title} (contact replied)`
      for (const userId of recipients) {
        try {
          await notifications.sendNotification({
            type: 'TASK_AUTO_COMPLETED',
            userId,
            entityId: task.id,
            entityType: 'task',
            message,
            organizationId: task.organizationId,
            data: { taskId: task.id },
          })
        } catch (error) {
          logger.warn('Failed to send TASK_AUTO_COMPLETED notification', {
            taskId: task.id,
            userId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  } catch (error) {
    logger.error('Auto-complete-on-reply dispatch failed', {
      organizationId: data.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Active assignees + creator-only-when-human (decision 12). Rule-created tasks'
 * `createdById` IS the org system user (decision 2) — skip it so an unassigned rule task
 * dissolves silently on auto-complete instead of "notifying" a system account.
 */
async function collectAutoCompleteRecipients(
  taskId: string,
  createdById: string,
  organizationId: string,
  systemUserId: string | null | undefined
): Promise<string[]> {
  const assignees = await db
    .select({ userId: schema.TaskAssignment.assignedToUserId })
    .from(schema.TaskAssignment)
    .where(
      and(
        eq(schema.TaskAssignment.taskId, taskId),
        eq(schema.TaskAssignment.organizationId, organizationId),
        isNull(schema.TaskAssignment.unassignedAt)
      )
    )

  const set = new Set<string>()
  if (createdById !== systemUserId) set.add(createdById)
  for (const a of assignees) set.add(a.userId)
  return Array.from(set)
}
