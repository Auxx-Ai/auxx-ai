// packages/lib/src/actions/services/proposed-action-service.ts

import { database as db, schema } from '@auxx/database'
// import { ActionType as DBActionType } from '@auxx/database/types'
import { ProposedActionStatus, ActionType as DBActionType } from '@auxx/database/enums'

import { eq, and, desc, count, sql, type SQL } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { ActionExecutor, createActionExecutor } from '../core/action-executor'
import { UniversalTagService } from '../../tags/universal-tag-service'
import { ServiceRegistry } from '../../services/service-registry'
import {
  createOrganizationServices,
  ServiceKeys,
  getService,
} from '../../services/service-registrations'
import { ActionType, ActionDefinition, ActionContext } from '../core/action-types'

const logger = createScopedLogger('proposed-action-service')

/**
 * Result interface for proposed action operations
 */
export interface ProposedActionResult {
  success: boolean
  actionId?: string
  error?: string
  result?: any
  metadata?: {
    executionTime?: number
    actionType?: ActionType
    originalActionType?: ActionType
    fallbackUsed?: boolean
    providerType?: string
  }
}

/**
 * ProposedActionService - Manages the proposed actions workflow with refactored architecture
 *
 * Features:
 * - Integration with new ActionExecutor for capability-aware execution
 * - Universal tag system support for cross-provider compatibility
 * - Provider capability checking before action proposal
 * - Smart fallback integration for unsupported actions
 * - Bulk operations support for efficient batch processing
 * - Comprehensive error handling and logging
 */
export class ProposedActionService {
  private actionExecutor!: ActionExecutor
  private universalTagService!: UniversalTagService
  private serviceRegistry!: ServiceRegistry
  private organizationId!: string
  private initialized = false

  constructor(serviceRegistry: ServiceRegistry) {
    this.serviceRegistry = serviceRegistry
  }

