// packages/lib/src/actions/services/direct-action-service.ts

import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { ActionExecutor, createActionExecutor } from '../core/action-executor'
import { UniversalTagService } from '../../tags/universal-tag-service'
import { ProviderRegistryService } from '../../providers/provider-registry-service'
import { getProviderCapabilities } from '../../providers/provider-capabilities'
import { ServiceRegistry } from '../../services/service-registry'
import {
  createOrganizationServices,
  ServiceKeys,
  getService,
} from '../../services/service-registrations'
import {
  ActionDefinition,
  ActionContext,
  ActionResult,
  BatchActionResult,
  isActionSupported,
} from '../core/action-types'

const logger = createScopedLogger('direct-action-service')

/**
 * DirectActionService - Immediate rule execution with capability checking
 *
 * Features:
 * - Immediate action execution without human approval
 * - Provider capability checking and smart fallbacks
 * - Integration with refactored service architecture
 * - Bulk operations support for efficient batch processing
 * - Comprehensive error handling and retry logic
 * - Action execution logging and auditing
 * - Rule-based action filtering and validation
 */
export class DirectActionService {
  private actionExecutor!: ActionExecutor
  private universalTagService!: UniversalTagService
  private providerRegistry!: ProviderRegistryService
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
    this.providerRegistry = await getService(this.serviceRegistry, ServiceKeys.PROVIDER_REGISTRY)

    await this.universalTagService.ensureSystemTags()

