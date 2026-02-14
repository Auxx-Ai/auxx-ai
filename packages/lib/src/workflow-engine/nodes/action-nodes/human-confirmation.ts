// packages/lib/src/workflow-engine/nodes/action-nodes/human-confirmation.ts

import { env } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { ApprovalStatus } from '@auxx/database/enums'
import {
  ApprovalRequestModel,
  UserModel,
  WorkflowModel,
  WorkflowRunModel,
} from '@auxx/database/models'
import { sendApprovalRequestEmail } from '@auxx/email'
import { eq, inArray } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { publisher } from '../../../events/publisher'
import { getQueue, Queues } from '../../../jobs/queues'
import { NotificationService } from '../../../notifications/notification-service'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

interface HumanConfirmationNodeData {
  // Basic configuration
  message?: string
  assignees: {
    userIds?: string[]
    groups?: string[]
  }
  // Notification settings
  notification_methods: {
    in_app: boolean
    email: boolean
  }
  // Timeout settings
  timeout: {
    duration: number
    unit: 'minutes' | 'hours' | 'days'
  }
  reminders?: {
    enabled: boolean
    first_after: number
    repeat_every: number
    max_reminders: number
    unit: 'minutes' | 'hours' | 'days'
  }
  require_login: boolean
  // Test mode
  test_behavior?: 'always_approve' | 'always_deny' | 'random' | 'delayed' | 'live'
  test_delay?: number // seconds
  // Additional metadata
  include_workflow_context?: boolean
}
/**
 * Processor for manual confirmation nodes that pause workflow execution
 * and wait for human approval/denial before continuing
 */
