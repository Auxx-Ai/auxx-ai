// packages/lib/src/jobs/workflow/approval-reminder-job.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { ApprovalStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import {
  approvalEmailEnabledFor,
  getApprovalAssigneeUserIds,
} from '../../approval-requests/approval-recipients'
import { getCachedMembersByUserIds } from '../../cache'
import { enqueueEmailJob } from '../email'
import type { JobContext } from '../types'

const logger = createScopedLogger('approval-reminder-job')
interface ApprovalReminderJobData {
  approvalRequestId: string
  reminderNumber: number
}
/**
 * Job handler for sending approval reminder notifications
 * This job is scheduled at intervals after an approval request is created
 * to remind assignees to take action
 */
export async function approvalReminderJob(ctx: JobContext<ApprovalReminderJobData>) {
  const job = ctx.job
  const { approvalRequestId, reminderNumber } = job.data
  try {
    logger.info('Processing approval reminder', {
      approvalRequestId,
      reminderNumber,
    })
    // Get approval request with reminder info
    // TODO: Uncomment reminders relation when approvalReminder table is added to database schema
    const [approvalRequestData] = await db
      .select({
        approvalRequest: schema.ApprovalRequest,
        workflow: {
          name: schema.Workflow.name,
        },
      })
      .from(schema.ApprovalRequest)
      .leftJoin(schema.Workflow, eq(schema.Workflow.id, schema.ApprovalRequest.workflowId))
      .where(eq(schema.ApprovalRequest.id, approvalRequestId))
      .limit(1)
    const approvalRequest = approvalRequestData
      ? {
          ...approvalRequestData.approvalRequest,
          workflow: approvalRequestData.workflow,
        }
      : null
    if (!approvalRequest) {
      logger.warn('Approval request not found', { approvalRequestId })
      return
    }
    // Check if approval is still pending
    if (approvalRequest.status !== ApprovalStatus.pending) {
      logger.info('Approval no longer pending, skipping reminder', {
        approvalRequestId,
        status: approvalRequest.status,
      })
      return
    }
    // `expiresAt` is nullable. A reminder is a countdown against a deadline —
    // `sendReminderNotifications` derives its whole "time remaining" string from
    // it — so a request with no deadline has nothing to remind against. (The
    // comparison below used to swallow this case by coercing `null` to 0.)
    if (!approvalRequest.expiresAt) {
      logger.info('Approval has no expiry, skipping reminder', { approvalRequestId })
      return
    }
    // Check if already expired
    if (approvalRequest.expiresAt < new Date()) {
      logger.info('Approval already expired, skipping reminder', {
        approvalRequestId,
        expiresAt: approvalRequest.expiresAt,
      })
      return
    }
    // Send reminder notifications
    await sendReminderNotifications(approvalRequest, reminderNumber)
    // Update reminder sent timestamp
    // TODO: Uncomment when approvalReminder table is added to database schema
    // await db.approvalReminder.updateMany({
    //   where: {
    //     approvalRequestId,
    //     reminderNumber
    //   },
    //   data: { sentAt: new Date() }
    // })
    logger.info('Approval reminder sent', {
      approvalRequestId,
      reminderNumber,
      assigneeCount:
        (approvalRequest.assigneeUsers?.length ?? 0) +
        (approvalRequest.assigneeGroups?.length ?? 0),
    })
  } catch (error) {
    logger.error('Failed to send approval reminder', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      approvalRequestId,
      reminderNumber,
    })
    throw error
  }
}
/**
 * Send reminder notifications to all assignees
 */
