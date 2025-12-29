// packages/lib/src/actions/services/proposed-action-execution-service.ts

import { database as defaultDatabase, type Database, schema } from '@auxx/database'
import {
  ProposedActionStatus as ProposedActionStatusEnum,
  ActionType as DbActionType,
} from '@auxx/database/enums'
import {
  ProposedActionEntity as ProposedAction,
  MessageEntity as Message,
  ThreadEntity as Thread,
  MessageParticipantEntity as MessageParticipant,
  ParticipantEntity as Participant,
  RuleEntity as Rule,
} from '@auxx/database/models'
import { and, eq, inArray } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { ServiceRegistry } from '../../services/service-registry'
import { ServiceKeys, getService } from '../../services/service-registrations'
import { ActionExecutor } from '../core/action-executor'
import { ActionDefinition, ActionContext, ActionResult, ActionType } from '../core/action-types'

/** Scoped logger for proposed action execution operations */
const logger = createScopedLogger('proposed-action-execution-service')

/**
 * Proposed action record including the relations required for execution
 */
type ProposedActionWithRelations = ProposedAction & {
  message:
    | (Message & {
        thread: Thread | null
        participants: (MessageParticipant & {
          participant: Participant | null
        })[]
      })
    | null
  rule: Rule | null
}

/**
 * Service for executing ProposedActions from the database
 * This bridges the gap between database-stored proposed actions and the ActionExecutor
 */
export class ProposedActionExecutionService {
  private actionExecutor!: ActionExecutor
  private database: Database
  private organizationId!: string
  private userId?: string
  private initialized = false

  constructor(private serviceRegistry: ServiceRegistry) {}

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    logger.info('Initializing ProposedActionExecutionService')