    this.initialized = true
    logger.info('DirectActionService initialized', {
      organizationId: this.organizationId,
    })
  }

  /**
   * Execute actions directly based on rule evaluation
   */
  async executeDirectActions(params: {
    messageId: string
    ruleId: string
    actions: ActionDefinition[]
    executionContext?: {
      userId?: string
      confidence?: number
      ruleMetadata?: any
    }
  }): Promise<{
    messageId: string
    ruleId: string
    totalActions: number
    successCount: number
    failureCount: number
    results: ActionResult[]
    executionTime: number
    errors: string[]
  }> {
    const startTime = Date.now()

    logger.info('Executing direct actions', {
      messageId: params.messageId,
      ruleId: params.ruleId,
      actionCount: params.actions.length,
      organizationId: this.organizationId,
    })

    try {
      // Get message and build execution context
      const [msgRow] = await db
        .select({
          id: schema.Message.id,
          threadId: schema.Message.threadId,
          subject: schema.Message.subject,
          snippet: schema.Message.snippet,
        })
        .from(schema.Message)
        .where(eq(schema.Message.id, params.messageId))
        .limit(1)

      if (!msgRow) {
        throw new Error('Message not found')
      }

      const [thread] = await db
        .select({ id: schema.Thread.id, integrationId: schema.Thread.integrationId })
        .from(schema.Thread)
        .where(eq(schema.Thread.id, msgRow.threadId))
        .limit(1)
      const [integration] = thread
        ? await db
            .select({ id: schema.Integration.id, provider: schema.Integration.provider })
            .from(schema.Integration)
            .where(eq(schema.Integration.id, thread.integrationId))
            .limit(1)
        : [undefined]

      const context: ActionContext = {
        userId: params.executionContext?.userId || 'system',
        organizationId: this.organizationId,
        message: {
          id: msgRow.id,
          threadId: msgRow.threadId,
          integrationId: thread?.integrationId || '',
          integrationType: integration?.provider || 'EMAIL',
          subject: msgRow.subject || '',
          snippet: msgRow.snippet || '',
        },
        timestamp: new Date(),
      }

      // Validate and filter actions based on provider capabilities
      const validatedActions = await this.validateAndFilterActions(params.actions, context)

      if (validatedActions.length === 0) {
        logger.warn('No valid actions to execute after capability filtering', {
          messageId: params.messageId,
          originalActionCount: params.actions.length,
          providerType: context.integration?.provider || 'unknown',
        })
      }

      // Execute actions using the ActionExecutor
      const batchResult = await this.actionExecutor.executeBatch(validatedActions, context)

      // Log execution audit trail
      await this.logDirectExecution({
        messageId: params.messageId,
        ruleId: params.ruleId,
        batchResult,
        context,
        executionMetadata: params.executionContext,
      })

      logger.info('Direct actions execution completed', {
        messageId: params.messageId,
        ruleId: params.ruleId,
        totalActions: batchResult.totalActions,
        successCount: batchResult.successCount,
        failureCount: batchResult.failureCount,
        executionTime: Date.now() - startTime,
      })

      return {
        messageId: params.messageId,
        ruleId: params.ruleId,
        totalActions: batchResult.totalActions,
        successCount: batchResult.successCount,
        failureCount: batchResult.failureCount,
        results: batchResult.results,
        executionTime: Date.now() - startTime,
        errors: batchResult.errors,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      logger.error('Error executing direct actions', {
        error: errorMessage,
        messageId: params.messageId,
        ruleId: params.ruleId,
        actionCount: params.actions.length,
      })

      return {
        messageId: params.messageId,
        ruleId: params.ruleId,
        totalActions: params.actions.length,
        successCount: 0,
        failureCount: params.actions.length,
        results: [],
        executionTime: Date.now() - startTime,
        errors: [errorMessage],
      }
    }
  }

  /**
   * Execute a single action directly with comprehensive error handling
   */
  async executeSingleAction(params: {
    messageId: string
    action: ActionDefinition
    ruleId?: string
    userId?: string
    retryOnFailure?: boolean
    maxRetries?: number
  }): Promise<ActionResult> {
    logger.info('Executing single direct action', {
      messageId: params.messageId,
      actionType: params.action.type,
      ruleId: params.ruleId,
    })

    try {
      // Get message and build context
      const [msgRow] = await db
        .select({
          id: schema.Message.id,
          threadId: schema.Message.threadId,
          subject: schema.Message.subject,
          snippet: schema.Message.snippet,
        })
        .from(schema.Message)
        .where(eq(schema.Message.id, params.messageId))
        .limit(1)

      if (!msgRow) {
        throw new Error('Message not found')
      }
      const [thread] = await db
        .select({ id: schema.Thread.id, integrationId: schema.Thread.integrationId })
        .from(schema.Thread)
        .where(eq(schema.Thread.id, msgRow.threadId))
        .limit(1)
      const [integration] = thread
        ? await db
            .select({ id: schema.Integration.id, provider: schema.Integration.provider })
            .from(schema.Integration)
            .where(eq(schema.Integration.id, thread.integrationId))
            .limit(1)
        : [undefined]

      const context: ActionContext = {
        userId: params.userId || 'system',
        organizationId: this.organizationId,
        message: {
          id: msgRow.id,
          threadId: msgRow.threadId,
          integrationId: thread?.integrationId || '',
          integrationType: integration?.provider || 'EMAIL',
          subject: msgRow.subject || '',
          snippet: msgRow.snippet || '',
        },
        timestamp: new Date(),
      }

      // Add retry metadata to action
      const actionWithMetadata: ActionDefinition = {
        ...params.action,
        metadata: {
          ...params.action.metadata,
          ruleId: params.ruleId,
          retryOnFailure: params.retryOnFailure,
          maxRetries: params.maxRetries || 3,
        },
      }

      // Execute with optional retry logic
      let result: ActionResult
      let retryCount = 0
      const maxRetries = params.maxRetries || 3

      do {
        result = await this.actionExecutor.execute(actionWithMetadata, context)

        if (result.success || !params.retryOnFailure) {
          break
        }

        retryCount++
        if (retryCount < maxRetries) {
          logger.warn('Action execution failed, retrying', {
            messageId: params.messageId,
            actionType: params.action.type,
            retryCount,
            error: result.error,
          })

          // Wait before retry (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount) * 1000))
        }
      } while (retryCount < maxRetries && !result.success)

      // Enhance result with retry information
      result.metadata = {
        ...result.metadata,
        retryCount,
        finalAttempt: retryCount >= maxRetries - 1,
      }

      // Log single action execution
      await this.logSingleActionExecution({
        messageId: params.messageId,
        result,
        context,
        ruleId: params.ruleId,
        retryCount,
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      logger.error('Error executing single direct action', {
        error: errorMessage,
        messageId: params.messageId,
        actionType: params.action.type,
      })

      return {
        actionId: params.action.id || `single-${params.messageId}-${Date.now()}`,
        actionType: params.action.type,
        success: false,
        error: errorMessage,
        executionTime: Date.now(),
        metadata: {
          messageId: params.messageId,
          ruleId: params.ruleId,
        },
      }
    }
  }

  /**
   * Check if actions can be executed for a specific message/provider
   */
  async validateActionsForMessage(
    messageId: string,
    actions: ActionDefinition[]
  ): Promise<{
    messageId: string
    providerType: string
    totalActions: number
    supportedActions: ActionDefinition[]
    unsupportedActions: ActionDefinition[]
    actionCapabilities: { [actionType: string]: boolean }
  }> {
    logger.debug('Validating actions for message', {
      messageId,
      actionCount: actions.length,
    })

    // Get message and provider information
    const [msgRow] = await db
      .select({ id: schema.Message.id, threadId: schema.Message.threadId })
      .from(schema.Message)
      .where(eq(schema.Message.id, messageId))
      .limit(1)
    if (!msgRow) throw new Error('Message not found')
    const [thread] = await db
      .select({ integrationId: schema.Thread.integrationId })
      .from(schema.Thread)
      .where(eq(schema.Thread.id, msgRow.threadId))
      .limit(1)
    const [integration] = thread
      ? await db
          .select({ provider: schema.Integration.provider })
          .from(schema.Integration)
          .where(eq(schema.Integration.id, thread.integrationId))
          .limit(1)
      : [undefined]

    if (!message) {
      throw new Error('Message not found')
    }

    const providerType = integration?.provider || 'EMAIL'
    const capabilities = getProviderCapabilities(providerType as any)

    const supportedActions: ActionDefinition[] = []
    const unsupportedActions: ActionDefinition[] = []
    const actionCapabilities: { [actionType: string]: boolean } = {}

    // Check each action against provider capabilities
    for (const action of actions) {
      const isSupported = isActionSupported(action.type, capabilities)
      actionCapabilities[action.type] = isSupported

      if (isSupported) {
        supportedActions.push(action)
      } else {
        unsupportedActions.push(action)
      }
    }

    logger.debug('Action validation completed', {
      messageId,
      providerType,
      totalActions: actions.length,
      supportedCount: supportedActions.length,
      unsupportedCount: unsupportedActions.length,
    })

    return {
      messageId,
      providerType,
      totalActions: actions.length,
      supportedActions,
      unsupportedActions,
      actionCapabilities,
    }
  }

  /**
   * Execute actions for multiple messages in batch
   */
  async executeBatchForMessages(params: {
    messages: Array<{
      messageId: string
      actions: ActionDefinition[]
      ruleId?: string
    }>
    executionContext?: {
      userId?: string
      batchId?: string
      metadata?: any
    }
  }): Promise<{
    batchId: string
    totalMessages: number
    totalActions: number
    successfulMessages: number
    failedMessages: number
    messageResults: Array<{
      messageId: string
      success: boolean
      actionResults: ActionResult[]
      errors: string[]
    }>
    executionTime: number
  }> {
    const startTime = Date.now()
    const batchId =
      params.executionContext?.batchId ||
      `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    logger.info('Executing batch actions for multiple messages', {
      batchId,
      messageCount: params.messages.length,
      totalActions: params.messages.reduce((sum, m) => sum + m.actions.length, 0),
    })

    const messageResults: Array<{
      messageId: string
      success: boolean
      actionResults: ActionResult[]
      errors: string[]
    }> = []

    let successfulMessages = 0
    let failedMessages = 0

    // Process each message
    for (const messageData of params.messages) {
      try {
        const result = await this.executeDirectActions({
          messageId: messageData.messageId,
          ruleId: messageData.ruleId || 'batch-rule',
          actions: messageData.actions,
          executionContext: params.executionContext,
        })

        const messageSuccess = result.failureCount === 0
        if (messageSuccess) {
          successfulMessages++
        } else {
          failedMessages++
        }

        messageResults.push({
          messageId: messageData.messageId,
          success: messageSuccess,
          actionResults: result.results,
          errors: result.errors,
        })
      } catch (error) {
        failedMessages++
        messageResults.push({
          messageId: messageData.messageId,
          success: false,
          actionResults: [],
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        })
      }
    }

    const totalActions = params.messages.reduce((sum, m) => sum + m.actions.length, 0)
    const executionTime = Date.now() - startTime

    logger.info('Batch execution for messages completed', {
      batchId,
      totalMessages: params.messages.length,
      totalActions,
      successfulMessages,
      failedMessages,
      executionTime,
    })

    return {
      batchId,
      totalMessages: params.messages.length,
      totalActions,
      successfulMessages,
      failedMessages,
      messageResults,
      executionTime,
    }
  }

  /**
   * Get execution statistics for direct actions
   */
  async getExecutionStats(timeRange?: { from: Date; to: Date }): Promise<{
    totalExecutions: number
    successfulExecutions: number
    failedExecutions: number
    executionsByActionType: { [actionType: string]: number }
    executionsByProvider: { [provider: string]: number }
    averageExecutionTime: number
    retryRate: number
  }> {
    // This would query the action execution logs
    // For now, return mock data structure
    logger.debug('Getting execution statistics', { timeRange })

    // In a real implementation, this would query the ActionExecutionLog table
    return {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      executionsByActionType: {},
      executionsByProvider: {},
      averageExecutionTime: 0,
      retryRate: 0,
    }
  }

  // Private helper methods

  private async validateAndFilterActions(
    actions: ActionDefinition[],
    context: ActionContext
  ): Promise<ActionDefinition[]> {
    const validActions: ActionDefinition[] = []

    for (const action of actions) {
      try {
        // Validate action structure and parameters
        const isValid = await this.actionExecutor.validateAction(action, context)
        if (isValid) {
          validActions.push(action)
        } else {
          logger.warn('Action failed validation', {
            actionType: action.type,
            messageId: context.message.id,
          })
        }
      } catch (error) {
        logger.warn('Error validating action', {
          error: error instanceof Error ? error.message : 'Unknown error',
          actionType: action.type,
          messageId: context.message.id,
        })
      }
    }

    return validActions
  }

  private async logDirectExecution(params: {
    messageId: string
    ruleId: string
    batchResult: BatchActionResult
    context: ActionContext
    executionMetadata?: any
  }): Promise<void> {
    try {
      // Log execution for auditing
      // In a real implementation, this would create ActionExecutionLog records
      logger.info('Direct execution audit', {
        messageId: params.messageId,
        ruleId: params.ruleId,
        batchId: params.batchResult.batchId,
        totalActions: params.batchResult.totalActions,
        successCount: params.batchResult.successCount,
        failureCount: params.batchResult.failureCount,
        executionTime: params.batchResult.executionTime,
        providerType: params.context.integration?.provider || 'unknown',
        userId: params.context.userId,
        organizationId: this.organizationId,
      })
    } catch (error) {
      logger.error('Error logging direct execution', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId: params.messageId,
      })
    }
  }

  private async logSingleActionExecution(params: {
    messageId: string
    result: ActionResult
    context: ActionContext
    ruleId?: string
    retryCount?: number
  }): Promise<void> {
    try {
      // Log single action execution
      logger.info('Single action execution audit', {
        messageId: params.messageId,
        actionId: params.result.actionId,
        actionType: params.result.actionType,
        success: params.result.success,
        error: params.result.error,
        retryCount: params.retryCount || 0,
        ruleId: params.ruleId,
        providerType: params.context.integration?.provider || 'unknown',
        userId: params.context.userId,
        organizationId: this.organizationId,
      })
    } catch (error) {
      logger.error('Error logging single action execution', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageId: params.messageId,
      })
    }
  }
}

/**
 * Factory function to create DirectActionService with ServiceRegistry
 */
export async function createDirectActionService(
  serviceRegistry: ServiceRegistry
): Promise<DirectActionService> {
  const service = new DirectActionService(serviceRegistry)
  await service.initialize()
  return service
}

/**
 * Legacy factory function for backward compatibility
 */
export async function createDirectActionServiceLegacy(
  organizationId: string,
  userId: string
): Promise<DirectActionService> {
  const serviceRegistry = await createOrganizationServices(organizationId, userId)
  return createDirectActionService(serviceRegistry)
}
