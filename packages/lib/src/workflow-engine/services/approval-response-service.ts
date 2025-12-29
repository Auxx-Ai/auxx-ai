// packages/lib/src/workflow-engine/services/approval-response-service.ts
import { database as db, schema, type Database } from '@auxx/database'
import { eq, count, and, sql } from 'drizzle-orm'
import { getQueue, Queues } from '../../jobs/queues'
import { publisher } from '../../events/publisher'
import { WorkflowExecutionService } from '../../workflows/workflow-execution-service'
import { createScopedLogger } from '@auxx/logger'
const logger = createScopedLogger('approval-response-service')
interface ApprovalResponseResult {
  success: boolean
  message: string
  nextPath?: string
}
/**
 * Service for processing approval responses (approve/deny actions)
 */
export class ApprovalResponseService {
  constructor(private db: Database) {}
  /**
   * Process an approval response from a user
   */
  async processApprovalResponse(
    approvalRequestId: string,
    userId: string,
    action: 'approve' | 'deny',
    comment?: string,
    ipAddress?: string
  ): Promise<ApprovalResponseResult> {
    // Start transaction
    return await this.db.transaction(async (tx) => {
      // Get the approval request with responses using relational query API
      const approvalRequest = await tx.query.ApprovalRequest.findFirst({
        where: (t, { eq }) => eq(t.id, approvalRequestId),
        with: {
          responses: true,
        },
      })
      if (!approvalRequest) {
        throw new Error('Approval request not found')
      }
      const responses = approvalRequest.responses
      if (approvalRequest.status !== 'pending') {
        return {
          success: false,
          message: `Approval already ${approvalRequest.status}`,
        }
      }
      if (approvalRequest.expiresAt && approvalRequest.expiresAt < new Date()) {
        return {
          success: false,
          message: 'Approval request has expired',
        }
      }
      // Check if user already responded
      const existingResponse = responses.find((r) => r.userId === userId)
      if (existingResponse) {
        return {
          success: false,
          message: 'You have already responded to this approval',
        }
      }
      // Create response record
      await tx.insert(schema.ApprovalResponse).values({
        approvalRequestId,
        userId,
        action: action === 'approve' ? 'approve' : 'deny',
        comment,
        responseMethod: 'web',
        ipAddress,
      })
      // Update approval status (first response wins)
      const newStatus = action === 'approve' ? 'approved' : 'denied'
      await tx
        .update(schema.ApprovalRequest)
        .set({ status: newStatus })
        .where(eq(schema.ApprovalRequest.id, approvalRequestId))
      // Cancel timeout job
      await this.cancelTimeoutJob(approvalRequestId)
      // Resume workflow
      const executionService = new WorkflowExecutionService(tx as any)
      const nextPath = action === 'approve' ? 'approved' : 'denied'
      try {
        await executionService.resumeWorkflow(
          approvalRequest.workflowRunId,
          approvalRequest.nodeId,
          {
            outcome: action,
            approvalRequestId,
            respondedBy: userId,
            respondedAt: new Date().toISOString(),
            comment,
          }
        )
      } catch (resumeError) {
        logger.error('Failed to resume workflow after approval', {
          approvalRequestId,
          workflowRunId: approvalRequest.workflowRunId,
          error: resumeError instanceof Error ? resumeError.message : String(resumeError),
        })
        // Re-throw to roll back the transaction
        throw new Error(
          `Failed to resume workflow: ${resumeError instanceof Error ? resumeError.message : 'Unknown error'}`
        )
      }
      // Emit response event
      await publisher.publishLater({
        type: 'approval:responded',
        data: {
          approvalRequestId,
          workflowRunId: approvalRequest.workflowRunId,
          action,
          userId,
          organizationId: approvalRequest.organizationId,
        },
      })
      return {
        success: true,
        message: `Workflow ${action}d successfully`,
        nextPath,
      }
    })
  }
  /**
   * Process approval via email link (with token validation)
   */
  async processEmailApproval(
    approvalRequestId: string,
    action: 'approve' | 'deny',
    token: string,
    ipAddress?: string
  ): Promise<ApprovalResponseResult> {
    // Validate token
    const tokenData = await this.validateApprovalToken(approvalRequestId, token)
    if (!tokenData.valid) {
      return {
        success: false,
        message: tokenData.message || 'Invalid approval link',
      }
    }
    // Process the approval
    return await this.processApprovalResponse(
      approvalRequestId,
      tokenData.userId!,
      action,
      undefined,
      ipAddress
    )
  }
  /**
   * Cancel an approval request
   */
  async cancelApprovalRequest(
    approvalRequestId: string,
    cancelledBy: string,
    reason?: string
  ): Promise<void> {
    const approvalRequest = await this.db.query.ApprovalRequest.findFirst({
      where: (t, { eq }) => eq(t.id, approvalRequestId),
    })
    if (!approvalRequest) {
      throw new Error('Approval request not found')
    }
    if (approvalRequest.status !== 'pending') {
      throw new Error(`Cannot cancel approval in status ${approvalRequest.status}`)
    }
    // Resume workflow with cancelled outcome
    const executionService = new WorkflowExecutionService(this.db as any)
    await executionService.resumeWorkflow(
      approvalRequest.workflowRunId,
      approvalRequest.nodeId,
      {
        outcome: 'denied',
        approvalRequestId,
        cancelledBy,
        cancelledAt: new Date().toISOString(),
        cancelReason: reason,
      }
    )
    // Update status to timeout with cancellation metadata
    await this.db
      .update(schema.ApprovalRequest)
      .set({
        status: 'timeout',
        metadata: {
          ...((approvalRequest.metadata as any) || {}),
          cancelled: true,
          cancelledBy,
          cancelledAt: new Date().toISOString(),
          cancelReason: reason,
        },
      })
      .where(eq(schema.ApprovalRequest.id, approvalRequestId))
    // Cancel timeout job
    await this.cancelTimeoutJob(approvalRequestId)
    // Cancel reminder jobs
    await this.cancelReminderJobs(approvalRequestId)
    // Emit cancellation event
    await publisher.publishLater({
      type: 'approval:cancelled',
      data: {
        approvalRequestId,
        workflowRunId: approvalRequest.workflowRunId,
        cancelledBy,
        organizationId: approvalRequest.organizationId,
      },
    })
    logger.info('Approval request cancelled', {
      approvalRequestId,
      cancelledBy,
      reason,
    })
  }
  /**
   * Bulk approve/deny multiple requests
   */
  async processBulkApprovals(
    userId: string,
    approvalIds: string[],
    action: 'approve' | 'deny',
    comment?: string
  ): Promise<{
    successful: string[]
    failed: {
      id: string
      reason: string
    }[]
  }> {
    const successful: string[] = []
    const failed: {
      id: string
      reason: string
    }[] = []
    for (const approvalId of approvalIds) {
      try {
        const result = await this.processApprovalResponse(approvalId, userId, action, comment)
        if (result.success) {
          successful.push(approvalId)
        } else {
          failed.push({ id: approvalId, reason: result.message })
        }
      } catch (error) {
        failed.push({
          id: approvalId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
    return { successful, failed }
  }
  /**
   * Generate approval token for email links
   */
  async generateApprovalToken(approvalRequestId: string, userId: string): Promise<string> {
    // This is a simplified version - in production, use proper JWT or similar
    const token = Buffer.from(
      JSON.stringify({
        approvalRequestId,
        userId,
        timestamp: Date.now(),
      })
    ).toString('base64')
    // Store token in cache or database for validation
    // For now, we'll use metadata
    const approvalRequest = await this.db.query.ApprovalRequest.findFirst({
      where: (t, { eq }) => eq(t.id, approvalRequestId),
    })
    if (approvalRequest) {
      await this.db
        .update(schema.ApprovalRequest)
        .set({
          metadata: {
            ...((approvalRequest.metadata as any) || {}),
            approvalTokens: {
              ...((approvalRequest.metadata as any)?.approvalTokens || {}),
              [userId]: token,
            },
          },
        })
        .where(eq(schema.ApprovalRequest.id, approvalRequestId))
    }
    return token
  }
  /**
   * Validate approval token
   */
  private async validateApprovalToken(
    approvalRequestId: string,
    token: string
  ): Promise<{
    valid: boolean
    userId?: string
    message?: string
  }> {
    try {
      // Decode token
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString())
      if (decoded.approvalRequestId !== approvalRequestId) {
        return { valid: false, message: 'Invalid token' }
      }
      // Check token age (24 hours)
      const tokenAge = Date.now() - decoded.timestamp
      if (tokenAge > 24 * 60 * 60 * 1000) {
        return { valid: false, message: 'Token expired' }
      }
      // Verify token in database
      const approvalRequest = await this.db.query.ApprovalRequest.findFirst({
        where: (t, { eq }) => eq(t.id, approvalRequestId),
      })
      const metadata = approvalRequest?.metadata as any
      const storedToken = metadata?.approvalTokens?.[decoded.userId]
      if (storedToken !== token) {
        return { valid: false, message: 'Invalid token' }
      }
      return { valid: true, userId: decoded.userId }
    } catch (error) {
      logger.error('Token validation failed', { error })
      return { valid: false, message: 'Invalid token format' }
    }
  }
  /**
   * Cancel timeout job for an approval
   */
  private async cancelTimeoutJob(approvalRequestId: string): Promise<void> {
    const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
    const jobId = `approval-timeout-${approvalRequestId}`
    try {
      const job = await workflowDelayQueue.getJob(jobId)
      if (job) {
        await job.remove()
        logger.debug('Cancelled timeout job', { jobId })
      }
    } catch (error) {
      // Job might already be processed
      logger.warn('Failed to cancel timeout job', { jobId, error })
    }
  }
  /**
   * Cancel all reminder jobs for an approval
   */
  private async cancelReminderJobs(approvalRequestId: string): Promise<void> {
    const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
    // TODO: Implement when ApprovalReminder table is added to schema
    // For now, we'll try to cancel reminder jobs by pattern matching
    // since we don't have the reminder database table yet
    // Try to cancel reminder jobs for this approval (max 10 reminders)
    for (let i = 1; i <= 10; i++) {
      const jobId = `approval-reminder-${approvalRequestId}-${i}`
      try {
        const job = await workflowDelayQueue.getJob(jobId)
        if (job) {
          await job.remove()
          logger.debug('Cancelled reminder job', { jobId })
        }
      } catch (error) {
        // Job might not exist or already be processed
        logger.debug('Failed to cancel reminder job', { jobId, error })
      }
    }
  }
  /**
   * Get approval response statistics for a user
   */
  async getUserApprovalStats(userId: string, organizationId: string) {
    const [totalResponded, approvedCount, deniedCount, avgResponseTime] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(schema.ApprovalResponse)
        .leftJoin(
          schema.ApprovalRequest,
          eq(schema.ApprovalResponse.approvalRequestId, schema.ApprovalRequest.id)
        )
        .where(
          and(
            eq(schema.ApprovalResponse.userId, userId),
            eq(schema.ApprovalRequest.organizationId, organizationId)
          )
        )
        .then((result) => result[0]?.count || 0),
      this.db
        .select({ count: count() })
        .from(schema.ApprovalResponse)
        .leftJoin(
          schema.ApprovalRequest,
          eq(schema.ApprovalResponse.approvalRequestId, schema.ApprovalRequest.id)
        )
        .where(
          and(
            eq(schema.ApprovalResponse.userId, userId),
            eq(schema.ApprovalResponse.action, 'approve'),
            eq(schema.ApprovalRequest.organizationId, organizationId)
          )
        )
        .then((result) => result[0]?.count || 0),
      this.db
        .select({ count: count() })
        .from(schema.ApprovalResponse)
        .leftJoin(
          schema.ApprovalRequest,
          eq(schema.ApprovalResponse.approvalRequestId, schema.ApprovalRequest.id)
        )
        .where(
          and(
            eq(schema.ApprovalResponse.userId, userId),
            eq(schema.ApprovalResponse.action, 'deny'),
            eq(schema.ApprovalRequest.organizationId, organizationId)
          )
        )
        .then((result) => result[0]?.count || 0),
      this.db
        .select({
          avgResponseTime: sql<number>`AVG(EXTRACT(EPOCH FROM (${schema.ApprovalResponse.respondedAt}::timestamptz - ${schema.ApprovalRequest.createdAt}::timestamptz)))`,
        })
        .from(schema.ApprovalRequest)
        .innerJoin(
          schema.ApprovalResponse,
          eq(schema.ApprovalResponse.approvalRequestId, schema.ApprovalRequest.id)
        )
        .where(
          and(
            eq(schema.ApprovalResponse.userId, userId),
            eq(schema.ApprovalRequest.organizationId, organizationId)
          )
        )
        .then((result) => result[0]?.avgResponseTime || 0),
    ])
    return {
      totalResponded,
      approvedCount,
      deniedCount,
      approvalRate: totalResponded > 0 ? (approvedCount / totalResponded) * 100 : 0,
      avgResponseTimeHours: (avgResponseTime || 0) / 3600,
    }
  }
}
