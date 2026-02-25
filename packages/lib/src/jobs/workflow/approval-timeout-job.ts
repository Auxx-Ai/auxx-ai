// packages/lib/src/jobs/workflow/approval-timeout-job.ts

import { database as db, schema } from '@auxx/database'
import { ApprovalStatus } from '@auxx/database/enums'
import type { ApprovalRequestEntity as ApprovalRequest } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import { publisher } from '../../events/publisher'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'

const logger = createScopedLogger('approval-timeout-job')
interface ApprovalTimeoutJobData {
  approvalRequestId: string
  workflowRunId: string
  nodeId: string
}
/**
 * Job handler for processing approval request timeouts
 * This job is scheduled when an approval request is created and executes
 * when the approval expires without a response
 */
export async function approvalTimeoutJob(job: Job<ApprovalTimeoutJobData>) {
  const { approvalRequestId, workflowRunId, nodeId } = job.data
  try {
    logger.info('Processing approval timeout', { approvalRequestId, workflowRunId, nodeId })
    // Check if approval is still pending
    const [approvalRequest] = await db
      .select()
      .from(schema.ApprovalRequest)
      .where(eq(schema.ApprovalRequest.id, approvalRequestId))
      .limit(1)
    if (!approvalRequest) {
      logger.warn('Approval request not found', { approvalRequestId })
      return
    }
    if (approvalRequest.status !== ApprovalStatus.pending) {
      logger.info('Approval already processed', {
        approvalRequestId,
        status: approvalRequest.status,
      })
      return
    }
    // Update approval status to timeout
    await db
      .update(schema.ApprovalRequest)
      .set({ status: ApprovalStatus.timeout })
      .where(eq(schema.ApprovalRequest.id, approvalRequestId))
    // Resume workflow with timeout path
    const executionService = new WorkflowExecutionService(db)
    await executionService.resumeWorkflow(workflowRunId, nodeId, {
      outcome: 'timeout',
      approvalRequestId,
      timedOutAt: new Date().toISOString(),
    })
    // Emit timeout event
    await publisher.publishLater({
      type: 'approval:timeout',
      data: {
        approvalRequestId,
        workflowRunId,
        nodeId,
        organizationId: approvalRequest.organizationId,
      },
    })
    // Send timeout notifications to assignees
    await sendTimeoutNotifications(approvalRequest)
    logger.info('Approval request timed out', {
      approvalRequestId,
      workflowRunId,
      expiresAt: approvalRequest.expiresAt,
    })
  } catch (error) {
    logger.error('Failed to handle approval timeout', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      approvalRequestId,
      workflowRunId,
    })
    throw error
  }
}
/**
 * Send notifications to assignees about the timeout
 */
async function sendTimeoutNotifications(approvalRequest: ApprovalRequest): Promise<void> {
  try {
    // Import notification service dynamically to avoid circular dependencies
    const { NotificationService } = await import('../../notifications/notification-service')
    const notificationService = new NotificationService(db)
    // Get all assignee user IDs
    const userIds = new Set(approvalRequest.assigneeUsers)
    // Add users from groups
    if (approvalRequest.assigneeGroups && approvalRequest.assigneeGroups.length > 0) {
      // Note: This complex many-to-many relationship query would require joins
      // For now, using a simpler approach - this may need refinement based on schema
      const groupMembers = await db
        .select({
          userId: schema.OrganizationMember.userId,
        })
        .from(schema.OrganizationMember)
        .where(eq(schema.OrganizationMember.organizationId, approvalRequest.organizationId))
      // TODO: Add proper group filtering when schema structure is clarified
      groupMembers.forEach((member) => userIds.add(member.userId))
    }
    // Send notifications
    for (const userId of userIds) {
      try {
        await notificationService.sendNotification({
          type: 'WORKFLOW_APPROVAL_COMPLETED' as any,
          userId,
          entityId: approvalRequest.id,
          entityType: 'approval_request',
          message: `Approval request for workflow "${approvalRequest.workflowName}" has expired`,
          organizationId: approvalRequest.organizationId,
          data: {
            workflowId: approvalRequest.workflowId,
            workflowRunId: approvalRequest.workflowRunId,
            nodeId: approvalRequest.nodeId,
            expiredAt: approvalRequest.expiresAt,
          },
        })
      } catch (error) {
        logger.warn('Failed to send timeout notification', {
          userId,
          approvalRequestId: approvalRequest.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    logger.error('Failed to send timeout notifications', {
      approvalRequestId: approvalRequest.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
/**
 * Cleanup function to cancel timeout jobs when approval is responded to
 * This is called by the ApprovalResponseService
 */
export async function cancelApprovalTimeoutJob(approvalRequestId: string): Promise<boolean> {
  try {
    const { getQueue, Queues } = await import('../queues')
    const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
    const jobId = `approval-timeout-${approvalRequestId}`
    const job = await workflowDelayQueue.getJob(jobId)
    if (job) {
      await job.remove()
      logger.debug('Cancelled approval timeout job', { jobId, approvalRequestId })
      return true
    }
    return false
  } catch (error) {
    logger.warn('Failed to cancel approval timeout job', {
      approvalRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