export class HumanConfirmationProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.HUMAN_CONFIRMATION
  /**
   * Preprocess human confirmation node - simple and clean approach
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as unknown as HumanConfirmationNodeData
    // 1. Interpolate message early
    const message = config.message
      ? await this.interpolateVariables(config.message, contextManager)
      : 'Human confirmation required'
    // 2. Resolve assignees early
    const assignees = await this.resolveAssignees(config.assignees, contextManager)
    // 3. Calculate timeout once
    const timeoutMs = await this.calculateTimeoutMs(config.timeout, contextManager)
    const expiresAt = new Date(Date.now() + timeoutMs)
    return {
      inputs: { message, assignees, expiresAt, timeoutMs },
      metadata: {
        nodeType: 'human-confirmation',
        assigneeCount: assignees.userIds.length + assignees.groups.length,
        hasTimeout: true,
        preprocessedAt: new Date().toISOString(),
      },
    }
  }
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const config = node.data as unknown as HumanConfirmationNodeData
    // Get the main workflow run ID from options (not the branch execution ID)
    const workflowRunId =
      contextManager.getOptions()?.workflowRunId || contextManager.getContext().executionId
    const organizationId = contextManager.getContext().organizationId
    const isDryRun = contextManager.isDebugMode()
    try {
      // Handle test/dry run mode (except for 'live' which acts like production)
      // If test_behavior is 'live', always act like production regardless of isDryRun
      if (config.test_behavior === 'live') {
        // Continue to live mode execution below
      } else if (isDryRun || config.test_behavior) {
        return await this.handleTestMode(node, config, contextManager)
      }
      // Check if we're running in 'live' test mode
      const isTestMode = config.test_behavior === 'live'
      // Use preprocessed data if available, otherwise compute on the fly
      let message: string | undefined
      let assignees: {
        userIds: string[]
        groups: string[]
      }
      let expiresAt: Date
      if (preprocessedData?.inputs) {
        // Use preprocessed values
        message = preprocessedData.inputs.message
        assignees = preprocessedData.inputs.assignees
        expiresAt = preprocessedData.inputs.expiresAt
      } else {
        // Fallback to runtime computation
        assignees = await this.resolveAssignees(config.assignees, contextManager)
        message = config.message
          ? await this.interpolateVariables(config.message, contextManager)
          : undefined
        const timeoutMs = await this.calculateTimeoutMs(config.timeout, contextManager)
        expiresAt = new Date(Date.now() + timeoutMs)
      }
      // Validate assignees exist
      if (assignees.userIds.length === 0 && assignees.groups.length === 0) {
        throw new Error('No valid assignees found for manual confirmation')
      }
      // Get workflow info for context
      const wrModel = new WorkflowRunModel(organizationId)
      const wrRes = await wrModel.findById(workflowRunId)
      const workflowRun = wrRes.ok ? (wrRes.value as any) : null
      if (!workflowRun) {
        throw new Error('Workflow run not found')
      }
      // Create approval request in database
      // Fetch additional data for names
      const wfModel = new WorkflowModel(organizationId)
      const wfRes = await wfModel.findById(workflowRun.workflowId)
      const wf = wfRes.ok ? (wfRes.value as any) : null
      const userModel = new UserModel()
      const ures = await userModel.findById(workflowRun.createdBy)
      const createdById = (ures.ok && ures.value ? (ures.value as any).id : 'system') as string
      const arModel = new ApprovalRequestModel(organizationId)
      const arRes = await arModel.create({
        id: uuidv4(),
        workflowId: workflowRun.workflowId as any,
        workflowRunId: workflowRunId as any,
        nodeId: node.nodeId as any,
        nodeName: node.name as any,
        status: ApprovalStatus.pending,
        message: message as any,
        assigneeUsers: assignees.userIds as any,
        assigneeGroups: assignees.groups as any,
        workflowName: (wf?.name ?? 'Workflow') as any,
        createdById: createdById as any,
        expiresAt: expiresAt as any,
        metadata: {
          ...(config.include_workflow_context ? (contextManager.getAllVariables() as any) : {}),
          ...(isTestMode && {
            isTestMode: true,
            testBehavior: 'live',
            testModeNote: 'Running in live test mode - behaves like production but marked as test',
          }),
        } as any,
      } as any)
      const approvalRequest = arRes.ok ? (arRes.value as any) : null
      contextManager.log(
        'INFO',
        node.nodeId,
        `Created approval request ${approvalRequest.id}, expires at ${expiresAt.toISOString()}${isTestMode ? ' (LIVE TEST MODE)' : ''}`
      )
      // Send notifications
      await this.sendNotifications(
        approvalRequest,
        assignees,
        config.notification_methods,
        contextManager
      )
      // Schedule timeout job
      await this.scheduleTimeout(approvalRequest.id, workflowRunId, node.nodeId, expiresAt)
      // Schedule reminders if enabled
      // TODO: Uncomment when approvalReminder table is added to database schema
      // if (config.reminders?.enabled) {
      //   await this.scheduleReminders(
      //     approvalRequest.id,
      //     config.reminders,
      //     expiresAt,
      //     contextManager
      //   )
      // }
      // Pause workflow execution
      await this.pauseWorkflow(workflowRunId, node.nodeId, approvalRequest.id, contextManager)
      // Emit workflow paused event
      await publisher.publishLater({
        type: 'workflow:paused',
        data: {
          workflowRunId,
          organizationId,
          pausedNodeId: node.nodeId,
          resumeAt: expiresAt.toISOString(),
          pauseReason: 'manual_confirmation',
          approvalRequestId: approvalRequest.id,
        },
      } as any)
      // Create pause reason for workflow engine
      const pauseReason = {
        type: 'human_confirmation' as const,
        nodeId: node.nodeId,
        message: message || 'Manual confirmation required',
        metadata: {
          approvalRequestId: approvalRequest.id,
          expiresAt: expiresAt.toISOString(),
          assigneeCount: assignees.userIds.length + assignees.groups.length,
        },
      }
      return {
        status: NodeRunningStatus.Paused,
        pauseReason,
        output: {
          approval_request_id: approvalRequest.id,
          expires_at: expiresAt.toISOString(),
          assignee_count: assignees.userIds.length + assignees.groups.length,
          notification_methods: config.notification_methods,
        },
        metadata: { approvalRequestId: approvalRequest.id },
      }
    } catch (error) {
      contextManager.log(
        'ERROR',
        node.nodeId,
        `Manual confirmation node execution failed: ${error instanceof Error ? error.message : String(error)}`
      )
      throw error
    }
  }
  private async handleTestMode(
    node: WorkflowNode,
    config: HumanConfirmationNodeData,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const behavior = config.test_behavior || 'always_approve'
    const delay = config.test_delay || 0
    contextManager.log(
      'DEBUG',
      node.nodeId,
      `Running in test mode with behavior: ${behavior}, delay: ${delay}s`
    )
    // Simulate delay if configured
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay * 1000))
    }
    // Determine test outcome
    let approved: boolean
    switch (behavior) {
      case 'always_approve':
        approved = true
        break
      case 'always_deny':
        approved = false
        break
      case 'random':
        approved = Math.random() >= 0.5
        break
      case 'delayed':
        // Follow timeout path for delayed behavior
        return {
          status: NodeRunningStatus.Succeeded,
          output: { test_mode: true, outcome: 'timeout' },
          outputHandle: 'timeout',
        }
      default:
        approved = true
    }
    // Return appropriate next node based on test outcome
    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        test_mode: true,
        outcome: approved ? 'approved' : 'denied',
        test_behavior: behavior,
      },
      outputHandle: approved ? 'approved' : 'denied',
    }
  }
  private async resolveAssignees(
    assigneeConfig: HumanConfirmationNodeData['assignees'],
    contextManager: ExecutionContextManager
  ): Promise<{
    userIds: string[]
    groups: string[]
  }> {
    const userIds: string[] = []
    const groups: string[] = []
    // Add direct users
    if (assigneeConfig.userIds?.length) {
      userIds.push(...assigneeConfig.userIds)
    }
    // Add direct groups
    if (assigneeConfig.groups?.length) {
      groups.push(...assigneeConfig.groups)
    }

    // Remove duplicates
    return { userIds: [...new Set(userIds)], groups: [...new Set(groups)] }
  }
  private async calculateTimeoutMs(
    timeout: HumanConfirmationNodeData['timeout'],
    contextManager: ExecutionContextManager
  ): Promise<number> {
    let duration: number
    if (typeof timeout.duration === 'object') {
      // It's a variable
      duration = Number(await this.resolveVariableValue(timeout.duration, contextManager))
    } else {
      duration = timeout.duration
    }
    if (isNaN(duration) || duration <= 0) {
      throw new Error('Invalid timeout duration')
    }
    // Convert to milliseconds based on unit
    switch (timeout.unit) {
      case 'minutes':
        return duration * 60 * 1000
      case 'hours':
        return duration * 60 * 60 * 1000
      case 'days':
        return duration * 24 * 60 * 60 * 1000
      default:
        throw new Error(`Invalid timeout unit: ${timeout.unit}`)
    }
  }
  private async sendNotifications(
    approvalRequest: any,
    assignees: {
      userIds: string[]
      groups: string[]
    },
    methods: {
      in_app: boolean
      email: boolean
    },
    contextManager: ExecutionContextManager
  ): Promise<void> {
    contextManager.log('DEBUG', approvalRequest.nodeId, 'Starting sendNotifications', {
      assignees,
      methods,
      approvalRequestId: approvalRequest.id,
    })
    const notificationService = new NotificationService(db)
    // Get all users (direct + from groups)
    const allUserIds = await this.getAllAssigneeUserIds(
      assignees.userIds,
      assignees.groups,
      approvalRequest.organizationId
    )
    contextManager.log('DEBUG', approvalRequest.nodeId, 'Resolved assignee user IDs', {
      allUserIds,
      userCount: allUserIds.length,
    })
    // Send in-app notifications
    if (methods.in_app) {
      contextManager.log('DEBUG', approvalRequest.nodeId, 'Sending in-app notifications', {
        userCount: allUserIds.length,
        userIds: allUserIds,
      })
      for (const userId of allUserIds) {
        try {
          contextManager.log('DEBUG', approvalRequest.nodeId, 'Sending notification to user', {
            userId,
            approvalRequestId: approvalRequest.id,
          })
          const result = await notificationService.sendNotification({
            type: 'WORKFLOW_APPROVAL_REQUIRED' as any,
            userId,
            entityId: approvalRequest.id,
            entityType: 'approval_request',
            message: `Approval required for workflow "${approvalRequest.workflowName}"`,
            actorId: approvalRequest.createdById,
            organizationId: approvalRequest.organizationId,
            data: {
              workflowId: approvalRequest.workflowId,
              workflowRunId: approvalRequest.workflowRunId,
              nodeId: approvalRequest.nodeId,
              expiresAt: approvalRequest.expiresAt.toISOString(),
            },
          })
          contextManager.log('INFO', approvalRequest.nodeId, 'Successfully sent notification', {
            userId,
            notificationId: result.id,
          })
        } catch (error) {
          contextManager.log(
            'ERROR',
            approvalRequest.nodeId,
            `Failed to send in-app notification to user ${userId}`,
            {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              userId,
              approvalRequestId: approvalRequest.id,
            }
          )
        }
      }
    } else {
      contextManager.log('DEBUG', approvalRequest.nodeId, 'In-app notifications disabled', {
        methods,
      })
    }
    // Send email notifications
    if (methods.email) {
      await this.sendEmailNotifications(approvalRequest, allUserIds, contextManager)
    }
  }
  private async sendEmailNotifications(
    approvalRequest: any,
    userIds: string[],
    contextManager: ExecutionContextManager
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
        await sendApprovalRequestEmail({
          email: user.email!,
          toName: user.name || 'User',
          workflowName: approvalRequest.workflowName,
          message: approvalRequest.message,
          approvalUrl,
          expiresAt: approvalRequest.expiresAt,
        })
      } catch (error) {
        contextManager.log(
          'WARN',
          approvalRequest.nodeId,
          `Failed to send email notification to ${user.email}`,
          { error: error instanceof Error ? error.message : String(error) }
        )
      }
    }
  }
  private async getAllAssigneeUserIds(
    userIds: string[],
    groupIds: string[],
    organizationId: string
  ): Promise<string[]> {
    const allUserIds = new Set(userIds)
    if (groupIds.length > 0) {
      // Note: This query may need adjustment based on your exact schema for groups relationship
      // Assuming there's a junction table for organization members and groups
      const groupMembers = await db
        .select({ userId: schema.OrganizationMember.userId })
        .from(schema.OrganizationMember)
        .where(eq(schema.OrganizationMember.organizationId, organizationId))
      // TODO: Add proper join for groups relationship when schema is clarified
      groupMembers.forEach((member) => allUserIds.add(member.userId))
    }
    return Array.from(allUserIds)
  }
  private async scheduleTimeout(
    approvalRequestId: string,
    workflowRunId: string,
    nodeId: string,
    expiresAt: Date
  ): Promise<void> {
    const delay = expiresAt.getTime() - Date.now()
    const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
    await workflowDelayQueue.add(
      'approvalTimeoutJob',
      { approvalRequestId, workflowRunId, nodeId },
      {
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        jobId: `approval-timeout-${approvalRequestId}`,
      }
    )
  }
  private async scheduleReminders(
    approvalRequestId: string,
    reminders: NonNullable<HumanConfirmationNodeData['reminders']>,
    expiresAt: Date,
    contextManager: ExecutionContextManager
  ): Promise<void> {
    const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
    const now = Date.now()
    // Convert first_after and repeat_every to milliseconds
    const firstReminderMs = this.convertToMs(reminders.first_after, reminders.unit)
    const repeatEveryMs = this.convertToMs(reminders.repeat_every, reminders.unit)
    for (let i = 1; i <= reminders.max_reminders; i++) {
      const delay = firstReminderMs + (i - 1) * repeatEveryMs
      const scheduledFor = new Date(now + delay)
      // Don't schedule reminders after expiration
      if (scheduledFor >= expiresAt) {
        break
      }
      // Create reminder record
      // TODO: Uncomment when approvalReminder table is added to database schema
      // await db.approvalReminder.create({
      //   data: { approvalRequestId, scheduledFor, reminderNumber: i },
      // })
      // Schedule reminder job
      await workflowDelayQueue.add(
        'approvalReminderJob',
        { approvalRequestId, reminderNumber: i },
        {
          delay,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          jobId: `approval-reminder-${approvalRequestId}-${i}`,
        }
      )
    }
    contextManager.log(
      'DEBUG',
      '',
      `Scheduled ${reminders.max_reminders} reminders for approval ${approvalRequestId}`
    )
  }
  private convertToMs(value: number, unit: 'minutes' | 'hours' | 'days'): number {
    switch (unit) {
      case 'minutes':
        return value * 60 * 1000
      case 'hours':
        return value * 60 * 60 * 1000
      case 'days':
        return value * 24 * 60 * 60 * 1000
    }
  }
  private async pauseWorkflow(
    workflowRunId: string,
    nodeId: string,
    approvalRequestId: string,
    contextManager: ExecutionContextManager
  ): Promise<void> {
    // Update workflow run status to WAITING
    await db
      .update(schema.WorkflowRun)
      .set({
        status: 'WAITING',
        pausedAt: new Date(),
        pausedNodeId: nodeId,
        serializedState: contextManager.serialize() as any,
      })
      .where(eq(schema.WorkflowRun.id, workflowRunId))
  }
  /**
   * Extract variables from confirmation message and assignees
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as HumanConfirmationNodeData
    const variables = new Set<string>()

    // Extract from message
    if (config.message && typeof config.message === 'string') {
      this.extractVariableIds(config.message).forEach((v) => variables.add(v))
    }

    // Extract from assignees variable if used
    if ((config.assignees as any)?.variable) {
      variables.add((config.assignees as any).variable)
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as HumanConfirmationNodeData
    // Validate assignees
    if (
      !config.assignees ||
      (!config.assignees.userIds?.length && !config.assignees.groups?.length)
    ) {
      errors.push('At least one assignee (user, group, or variable) is required')
    }
    // Validate notification methods
    if (!config.notification_methods?.in_app && !config.notification_methods?.email) {
      errors.push('At least one notification method must be enabled')
    }
    // Validate timeout
    if (!config.timeout?.duration || !config.timeout?.unit) {
      errors.push('Timeout duration and unit are required')
    }
    // Note: Connection validation removed - workflow uses edges instead of node.connections
    // The connections field is deprecated and always empty

    // Validate reminders if enabled
    if (config.reminders?.enabled) {
      if (!config.reminders.first_after || config.reminders.first_after <= 0) {
        errors.push('First reminder must be scheduled after a positive duration')
      }
      if (!config.reminders.repeat_every || config.reminders.repeat_every <= 0) {
        errors.push('Reminder repeat interval must be positive')
      }
      if (!config.reminders.max_reminders || config.reminders.max_reminders <= 0) {
        errors.push('Maximum number of reminders must be positive')
      }
    }
    return { valid: errors.length === 0, errors, warnings }
  }
}