  /**
   * Initialize the service and its dependencies
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Get services from registry
    this.organizationId = await getService(this.serviceRegistry, ServiceKeys.ORGANIZATION_ID)
    this.actionExecutor = await createActionExecutor(this.serviceRegistry)
    this.universalTagService = await getService(
      this.serviceRegistry,
      ServiceKeys.UNIVERSAL_TAG_SERVICE
    )

    await this.universalTagService.ensureSystemTags()

    this.initialized = true
    logger.info('ProposedActionService initialized', {
      organizationId: this.organizationId,
    })
  }

  /**
   * Create a new proposed action with capability checking
   */
  async createProposedAction(params: {
    messageId: string
    ruleId: string
    actionType: ActionType
    actionParams: any
    confidence?: number
    explanation?: string
    userId?: string
  }): Promise<{ id: string; canExecute: boolean; fallbackAction?: ActionDefinition }> {
    const startTime = Date.now()

    logger.info('Creating proposed action', {
      messageId: params.messageId,
      actionType: params.actionType,
      ruleId: params.ruleId,
    })

    try {
      // Get message and context for capability checking
      const message = await db.query.Message.findFirst({
        where: eq(schema.Message.id, params.messageId),
        columns: {
          id: true,
          threadId: true,
          subject: true,
          snippet: true,
        },
        with: {
          thread: {
            columns: {
              id: true,
              integrationId: true,
            },
            with: {
              integration: {
                columns: {
                  id: true,
                  provider: true,
                },
              },
            },
          },
        },
      })

      if (!message) {
        throw new Error('Message not found')
      }

      // Build action context for validation
      const context: ActionContext = {
        userId: params.userId || 'system',
        organizationId: this.organizationId,
        message: {
          id: message.id,
          threadId: message.threadId,
          integrationId: message.thread?.integrationId,
          integrationType: message.thread?.integration?.provider,
          subject: message.subject,
          snippet: message.snippet,
        },
        timestamp: new Date(),
      }

      // Create action definition
      const actionDefinition: ActionDefinition = {
        type: params.actionType,
        params: params.actionParams,
        metadata: {
          ruleId: params.ruleId,
          confidence: params.confidence,
          createdAt: new Date(),
        },
      }

      // Validate action before creating proposal
      const isValid = await this.actionExecutor.validateAction(actionDefinition, context)
      if (!isValid) {
        throw new Error(`Invalid action definition for ${params.actionType}`)
      }

      // Check if action can be executed by provider and get execution plan
      const executionPlan = await this.getExecutionPlan(actionDefinition, context)

      // Convert ActionType to DB ActionType
      const dbActionType = this.mapActionTypeToDBType(params.actionType)

      // Create proposed action record
      const [proposedAction] = await db
        .insert(schema.ProposedAction)
        .values({
          messageId: params.messageId,
          ruleId: params.ruleId,
          actionType: dbActionType,
          actionParams: {
            ...params.actionParams,
            // Store additional metadata in actionParams since confidence/explanation aren't separate fields
            _metadata: {
              confidence: params.confidence || 0.8,
              explanation: params.explanation,
              createdBy: params.userId,
              canExecute: executionPlan.canExecute,
              fallbackAvailable: !!executionPlan.fallbackAction,
              providerType: context.integration?.provider || 'unknown',
              originalActionType: params.actionType,
              validationTime: Date.now() - startTime,
            },
          },
          organizationId: this.organizationId,
          status: 'PENDING',
          updatedAt: new Date(),
        })
        .returning()

      logger.info('Proposed action created', {
        proposedActionId: proposedAction.id,
        canExecute: executionPlan.canExecute,
        fallbackAvailable: !!executionPlan.fallbackAction,
        actionType: params.actionType,
      })

      return {
        id: proposedAction.id,
        canExecute: executionPlan.canExecute,
        fallbackAction: executionPlan.fallbackAction,
      }
    } catch (error) {
      logger.error('Error creating proposed action', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId: params.messageId,
        actionType: params.actionType,
      })
      throw error
    }
  }

  /**
   * Execute an approved proposed action using the new ActionExecutor
   */
  async executeProposedAction(
    proposedActionId: string,
    executorUserId?: string
  ): Promise<ProposedActionResult> {
    const startTime = Date.now()

    logger.info('Executing proposed action', {
      proposedActionId,
      executorUserId,
    })

    try {
      // Get the proposed action with related data
      const proposedAction = await db.query.ProposedAction.findFirst({
        where: eq(schema.ProposedAction.id, proposedActionId),
        columns: {
          id: true,
          messageId: true,
          ruleId: true,
          actionType: true,
          actionParams: true,
          modifiedParams: true,
          status: true,
          approvedById: true,
        },
        with: {
          message: {
            columns: {
              id: true,
              threadId: true,
              subject: true,
              snippet: true,
            },
            with: {
              thread: {
                columns: {
                  id: true,
                  integrationId: true,
                },
                with: {
                  integration: {
                    columns: {
                      id: true,
                      provider: true,
                    },
                  },
                },
              },
            },
          },
          rule: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      })

      if (!proposedAction) {
        throw new Error('Proposed action not found')
      }

      if (proposedAction.status !== ProposedActionStatus.APPROVED) {
        throw new Error('Action must be approved before execution')
      }

      // Convert back to new action system types
      const actionType = this.mapDBTypeToActionType(proposedAction.actionType)

      // Use modified params if available, otherwise use original params
      const params = (proposedAction.modifiedParams as any) || proposedAction.actionParams

      // Build action definition
      const actionDefinition: ActionDefinition = {
        id: proposedActionId,
        type: actionType,
        params: params,
        metadata: {
          ruleId: proposedAction.ruleId,
          proposedActionId: proposedActionId,
          executorUserId,
        },
      }

      // Build execution context
      const context: ActionContext = {
        userId: executorUserId || proposedAction.approvedById || 'system',
        organizationId: this.organizationId,
        message: {
          id: proposedAction.message?.id,
          threadId: proposedAction.message?.threadId,
          integrationId: proposedAction.message?.thread?.integrationId,
          integrationType: proposedAction.message?.thread?.integration?.provider,
          subject: proposedAction.message?.subject,
          snippet: proposedAction.message?.snippet,
        },
        timestamp: new Date(),
      }

      // Execute the action using the new ActionExecutor
      const actionResult = await this.actionExecutor.execute(actionDefinition, context)

      // Update proposed action with execution result
      await db
        .update(schema.ProposedAction)
        .set({
          status: actionResult.success ? 'EXECUTED' : 'FAILED',
          executedAt: new Date(),
          executionResult: actionResult.result,
          executionError: actionResult.error,
          executionMetadata: actionResult.metadata,
          updatedAt: new Date(),
        })
        .where(eq(schema.ProposedAction.id, proposedActionId))

      const result: ProposedActionResult = {
        success: actionResult.success,
        actionId: proposedActionId,
        error: actionResult.error,
        result: actionResult.result,
        metadata: {
          executionTime: Date.now() - startTime,
          actionType: actionResult.actionType,
          originalActionType: actionType,
          fallbackUsed: actionResult.metadata?.fallbackUsed,
          providerType: context.integration?.provider || 'unknown',
        },
      }

      logger.info('Proposed action executed', {
        proposedActionId,
        success: actionResult.success,
        actionType: actionResult.actionType,
        fallbackUsed: actionResult.metadata?.fallbackUsed,
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      logger.error('Error executing proposed action', {
        error: errorMessage,
        proposedActionId,
      })

      // Update action with error
      await db
        .update(schema.ProposedAction)
        .set({
          status: 'FAILED',
          executionError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(schema.ProposedAction.id, proposedActionId))
        .catch(() => {
          // Ignore update errors to avoid nested error scenarios
        })

      return {
        success: false,
        actionId: proposedActionId,
        error: errorMessage,
        metadata: {
          executionTime: Date.now() - startTime,
        },
      }
    }
  }

  /**
   * Execute multiple approved proposed actions in batch
   */
  async executeBatchProposedActions(
    proposedActionIds: string[],
    executorUserId?: string
  ): Promise<{ [actionId: string]: ProposedActionResult }> {
    logger.info('Executing batch proposed actions', {
      actionCount: proposedActionIds.length,
      executorUserId,
    })

    const results: { [actionId: string]: ProposedActionResult } = {}

    // Get all proposed actions with validation using relational queries
    const proposedActions = await db.query.ProposedAction.findMany({
      where: and(
        sql`${schema.ProposedAction.id} = ANY(${proposedActionIds})`,
        eq(schema.ProposedAction.status, 'APPROVED')
      ),
      columns: {
        id: true,
        messageId: true,
      },
      with: {
        message: {
          columns: {
            id: true,
            threadId: true,
          },
          with: {
            thread: {
              columns: {
                id: true,
                integrationId: true,
              },
              with: {
                integration: {
                  columns: {
                    id: true,
                    provider: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (proposedActions.length !== proposedActionIds.length) {
      const foundIds = proposedActions.map((a) => a.id)
      const missingIds = proposedActionIds.filter((id) => !foundIds.includes(id))
      logger.warn('Some proposed actions not found or not approved', {
        requestedCount: proposedActionIds.length,
        foundCount: proposedActions.length,
        missingIds,
      })
    }

    // Group actions by provider type for potential bulk optimization
    const actionsByProvider = new Map<string, any[]>()

    for (const proposedAction of proposedActions) {
      const providerType = proposedAction.message?.thread?.integration?.provider
      if (!actionsByProvider.has(providerType)) {
        actionsByProvider.set(providerType, [])
      }
      actionsByProvider.get(providerType)!.push(proposedAction)
    }

    // Execute actions by provider group
    for (const [providerType, actions] of actionsByProvider.entries()) {
      logger.debug('Executing actions for provider', {
        providerType,
        actionCount: actions.length,
      })

      // For now, execute individually - could be optimized with true bulk operations
      for (const proposedAction of actions) {
        try {
          const result = await this.executeProposedAction(proposedAction.id, executorUserId)
          results[proposedAction.id] = result
        } catch (error) {
          results[proposedAction.id] = {
            success: false,
            actionId: proposedAction.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    }

    logger.info('Batch proposed actions execution completed', {
      totalActions: proposedActionIds.length,
      successCount: Object.values(results).filter((r) => r.success).length,
      failureCount: Object.values(results).filter((r) => !r.success).length,
    })

    return results
  }

  /**
   * Approve a proposed action with optional parameter modifications
   */
  async approveProposedAction(
    proposedActionId: string,
    approverUserId: string,
    modifiedParams?: any
  ): Promise<void> {
    logger.info('Approving proposed action', {
      proposedActionId,
      approverUserId,
      hasModifications: !!modifiedParams,
    })

    try {
      await db
        .update(schema.ProposedAction)
        .set({
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedById: approverUserId,
          modifiedParams: modifiedParams || undefined,
          updatedAt: new Date(),
        })
        .where(eq(schema.ProposedAction.id, proposedActionId))

      logger.info('Proposed action approved', {
        proposedActionId,
        approverUserId,
      })
    } catch (error) {
      logger.error('Error approving proposed action', {
        error: error instanceof Error ? error.message : 'Unknown error',
        proposedActionId,
      })
      throw error
    }
  }

  /**
   * Reject a proposed action
   */
  async rejectProposedAction(
    proposedActionId: string,
    rejectorUserId: string,
    rejectionReason?: string
  ): Promise<void> {
    logger.info('Rejecting proposed action', {
      proposedActionId,
      rejectorUserId,
      rejectionReason,
    })

    try {
      await db
        .update(schema.ProposedAction)
        .set({
          status: 'REJECTED',
          rejectedById: rejectorUserId,
          updatedAt: new Date(),
        })
        .where(eq(schema.ProposedAction.id, proposedActionId))

      logger.info('Proposed action rejected', {
        proposedActionId,
        rejectorUserId,
      })
    } catch (error) {
      logger.error('Error rejecting proposed action', {
        error: error instanceof Error ? error.message : 'Unknown error',
        proposedActionId,
      })
      throw error
    }
  }

  /**
   * Get pending proposed actions for review
   */
  async getPendingProposedActions(filters?: {
    messageId?: string
    ruleId?: string
    actionType?: ActionType
    limit?: number
    offset?: number
  }): Promise<
    Array<{
      id: string
      messageId: string
      actionType: ActionType
      actionParams: any
      confidence: number
      explanation: string | null
      createdAt: Date
      canExecute: boolean
      fallbackAvailable: boolean
      providerType: string
    }>
  > {
    const whereParts = [
      eq(schema.ProposedAction.organizationId, this.organizationId),
      eq(schema.ProposedAction.status, 'PENDING'),
    ]

    if (filters?.messageId) {
      whereParts.push(eq(schema.ProposedAction.messageId, filters.messageId))
    }

    if (filters?.ruleId) {
      whereParts.push(eq(schema.ProposedAction.ruleId, filters.ruleId))
    }

    if (filters?.actionType) {
      whereParts.push(
        eq(schema.ProposedAction.actionType, this.mapActionTypeToDBType(filters.actionType))
      )
    }

    const proposedActions = await db.query.ProposedAction.findMany({
      where: and(...whereParts),
      columns: {
        id: true,
        messageId: true,
        actionType: true,
        actionParams: true,
        createdAt: true,
      },
      with: {
        message: {
          columns: {
            id: true,
          },
          with: {
            thread: {
              columns: {
                id: true,
              },
              with: {
                integration: {
                  columns: {
                    id: true,
                    provider: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [desc(schema.ProposedAction.createdAt)],
      limit: filters?.limit || 50,
      offset: filters?.offset || 0,
    })

    return proposedActions.map((action) => {
      const metadata = (action.actionParams as any)?._metadata || {}
      const { _metadata, ...actionParams } = action.actionParams as any

      return {
        id: action.id,
        messageId: action.messageId,
        actionType: this.mapDBTypeToActionType(action.actionType),
        actionParams: actionParams,
        confidence: metadata.confidence || 0.8,
        explanation: metadata.explanation || null,
        createdAt: action.createdAt,
        canExecute: metadata.canExecute || false,
        fallbackAvailable: metadata.fallbackAvailable || false,
        providerType: action.message?.thread?.integration?.provider,
      }
    })
  }

  /**
   * Get action execution statistics
   */
  async getExecutionStats(timeRange?: { from: Date; to: Date }): Promise<{
    totalActions: number
    executedActions: number
    failedActions: number
    pendingActions: number
    approvedActions: number
    rejectedActions: number
    executionRate: number
    actionsByType: { [actionType: string]: number }
    actionsByProvider: { [provider: string]: number }
  }> {
    const whereParts: SQL[] = [eq(schema.ProposedAction.organizationId, this.organizationId)]

    if (timeRange) {
      whereParts.push(
        and(
          sql`${schema.ProposedAction.createdAt} >= ${timeRange.from.toISOString()}`,
          sql`${schema.ProposedAction.createdAt} <= ${timeRange.to.toISOString()}`
        )
      )
    }

    const baseWhere = and(...whereParts)

    const [
      totalActionsResult,
      executedActionsResult,
      failedActionsResult,
      pendingActionsResult,
      approvedActionsResult,
      rejectedActionsResult,
      actionsByType,
      actionsByProvider,
    ] = await Promise.all([
      db.select({ count: count() }).from(schema.ProposedAction).where(baseWhere),
      db
        .select({ count: count() })
        .from(schema.ProposedAction)
        .where(and(baseWhere, eq(schema.ProposedAction.status, 'EXECUTED'))),
      db
        .select({ count: count() })
        .from(schema.ProposedAction)
        .where(and(baseWhere, eq(schema.ProposedAction.status, 'FAILED'))),
      db
        .select({ count: count() })
        .from(schema.ProposedAction)
        .where(and(baseWhere, eq(schema.ProposedAction.status, 'PENDING'))),
      db
        .select({ count: count() })
        .from(schema.ProposedAction)
        .where(and(baseWhere, eq(schema.ProposedAction.status, 'APPROVED'))),
      db
        .select({ count: count() })
        .from(schema.ProposedAction)
        .where(and(baseWhere, eq(schema.ProposedAction.status, 'REJECTED'))),
      db
        .select({
          actionType: schema.ProposedAction.actionType,
          count: count(),
        })
        .from(schema.ProposedAction)
        .where(baseWhere)
        .groupBy(schema.ProposedAction.actionType),
      db
        .select({
          provider: schema.Integration.provider,
        })
        .from(schema.ProposedAction)
        .leftJoin(schema.Message, eq(schema.Message.id, schema.ProposedAction.messageId))
        .leftJoin(schema.Thread, eq(schema.Thread.id, schema.Message.threadId))
        .leftJoin(schema.Integration, eq(schema.Integration.id, schema.Thread.integrationId))
        .where(baseWhere),
    ])

    const totalActions = totalActionsResult[0]?.count || 0
    const executedActions = executedActionsResult[0]?.count || 0
    const failedActions = failedActionsResult[0]?.count || 0
    const pendingActions = pendingActionsResult[0]?.count || 0
    const approvedActions = approvedActionsResult[0]?.count || 0
    const rejectedActions = rejectedActionsResult[0]?.count || 0

    const actionTypeStats: { [actionType: string]: number } = {}
    actionsByType.forEach((item) => {
      actionTypeStats[item.actionType] = Number(item.count)
    })

    const providerStats: { [provider: string]: number } = {}
    actionsByProvider.forEach((item) => {
      const provider = item.provider
      if (provider) {
        providerStats[provider] = (providerStats[provider] || 0) + 1
      }
    })

    const executionRate =
      Number(totalActions) > 0 ? (Number(executedActions) / Number(totalActions)) * 100 : 0

    return {
      totalActions: Number(totalActions),
      executedActions: Number(executedActions),
      failedActions: Number(failedActions),
      pendingActions: Number(pendingActions),
      approvedActions: Number(approvedActions),
      rejectedActions: Number(rejectedActions),
      executionRate: Math.round(executionRate * 100) / 100,
      actionsByType: actionTypeStats,
      actionsByProvider: providerStats,
    }
  }

  // Private helper methods

  private async getExecutionPlan(
    action: ActionDefinition,
    context: ActionContext
  ): Promise<{
    canExecute: boolean
    fallbackAction?: ActionDefinition
  }> {
    // Use the ActionExecutor's internal logic to determine execution plan
    // This is a simplified version - the actual logic is in ActionExecutor
    const stats = this.actionExecutor.getStats()
    const canExecute = stats.supportedActions.includes(action.type)

    // For now, return basic capability check
    // The actual fallback logic would be handled during execution
    return {
      canExecute,
      fallbackAction: undefined, // Will be determined during execution
    }
  }

  private mapActionTypeToDBType(actionType: ActionType): DBActionType {
    // Map new ActionType enum to database ActionType enum
    const mapping: { [key in ActionType]?: DBActionType } = {
      [ActionType.REPLY]: DBActionType.REPLY,
      [ActionType.FORWARD]: DBActionType.FORWARD,
      [ActionType.APPLY_LABEL]: DBActionType.APPLY_LABEL,
      [ActionType.APPLY_TAG]: DBActionType.APPLY_TAG,
      [ActionType.REMOVE_TAG]: DBActionType.REMOVE_TAG,
      [ActionType.ARCHIVE]: DBActionType.ARCHIVE,
      [ActionType.MARK_SPAM]: DBActionType.MARK_SPAM,
      [ActionType.DRAFT_EMAIL]: DBActionType.DRAFT_EMAIL,
      [ActionType.SEND_MESSAGE]: DBActionType.SEND_MESSAGE,
    }

    return mapping[actionType] || DBActionType.APPLY_TAG // Default fallback
  }

  private mapDBTypeToActionType(dbActionType: DBActionType): ActionType {
    // Map database ActionType enum to new ActionType enum
    const mapping: { [key in DBActionType]?: ActionType } = {
      [DBActionType.REPLY]: ActionType.REPLY,
      [DBActionType.FORWARD]: ActionType.FORWARD,
      [DBActionType.APPLY_LABEL]: ActionType.APPLY_LABEL,
      [DBActionType.APPLY_TAG]: ActionType.APPLY_TAG,
      [DBActionType.REMOVE_TAG]: ActionType.REMOVE_TAG,
      [DBActionType.ARCHIVE]: ActionType.ARCHIVE,
      [DBActionType.MARK_SPAM]: ActionType.MARK_SPAM,
      [DBActionType.DRAFT_EMAIL]: ActionType.DRAFT_EMAIL,
      [DBActionType.SEND_MESSAGE]: ActionType.SEND_MESSAGE,
    }

    return mapping[dbActionType] || ActionType.APPLY_TAG // Default fallback
  }
}

/**
 * Factory function to create ProposedActionService with ServiceRegistry
 */
export async function createProposedActionService(
  serviceRegistry: ServiceRegistry
): Promise<ProposedActionService> {
  const service = new ProposedActionService(serviceRegistry)
  await service.initialize()
  return service
}

/**
 * Legacy factory function for backward compatibility
 */
export async function createProposedActionServiceLegacy(
  organizationId: string,
  userId: string
): Promise<ProposedActionService> {
  const serviceRegistry = await createOrganizationServices(organizationId, userId)
  return createProposedActionService(serviceRegistry)
}