async function sendReminderNotifications(
  approvalRequest: any,
  reminderNumber: number
): Promise<void> {
  // Get all assignee user IDs
  const allUserIds = await getApprovalAssigneeUserIds({
    assigneeUsers: approvalRequest.assigneeUsers,
    assigneeGroups: approvalRequest.assigneeGroups,
    organizationId: approvalRequest.organizationId,
  })
  // Calculate time remaining
  const timeRemaining = approvalRequest.expiresAt.getTime() - Date.now()
  const hoursRemaining = Math.floor(timeRemaining / (1000 * 60 * 60))
  const minutesRemaining = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))
  // Format time remaining string
  let timeRemainingStr = ''
  if (hoursRemaining > 0) {
    timeRemainingStr = `${hoursRemaining} hour${hoursRemaining > 1 ? 's' : ''}`
    if (minutesRemaining > 0) {
      timeRemainingStr += ` and ${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}`
    }
  } else {
    timeRemainingStr = `${minutesRemaining} minute${minutesRemaining > 1 ? 's' : ''}`
  }
  // Live re-ping, not a notification row. The request is still pending in
  // `ApprovalRequest` and therefore already counted on the bell — a reminder row
  // would push a single approval to 2, and the next one to 3
  // (plans/today/05-bell-and-feed-dedupe.md §1).
  try {
    // Lazy import — see the realtime barrel cycle note in the confirmation node.
    const { getRealtimeService, publishApprovalPing } = await import('../../realtime')
    await publishApprovalPing(getRealtimeService(), allUserIds, {
      approvalRequestId: approvalRequest.id,
      organizationId: approvalRequest.organizationId,
      workflowName: approvalRequest.workflow?.name ?? approvalRequest.subjectLabel,
      expiresAt: approvalRequest.expiresAt?.toISOString() ?? null,
      reminderNumber,
    })
  } catch (error) {
    logger.warn('Failed to ping approval assignees', {
      approvalRequestId: approvalRequest.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  // Send email reminders
  await sendEmailReminders(approvalRequest, allUserIds, reminderNumber, timeRemainingStr)
}
/**
 * Send email reminder notifications
 */
async function sendEmailReminders(
  approvalRequest: any,
  userIds: string[],
  reminderNumber: number,
  timeRemaining: string
): Promise<void> {
  if (userIds.length === 0) return
  const organizationId = approvalRequest.organizationId as string

  // Recipient names/emails are a cache read, and agents are already excluded —
  // `getApprovalAssigneeUserIds` filtered `userType === 'USER'` before this, so
  // the `User` select this replaces was re-deriving a filter it had already been
  // handed. Same three-query shape as the request email (see the confirmation
  // node's `sendEmailNotifications`).
  const members = await getCachedMembersByUserIds(organizationId, userIds)
  // Same recipient gate as the request email — one key for both, so nobody can
  // end up receiving reminders for an email they never got (§7). Batched: the
  // per-user form cost up to two queries EACH.
  const emailAllowed = await approvalEmailEnabledFor(db, organizationId, userIds)

  const approvalUrl = `${WEBAPP_URL}/workflows/${approvalRequest.workflowId}/approval/${approvalRequest.id}`
  for (const user of members.filter((m) => m.user?.email && emailAllowed.has(m.userId))) {
    try {
      await enqueueEmailJob('approval-reminder', {
        recipient: { email: user.user!.email!, name: user.user!.name || 'User' },
        workflowName: approvalRequest.workflow.name,
        message: approvalRequest.message,
        approvalUrl,
        reminderNumber,
        timeRemaining,
        expiresAt: approvalRequest.expiresAt,
        source: 'approval-reminder-job',
        organizationId: approvalRequest.organizationId,
      })
    } catch (error) {
      logger.warn('Failed to send email reminder', {
        userId: user.userId,
        email: user.user?.email,
        approvalRequestId: approvalRequest.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
/**
 * Cancel all reminder jobs for an approval
 * This is called when an approval is responded to or cancelled
 */
export async function cancelApprovalReminderJobs(approvalRequestId: string): Promise<number> {
  try {
    const { getQueue, Queues } = await import('../queues')
    const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
    // Get all reminders for this approval
    // TODO: Uncomment when approvalReminder table is added to database schema
    // const reminders = await db.approvalReminder.findMany({
    //   where: {
    //     approvalRequestId,
    //     sentAt: null // Only unsent reminders
    //   }
    // })
    const reminders: any[] = [] // Temporary empty array until table is created
    let cancelledCount = 0
    for (const reminder of reminders) {
      const jobId = `approval-reminder-${approvalRequestId}-${reminder.reminderNumber}`
      try {
        const job = await workflowDelayQueue.getJob(jobId)
        if (job) {
          await job.remove()
          cancelledCount++
        }
      } catch (error) {
        logger.warn('Failed to cancel reminder job', {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (cancelledCount > 0) {
      logger.debug('Cancelled approval reminder jobs', {
        approvalRequestId,
        cancelledCount,
      })
    }
    return cancelledCount
  } catch (error) {
    logger.error('Failed to cancel approval reminder jobs', {
      approvalRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}
