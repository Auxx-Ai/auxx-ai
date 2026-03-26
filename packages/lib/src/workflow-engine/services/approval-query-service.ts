// packages/lib/src/workflow-engine/services/approval-query-service.ts
import { type Database, schema } from '@auxx/database'
import { ApprovalStatus, MemberType } from '@auxx/database/enums'
import type { ApprovalStatus as ApprovalStatusType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, count, desc, eq, gt, gte, inArray, lt, lte, or, sql } from 'drizzle-orm'
import { NotificationService } from '../../notifications/notification-service'

const logger = createScopedLogger('approval-query-service')
/**
 * Service for querying and managing approval requests
 */
export class ApprovalQueryService {
  constructor(private db: Database) {}
  /**
   * Get all pending approval requests for a specific user
   * Filters out approvals for workflows that are no longer running
   */
  async getPendingApprovalsForUser(userId: string, organizationId: string) {
    // Get user's groups through EntityGroupMember
    const userGroupMemberships = await this.db
      .select({ groupId: schema.EntityGroupMember.groupInstanceId })
      .from(schema.EntityGroupMember)
      .innerJoin(
        schema.EntityInstance,
        eq(schema.EntityGroupMember.groupInstanceId, schema.EntityInstance.id)
      )
      .where(
        and(
          eq(schema.EntityGroupMember.memberType, MemberType.user),
          eq(schema.EntityGroupMember.memberRefId, userId),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      )
    const userGroups = userGroupMemberships.map((gm) => gm.groupId)
    return await this.db
      .select({
        id: schema.ApprovalRequest.id,
        organizationId: schema.ApprovalRequest.organizationId,
        status: schema.ApprovalRequest.status,
        expiresAt: schema.ApprovalRequest.expiresAt,
        assigneeUsers: schema.ApprovalRequest.assigneeUsers,
        assigneeGroups: schema.ApprovalRequest.assigneeGroups,
        createdAt: schema.ApprovalRequest.createdAt,
        workflowId: schema.ApprovalRequest.workflowId,
        workflowRunId: schema.ApprovalRequest.workflowRunId,
        workflow: {
          name: schema.Workflow.name,
          id: schema.Workflow.id,
        },
        workflowRun: {
          status: schema.WorkflowRun.status,
        },
        // Note: responses would need a separate query or additional join
      })
      .from(schema.ApprovalRequest)
      .leftJoin(schema.Workflow, eq(schema.ApprovalRequest.workflowId, schema.Workflow.id))
      .leftJoin(schema.WorkflowRun, eq(schema.ApprovalRequest.workflowRunId, schema.WorkflowRun.id))
      .where(
        and(
          eq(schema.ApprovalRequest.organizationId, organizationId),
          eq(schema.ApprovalRequest.status, 'pending' as any),
          gt(schema.ApprovalRequest.expiresAt, new Date()),
          or(
            sql`${userId} = ANY(${schema.ApprovalRequest.assigneeUsers})`,
            userGroups.length > 0
              ? sql`${schema.ApprovalRequest.assigneeGroups} && ${userGroups}`
              : sql`false`
          ),
          inArray(schema.WorkflowRun.status, ['RUNNING', 'WAITING'])
        )
      )
      .orderBy(schema.ApprovalRequest.createdAt)
  }
  /**
   * Get count of pending approvals for a user
   * Filters out approvals for workflows that are no longer running
   */
  async getPendingCount(userId: string, organizationId: string): Promise<number> {
    // Get user's groups through EntityGroupMember
    const userGroupMemberships = await this.db
      .select({ groupId: schema.EntityGroupMember.groupInstanceId })
      .from(schema.EntityGroupMember)
      .innerJoin(
        schema.EntityInstance,
        eq(schema.EntityGroupMember.groupInstanceId, schema.EntityInstance.id)
      )
      .where(
        and(
          eq(schema.EntityGroupMember.memberType, MemberType.user),
          eq(schema.EntityGroupMember.memberRefId, userId),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      )
    const userGroups = userGroupMemberships.map((gm) => gm.groupId)
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.ApprovalRequest)
      .leftJoin(schema.WorkflowRun, eq(schema.ApprovalRequest.workflowRunId, schema.WorkflowRun.id))
      .where(
        and(
          eq(schema.ApprovalRequest.organizationId, organizationId),
          eq(schema.ApprovalRequest.status, ApprovalStatus.pending),
          gt(schema.ApprovalRequest.expiresAt, new Date()),
          or(
            sql`${userId} = ANY(${schema.ApprovalRequest.assigneeUsers})`,
            userGroups.length > 0
              ? sql`${schema.ApprovalRequest.assigneeGroups} && ${userGroups}`
              : sql`false`
          ),
          inArray(schema.WorkflowRun.status, ['RUNNING', 'WAITING'])
        )
      )
    return count
  }
  /**
   * Check if a user can approve a specific request
   */
  async canUserApprove(userId: string, approvalRequestId: string): Promise<boolean> {
    const [request] = await this.db
      .select()
      .from(schema.ApprovalRequest)
      .where(eq(schema.ApprovalRequest.id, approvalRequestId))
      .limit(1)
    if (!request || request.status !== 'pending' || request!.expiresAt < new Date()) {
      return false
    }
    // Check if user is a member of the organization
    const [userMembership] = await this.db
      .select()
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.userId, userId),
          eq(schema.OrganizationMember.organizationId, request.organizationId)
        )
      )
      .limit(1)
    if (!userMembership) return false
    // Get user's groups through EntityGroupMember
    const userGroupMemberships = await this.db
      .select({ groupId: schema.EntityGroupMember.groupInstanceId })
      .from(schema.EntityGroupMember)
      .innerJoin(
        schema.EntityInstance,
        eq(schema.EntityGroupMember.groupInstanceId, schema.EntityInstance.id)
      )
      .where(
        and(
          eq(schema.EntityGroupMember.memberType, MemberType.user),
          eq(schema.EntityGroupMember.memberRefId, userId),
          eq(schema.EntityInstance.organizationId, request.organizationId)
        )
      )
    const userGroupIds = userGroupMemberships.map((gm) => gm.groupId)
    return (
      request.assigneeUsers.includes(userId) ||
      request.assigneeGroups.some((groupId) => userGroupIds.includes(groupId))
    )
  }
  /**
   * Get approval request with full context including workflow run data
   * Note: Complex includes converted to explicit query structure
   */
  async getApprovalRequestWithContext(approvalRequestId: string) {
    // Get main approval request with workflow and workflow run data
    const [approvalRequest] = await this.db
      .select({
        id: schema.ApprovalRequest.id,
        organizationId: schema.ApprovalRequest.organizationId,
        workflowId: schema.ApprovalRequest.workflowId,
        workflowRunId: schema.ApprovalRequest.workflowRunId,
        nodeId: schema.ApprovalRequest.nodeId,
        nodeName: schema.ApprovalRequest.nodeName,
        workflowName: schema.ApprovalRequest.workflowName,
        status: schema.ApprovalRequest.status,
        message: schema.ApprovalRequest.message,
        assigneeUsers: schema.ApprovalRequest.assigneeUsers,
        assigneeGroups: schema.ApprovalRequest.assigneeGroups,
        expiresAt: schema.ApprovalRequest.expiresAt,
        createdAt: schema.ApprovalRequest.createdAt,
        workflow: schema.Workflow,
        workflowRun: {
          id: schema.WorkflowRun.id,
          status: schema.WorkflowRun.status,
          createdAt: schema.WorkflowRun.createdAt,
          userId: schema.WorkflowRun.createdBy,
        },
        user: {
          id: schema.User.id,
          name: schema.User.name,
          email: schema.User.email,
          image: schema.User.image,
        },
      })
      .from(schema.ApprovalRequest)
      .leftJoin(schema.Workflow, eq(schema.ApprovalRequest.workflowId, schema.Workflow.id))
      .leftJoin(schema.WorkflowRun, eq(schema.ApprovalRequest.workflowRunId, schema.WorkflowRun.id))
      .leftJoin(schema.User, eq(schema.WorkflowRun.createdBy, schema.User.id))
      .where(eq(schema.ApprovalRequest.id, approvalRequestId))
      .limit(1)
    if (!approvalRequest) return null
    // Get node executions separately due to complexity
    const nodeExecutions = await this.db
      .select()
      .from(schema.WorkflowNodeExecution)
      .where(
        and(
          eq(schema.WorkflowNodeExecution.workflowRunId, approvalRequest.workflowRunId),
          eq(schema.WorkflowNodeExecution.status, 'succeeded')
        )
      )
      .orderBy(desc(schema.WorkflowNodeExecution.createdAt))
      .limit(10)
    // Get responses with user data separately
    const responses = await this.db
      .select({
        id: schema.ApprovalResponse.id,
        action: schema.ApprovalResponse.action,
        respondedAt: schema.ApprovalResponse.respondedAt,
        user: {
          id: schema.User.id,
          name: schema.User.name,
          email: schema.User.email,
          image: schema.User.image,
        },
      })
      .from(schema.ApprovalResponse)
      .leftJoin(schema.User, eq(schema.ApprovalResponse.userId, schema.User.id))
      .where(eq(schema.ApprovalResponse.approvalRequestId, approvalRequestId))
    return {
      ...approvalRequest,
      workflowRun: {
        ...approvalRequest.workflowRun,
        user: approvalRequest.user,
        nodeExecutions,
      },
      responses,
    }
  }
  /**
   * Get approval history for a workflow
   */
  async getWorkflowApprovalHistory(workflowId: string, limit = 50) {
    return this.db.query.ApprovalRequest.findMany({
      where: (t, { eq }) => eq(t.workflowId, workflowId),
      with: {
        responses: {
          with: {
            user: {
              columns: { id: true, name: true, email: true },
            },
          },
        },
      },
      orderBy: [desc(schema.ApprovalRequest.createdAt)],
      limit,
    })
  }
  /**
   * Get approvals by status for an organization
   */
  async getApprovalsByStatus(organizationId: string, status: ApprovalStatusType, limit = 100) {
    return this.db.query.ApprovalRequest.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.organizationId, organizationId), eq(t.status as any, status as any)),
      columns: {
        id: true,
        organizationId: true,
        workflowId: true,
        workflowRunId: true,
        nodeId: true,
        nodeName: true,
        status: true,
        message: true,
        assigneeUsers: true,
        assigneeGroups: true,
        workflowName: true,
        createdById: true,
        createdAt: true,
        expiresAt: true,
        metadata: true,
      },
      with: {
        workflow: {
          columns: { id: true, name: true },
        },
        responses: {
          with: {
            user: {
              columns: { id: true, name: true, email: true },
            },
          },
        },
      },
      orderBy: [desc(schema.ApprovalRequest.createdAt)],
      limit,
    })
  }
  /**
   * Get approval metrics for an organization
   */
  async getApprovalMetrics(organizationId: string, startDate?: Date, endDate?: Date) {
    // Base conditions
    const rangeConds: any[] = []
    if (startDate) rangeConds.push(gte(schema.ApprovalRequest.createdAt, startDate))
    if (endDate) rangeConds.push(lte(schema.ApprovalRequest.createdAt, endDate))

    const baseWhere = and(
      eq(schema.ApprovalRequest.organizationId, organizationId),
      ...(rangeConds as any)
    )

    const countsPromise = async (extra?: any) => {
      const [{ cnt }] = await this.db
        .select({ cnt: count() })
        .from(schema.ApprovalRequest)
        .where(extra ? and(baseWhere, extra) : baseWhere)
      return Number((cnt as any) ?? 0)
    }

    const [total, pending, approved, denied, timeout] = await Promise.all([
      countsPromise(),
      countsPromise(eq(schema.ApprovalRequest.status, 'pending' as any)),
      countsPromise(eq(schema.ApprovalRequest.status, 'approved' as any)),
      countsPromise(eq(schema.ApprovalRequest.status, 'denied' as any)),
      countsPromise(eq(schema.ApprovalRequest.status, 'timeout' as any)),
    ])

    // Average response time (seconds) for approved/denied
    const [{ avg }] = await this.db
      .select({
        avg: sql<number>`AVG(EXTRACT(EPOCH FROM (${schema.ApprovalResponse.respondedAt}::timestamptz - ${schema.ApprovalRequest.createdAt}::timestamptz)))`,
      })
      .from(schema.ApprovalRequest)
      .innerJoin(
        schema.ApprovalResponse,
        eq(schema.ApprovalResponse.approvalRequestId, schema.ApprovalRequest.id)
      )
      .where(
        and(
          eq(schema.ApprovalRequest.organizationId, organizationId),
          inArray(schema.ApprovalRequest.status, ['approved', 'denied'] as any),
          ...(startDate ? [gte(schema.ApprovalRequest.createdAt, startDate)] : []),
          ...(endDate ? [lte(schema.ApprovalRequest.createdAt, endDate)] : [])
        )
      )
    const avgResponseTimeSeconds = Number(avg ?? 0)
    return {
      total,
      pending,
      approved,
      denied,
      timeout,
      approvalRate: total > 0 ? (approved / total) * 100 : 0,
      denialRate: total > 0 ? (denied / total) * 100 : 0,
      timeoutRate: total > 0 ? (timeout / total) * 100 : 0,
      avgResponseTimeHours: avgResponseTimeSeconds / 3600,
    }
  }
  /**
   * Clean up expired pending approvals
   */
  async cleanupExpiredApprovals(): Promise<number> {
    const updated = await this.db
      .update(schema.ApprovalRequest)
      .set({ status: 'timeout' as any })
      .where(
        and(
          eq(schema.ApprovalRequest.status, 'pending' as any),
          lt(schema.ApprovalRequest.expiresAt, new Date())
        )
      )
      .returning({ id: schema.ApprovalRequest.id })
    const count = updated.length
    if (count > 0) {
      logger.info(`Cleaned up ${count} expired approval requests`)
    }
    return count
  }
  /**
   * Clean up orphaned approval requests for stopped/failed workflows
   */
  async cleanupOrphanedApprovals(organizationId?: string): Promise<number> {
    // Find workflow run IDs that are no longer active
    const terminalRuns = await this.db
      .select({ id: schema.WorkflowRun.id })
      .from(schema.WorkflowRun)
      .where(inArray(schema.WorkflowRun.status, ['STOPPED', 'FAILED', 'SUCCEEDED'] as any))

    const runIds = terminalRuns.map((r) => r.id)
    if (runIds.length === 0) return 0

    const updated = await this.db
      .update(schema.ApprovalRequest)
      .set({
        status: 'timeout' as any,
        metadata: { reason: 'workflow_terminated', cleanedUpAt: new Date().toISOString() } as any,
      })
      .where(
        and(
          eq(schema.ApprovalRequest.status, 'pending' as any),
          inArray(schema.ApprovalRequest.workflowRunId, runIds),
          ...(organizationId ? [eq(schema.ApprovalRequest.organizationId, organizationId)] : [])
        )
      )
      .returning({ id: schema.ApprovalRequest.id })
    const count = updated.length
    if (count > 0) {
      logger.info(`Cleaned up ${count} orphaned approval requests for terminated workflows`, {
        organizationId,
      })
    }
    return count
  }
  /**
   * Clean up orphaned approvals for a specific workflow run
   * Also cleans up related notifications
   */
  async cleanupApprovalsForWorkflowRun(workflowRunId: string): Promise<number> {
    // First, get the approval requests that will be cleaned up so we can delete their notifications
    const approvalsToCleanup = await this.db
      .select({
        id: schema.ApprovalRequest.id,
        organizationId: schema.ApprovalRequest.organizationId,
      })
      .from(schema.ApprovalRequest)
      .where(
        and(
          eq(schema.ApprovalRequest.workflowRunId, workflowRunId),
          eq(schema.ApprovalRequest.status, 'pending' as any)
        )
      )
    // Update the approval requests
    const updated = await this.db
      .update(schema.ApprovalRequest)
      .set({
        status: 'timeout' as any,
        metadata: { reason: 'workflow_terminated', cleanedUpAt: new Date().toISOString() } as any,
      })
      .where(
        and(
          eq(schema.ApprovalRequest.workflowRunId, workflowRunId),
          eq(schema.ApprovalRequest.status, 'pending' as any)
        )
      )
      .returning({ id: schema.ApprovalRequest.id })
    // Clean up related notifications
    if (approvalsToCleanup.length > 0) {
      try {
        const notificationService = new NotificationService(this.db)
        let totalNotificationsDeleted = 0
        for (const approval of approvalsToCleanup) {
          const deletedCount = await notificationService.deleteNotificationsByEntity(
            'approval_request',
            approval.id,
            approval.organizationId
          )
          totalNotificationsDeleted += deletedCount
        }
        logger.info(
          `Cleaned up ${totalNotificationsDeleted} notifications for ${updated.length} approval requests`,
          {
            workflowRunId,
            approvalCount: updated.length,
            notificationCount: totalNotificationsDeleted,
          }
        )
      } catch (notificationError) {
        logger.error('Failed to cleanup notifications for approval requests', {
          workflowRunId,
          error:
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError),
        })
        // Don't throw - approval cleanup succeeded, notification cleanup is best effort
      }
    }
    if (updated.length > 0) {
      logger.info(
        `Cleaned up ${updated.length} approval requests for workflow run ${workflowRunId}`
      )
    }
    return updated.length
  }
  /**
   * Get users who haven't responded to an approval
   */
  async getPendingApprovers(approvalRequestId: string): Promise<string[]> {
    const request = await this.db.query.ApprovalRequest.findFirst({
      where: (t, { eq }) => eq(t.id, approvalRequestId),
      columns: {
        id: true,
        organizationId: true,
        assigneeUsers: true,
        assigneeGroups: true,
      },
      with: {
        responses: {
          columns: { userId: true },
        },
      },
    })
    if (!request) return []
    const respondedUserIds = new Set((request.responses ?? []).map((r) => r.userId))
    // Get all potential approvers
    const allApprovers = new Set<string>(request.assigneeUsers ?? [])
    // Add users from groups (via EntityGroupMember)
    if ((request.assigneeGroups?.length ?? 0) > 0) {
      const groupMembers = await this.db.query.EntityGroupMember.findMany({
        where: and(
          inArray(schema.EntityGroupMember.groupInstanceId, request.assigneeGroups as string[]),
          eq(schema.EntityGroupMember.memberType, MemberType.user)
        ),
        columns: { memberRefId: true },
      })
      groupMembers.forEach((member) => allApprovers.add(member.memberRefId))
    }
    // Return users who haven't responded
    return Array.from(allApprovers).filter((userId) => !respondedUserIds.has(userId))
  }
}
