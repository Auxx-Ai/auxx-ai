// packages/lib/src/jobs/workflow/approval-reminder-job.ts

import { env } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { ApprovalStatus } from '@auxx/database/enums'
import { sendApprovalReminderEmail } from '@auxx/email'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { eq, inArray } from 'drizzle-orm'
import { NotificationService } from '../../notifications/notification-service'

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
export async function approvalReminderJob(job: Job<ApprovalReminderJobData>) {
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
      assigneeCount: approvalRequest.assigneeUsers.length + approvalRequest.assigneeGroups.length,
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
  const notificationService = new NotificationService(db)
  // Get all assignee user IDs
  const allUserIds = await getAllAssigneeUserIds(
    approvalRequest.assigneeUsers,
    approvalRequest.assigneeGroups,
    approvalRequest.organizationId
  )
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
  // Send in-app notifications
  for (const userId of allUserIds) {
    try {
      await notificationService.sendNotification({
        type: 'WORKFLOW_APPROVAL_REMINDER' as any,
        userId,
        entityId: approvalRequest.id,
        entityType: 'approval_request',
        message: `Reminder #${reminderNumber}: Approval still pending for "${approvalRequest.workflow.name}" - ${timeRemainingStr} remaining`,
        organizationId: approvalRequest.organizationId,
        data: {
          workflowId: approvalRequest.workflowId,
          workflowRunId: approvalRequest.workflowRunId,
          nodeId: approvalRequest.nodeId,
          reminderNumber,
          timeRemaining: timeRemainingStr,
          expiresAt: approvalRequest.expiresAt.toISOString(),
        },
      })
    } catch (error) {
      logger.warn('Failed to send in-app reminder notification', {
        userId,
        approvalRequestId: approvalRequest.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
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
  // Get user details
  const users = await db
    .select({
      id: schema.User.id,
      email: schema.User.email,
      name: schema.User.name,
    })
    .from(schema.User)
    .where(inArray(schema.User.id, userIds))
  // Generate approval URL
  const approvalUrl = `${env.WEBAPP_URL}/workflows/${approvalRequest.workflowId}/approval/${approvalRequest.id}`
  for (const user of users) {
    try {
      await sendApprovalReminderEmail({
        email: user.email,
        toName: user.name || 'User',
        workflowName: approvalRequest.workflow.name,
        message: approvalRequest.message,
        approvalUrl,
        reminderNumber,
        timeRemaining,
        expiresAt: approvalRequest.expiresAt,
      })
    } catch (error) {
      logger.warn('Failed to send email reminder', {
        userId: user.id,
        email: user.email,
        approvalRequestId: approvalRequest.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
/**
 * Get all users assigned to an approval (direct + groups)
 */
async function getAllAssigneeUserIds(
  directUsers: string[],
  groupIds: string[],
  organizationId: string
): Promise<string[]> {
  const userIds = new Set(directUsers)
  if (groupIds.length > 0) {
    // Note: This complex many-to-many relationship query would require joins
    // For now, using a simpler approach - this may need refinement based on schema
    const groupMembers = await db
      .select({
        userId: schema.OrganizationMember.userId,
      })
      .from(schema.OrganizationMember)
      .where(eq(schema.OrganizationMember.organizationId, organizationId))
    // TODO: Add proper group filtering when schema structure is clarified
    groupMembers.forEach((member) => userIds.add(member.userId))
  }
  return Array.from(userIds)
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
