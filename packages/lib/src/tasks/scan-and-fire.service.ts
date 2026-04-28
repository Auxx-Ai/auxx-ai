// packages/lib/src/tasks/scan-and-fire.service.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, lte } from 'drizzle-orm'
import { NotificationService } from '../notifications'

type DbOrTx = Database | Transaction

const logger = createScopedLogger('task-deadline-scan-and-fire')

const SCAN_BATCH_SIZE = 200

export interface ScanAndFireResult {
  scanned: number
  fired: number
  notificationsSent: number
}

export interface ScanAndFireOptions {
  /** Wall-clock for the scan; default = `new Date()`. Override for tests. */
  now?: Date
  /** Optional override for tests / DI. */
  notificationService?: NotificationService
}

/**
 * Scan for tasks whose deadline has passed and that haven't been fired yet.
 * For each match: notify task assignees + the creator, then set `firedAt` to
 * make the notification idempotent.
 *
 * Notification audience is `TaskAssignment` rows where `unassignedAt IS NULL`
 * plus `Task.createdById`. Codebase has no watchers/subscribers concept.
 *
 * The scanner is safe to invoke concurrently — `firedAt IS NULL` is checked
 * inside the UPDATE so a second scanner that picked up the same row gets
 * zero affected rows and skips the notification fan-out.
 */
export async function scanAndFireTaskDeadlines(
  options: ScanAndFireOptions = {},
  tx?: DbOrTx
): Promise<ScanAndFireResult> {
  const { now = new Date(), notificationService = new NotificationService() } = options
  const db = tx ?? database

  // Pull a bounded batch of due, un-fired, active tasks.
  const due = await db
    .select({
      id: schema.Task.id,
      title: schema.Task.title,
      organizationId: schema.Task.organizationId,
      createdById: schema.Task.createdById,
      deadline: schema.Task.deadline,
    })
    .from(schema.Task)
    .where(
      and(
        isNull(schema.Task.firedAt),
        isNull(schema.Task.completedAt),
        isNull(schema.Task.archivedAt),
        lte(schema.Task.deadline, now)
      )
    )
    .limit(SCAN_BATCH_SIZE)

  if (due.length === 0) {
    return { scanned: 0, fired: 0, notificationsSent: 0 }
  }

  let fired = 0
  let notificationsSent = 0

  for (const task of due) {
    // Concurrency-safe claim: only the first scanner that flips firedAt sends.
    const claimed = await db
      .update(schema.Task)
      .set({ firedAt: now })
      .where(and(eq(schema.Task.id, task.id), isNull(schema.Task.firedAt)))
      .returning({ id: schema.Task.id })

    if (claimed.length === 0) continue
    fired++

    const recipients = await collectRecipients(db, task.id, task.createdById, task.organizationId)

    const message = buildTaskDeadlineMessage(task.title, task.deadline)
    for (const userId of recipients) {
      try {
        await notificationService.sendNotification({
          type: 'TASK_DEADLINE',
          userId,
          entityId: task.id,
          entityType: 'task',
          message,
          organizationId: task.organizationId,
          data: {
            taskId: task.id,
            deadline: task.deadline?.toISOString() ?? null,
          },
        })
        notificationsSent++
      } catch (error) {
        logger.warn('Failed to send TASK_DEADLINE notification', {
          taskId: task.id,
          userId,
          error: error instanceof Error ? error.message : error,
        })
      }
    }
  }

  return { scanned: due.length, fired, notificationsSent }
}

async function collectRecipients(
  db: DbOrTx,
  taskId: string,
  createdById: string,
  organizationId: string
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
  set.add(createdById)
  for (const a of assignees) set.add(a.userId)
  return Array.from(set)
}

function buildTaskDeadlineMessage(title: string, deadline: Date | null): string {
  if (!deadline) return `Task overdue: ${title}`
  return `Task overdue: ${title}`
}