    try {
      // Resolve dependencies from service registry
      this.organizationId = await getService(this.serviceRegistry, ServiceKeys.ORGANIZATION_ID)
      this.userId = await this.serviceRegistry
        .get<string>(ServiceKeys.USER_ID)
        .catch(() => undefined)
      this.database =
        (await getService(this.serviceRegistry, ServiceKeys.DATABASE)) || defaultDatabase
      this.actionExecutor = await this.serviceRegistry.get<ActionExecutor>(
        ServiceKeys.ACTION_EXECUTOR
      )

      this.initialized = true
      logger.info('ProposedActionExecutionService initialized successfully', {
        organizationId: this.organizationId,
        userId: this.userId,
      })
    } catch (error) {
      logger.error('Failed to initialize ProposedActionExecutionService', {
        error: error instanceof Error ? error.message : 'Unknown error',
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Execute a single proposed action by ID
   */
  async executeAction(proposedActionId: string): Promise<ActionResult> {
    await this.ensureInitialized()

    logger.info('Executing proposed action', {
      proposedActionId,
      organizationId: this.organizationId,
    })

    try {
      // Fetch the proposed action from database
      const proposedAction = await this.database.query.ProposedAction.findFirst({
        where: (proposedActions) =>
          and(
            eq(proposedActions.id, proposedActionId),
            eq(proposedActions.organizationId, this.organizationId),
            eq(proposedActions.status, ProposedActionStatusEnum.APPROVED)
          ),
        with: {
          message: {
            with: {
              thread: true,
              participants: {
                with: {
                  participant: true,
                },
              },
            },
          },
          rule: true,
        },
      })

      if (!proposedAction) {
        throw new Error(`Proposed action not found or not approved: ${proposedActionId}`)
      }

      if (!proposedAction.message) {
        throw new Error(
          `Proposed action ${proposedActionId} is missing the required message relation`
        )
      }

      // Convert database record to ActionDefinition
      const actionDefinition = this.convertToActionDefinition(proposedAction)
      const actionContext = this.createActionContext(proposedAction)

      // Execute the action
      const result = await this.actionExecutor.execute(actionDefinition, actionContext)

      // Update the database with execution results
      await this.updateExecutionResult(proposedActionId, result)

      logger.info('Proposed action executed successfully', {
        proposedActionId,
        success: result.success,
        actionType: result.actionType,
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Failed to execute proposed action', {
        proposedActionId,
        error: errorMessage,
      })

      // Update database with execution error
      await this.updateExecutionError(proposedActionId, errorMessage)

      return {
        actionId: proposedActionId,
        actionType: ActionType.SEND_MESSAGE, // Default fallback
        success: false,
        error: errorMessage,
        executionTime: Date.now(),
        metadata: {
          executionSource: 'proposed-action-service',
        },
      }
    }
  }

  /**
   * Execute multiple proposed actions in batch
   */
  async executeBatch(proposedActionIds: string[]): Promise<Record<string, ActionResult>> {
    await this.ensureInitialized()

    logger.info('Executing batch proposed actions', {
      count: proposedActionIds.length,
      organizationId: this.organizationId,
    })

    const results: Record<string, ActionResult> = {}

    // Fetch all proposed actions
    if (proposedActionIds.length === 0) {
      return results
    }

    const proposedActions = await this.database.query.ProposedAction.findMany({
      where: (proposedActions) =>
        and(
          inArray(proposedActions.id, proposedActionIds),
          eq(proposedActions.organizationId, this.organizationId),
          eq(proposedActions.status, ProposedActionStatusEnum.APPROVED)
        ),
      with: {
        message: {
          with: {
            thread: true,
            participants: {
              with: {
                participant: true,
              },
            },
          },
        },
        rule: true,
      },
    })

    if (proposedActions.length !== proposedActionIds.length) {
      logger.warn('Some proposed actions not found or not approved', {
        requested: proposedActionIds.length,
        found: proposedActions.length,
      })
    }

    // Execute each action individually for now
    // TODO: Optimize by grouping by thread/context for true batch execution
    for (const proposedAction of proposedActions) {
      try {
        const actionDefinition = this.convertToActionDefinition(proposedAction)
        const actionContext = this.createActionContext(proposedAction)

        const result = await this.actionExecutor.execute(actionDefinition, actionContext)
        await this.updateExecutionResult(proposedAction.id, result)

        results[proposedAction.id] = result
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        await this.updateExecutionError(proposedAction.id, errorMessage)

        results[proposedAction.id] = {
          actionId: proposedAction.id,
          actionType: this.mapDbActionTypeToLibActionType(proposedAction.actionType),
          success: false,
          error: errorMessage,
          executionTime: Date.now(),
          metadata: {
            executionSource: 'proposed-action-service',
          },
        }
      }
    }

    logger.info('Batch execution completed', {
      totalActions: proposedActionIds.length,
      successCount: Object.values(results).filter((r) => r.success).length,
      failureCount: Object.values(results).filter((r) => !r.success).length,
    })

    return results
  }

  /**
   * Convert database ProposedAction to ActionDefinition
   */
  private convertToActionDefinition(proposedAction: ProposedActionWithRelations): ActionDefinition {
    if (!proposedAction.message) {
      throw new Error(`Proposed action ${proposedAction.id} is missing the message relation`)
    }
    return {
      id: proposedAction.id,
      type: this.mapDbActionTypeToLibActionType(proposedAction.actionType),
      params: {
        ...((proposedAction.modifiedParams as any) || (proposedAction.actionParams as any)),
        // Include confidence and explanation in params if available
        confidence: proposedAction.confidence,
        explanation: proposedAction.explanation,
      },
      metadata: {
        ruleId: proposedAction.ruleId,
        // Store additional metadata as generic properties
        originalParams: proposedAction.actionParams,
        modifiedParams: proposedAction.modifiedParams,
        confidence: proposedAction.confidence,
        explanation: proposedAction.explanation,
      } as any,
    }
  }

  /**
   * Create ActionContext from ProposedAction
   */
  private createActionContext(proposedAction: ProposedActionWithRelations): ActionContext {
    if (!proposedAction.message) {
      throw new Error(`Proposed action ${proposedAction.id} is missing the message relation`)
    }
    return {
      userId: this.userId || 'system',
      organizationId: this.organizationId,
      message: {
        id: proposedAction.message.id,
        threadId: proposedAction.message.threadId,
        integrationId: proposedAction.message.thread?.integrationId || 'unknown',
        integrationType: proposedAction.message.thread?.integrationId
          ? this.getIntegrationType(proposedAction.message.thread.integrationId)
          : 'email',
        externalId: proposedAction.message.externalId,
        subject: proposedAction.message.subject || '',
        snippet:
          proposedAction.message.text?.substring(0, 100) ||
          proposedAction.message.html?.substring(0, 100) ||
          '',
      },
      timestamp: new Date(),
    }
  }

  /**
   * Update database with execution results
   */
  private async updateExecutionResult(
    proposedActionId: string,
    result: ActionResult
  ): Promise<void> {
    await this.database
      .update(schema.ProposedAction)
      .set({
        status: result.success
          ? ProposedActionStatusEnum.EXECUTED
          : ProposedActionStatusEnum.FAILED,
        executedAt: result.success ? new Date() : null,
        executionError: result.success ? null : result.error,
        executionResult: result as any,
        executionMetadata: result.metadata as any,
        updatedAt: new Date(),
      })
      .where(eq(schema.ProposedAction.id, proposedActionId))
  }

  /**
   * Update database with execution error
   */
  private async updateExecutionError(proposedActionId: string, error: string): Promise<void> {
    await this.database
      .update(schema.ProposedAction)
      .set({
        status: ProposedActionStatusEnum.FAILED,
        executionError: error,
        executionMetadata: {
          error,
          failedAt: new Date().toISOString(),
          executionSource: 'proposed-action-service',
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.ProposedAction.id, proposedActionId))
  }

  /**
   * Map database ActionType enum to library ActionType enum
   */
  private mapDbActionTypeToLibActionType(dbActionType: DbActionType): ActionType {
    // Map database enum values to library enum values
    switch (dbActionType) {
      case DbActionType.SEND_MESSAGE:
        return ActionType.SEND_MESSAGE
      case DbActionType.APPLY_TAG:
        return ActionType.APPLY_TAG
      case DbActionType.REMOVE_TAG:
        return ActionType.REMOVE_TAG
      case DbActionType.REPLY:
        return ActionType.REPLY
      case DbActionType.FORWARD:
        return ActionType.FORWARD
      case DbActionType.DRAFT_EMAIL:
        return ActionType.DRAFT_EMAIL
      case DbActionType.APPLY_LABEL:
        return ActionType.APPLY_LABEL
      case DbActionType.REMOVE_LABEL:
        return ActionType.REMOVE_LABEL
      case DbActionType.ARCHIVE:
        return ActionType.ARCHIVE
      case DbActionType.MARK_SPAM:
        return ActionType.MARK_SPAM
      case DbActionType.MARK_TRASH:
        return ActionType.MARK_TRASH
      case DbActionType.ASSIGN_THREAD:
        return ActionType.ASSIGN_THREAD
      case DbActionType.ARCHIVE_THREAD:
        return ActionType.ARCHIVE_THREAD
      case DbActionType.UNARCHIVE_THREAD:
        return ActionType.UNARCHIVE_THREAD
      case DbActionType.MOVE_TO_TRASH:
        return ActionType.MOVE_TO_TRASH
      case DbActionType.REACT_TO_MESSAGE:
        return ActionType.REACT_TO_MESSAGE
      case DbActionType.SHARE_MESSAGE:
        return ActionType.SHARE_MESSAGE
      case DbActionType.SEND_SMS:
        return ActionType.SEND_SMS
      case DbActionType.MAKE_CALL:
        return ActionType.MAKE_CALL
      case DbActionType.ESCALATE:
        return ActionType.ESCALATE
      case DbActionType.ASSIGN:
        return ActionType.ASSIGN
      case DbActionType.NOTIFY:
        return ActionType.NOTIFY
      case DbActionType.CREATE_TICKET:
        return ActionType.CREATE_TICKET
      case DbActionType.SHOPIFY_ORDER_LOOKUP:
        return ActionType.SHOPIFY_ORDER_LOOKUP
      case DbActionType.SHOPIFY_GENERATE_RESPONSE:
        return ActionType.SHOPIFY_GENERATE_RESPONSE
      case DbActionType.LABEL:
        return ActionType.APPLY_LABEL // Legacy mapping
      default:
        return ActionType.SEND_MESSAGE // Fallback
    }
  }

  /**
   * Get integration type from integration ID (simplified)
   */
  private getIntegrationType(_integrationId: string): string {
    // This is a simplified implementation
    // In reality, you'd look up the integration type from the database
    return 'email' // Default for now
  }

  /**
   * Ensure the service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }
}

/**
 * Factory function to create ProposedActionExecutionService
 */
export async function createProposedActionExecutionService(
  serviceRegistry: ServiceRegistry
): Promise<ProposedActionExecutionService> {
  const service = new ProposedActionExecutionService(serviceRegistry)
  await service.initialize()
  return service
}
