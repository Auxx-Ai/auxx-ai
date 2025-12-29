// packages/lib/src/actions/core/action-executor.ts

import { createScopedLogger } from '@auxx/logger'
import { ServiceRegistry } from '../../services/service-registry'
import { ServiceKeys, getService } from '../../services/service-registrations'
import { ProviderRegistryService } from '../../providers/provider-registry-service'
import { createLabelActionHandler } from '../handlers/label-action-handler-refactored'
import {
  ActionType,
  ActionDefinition,
  ActionContext,
  ActionResult,
  ActionExecutor as IActionExecutor,
  BatchActionResult,
  ActionHandler,
  ProviderCapabilities,
  isActionSupported,
  getProviderCapabilities,
} from './action-types'

const logger = createScopedLogger('action-executor')

/**
 * ActionExecutor using Service Registry Pattern
 *
 * Key Features:
 * - Dependency injection via service registry
 * - Shared service instances across handlers
 * - Lazy handler initialization
 * - Better resource management
 * - Easier testing and mocking
 * - Centralized service lifecycle
 * - Provider capability awareness
 * - Automatic action fallbacks when unsupported
 * - Multi-handler action routing
 * - Bulk operation optimization
 * - Comprehensive error handling and logging
 */
export class ActionExecutor implements IActionExecutor {
  private handlers: Map<ActionType, ActionHandler> = new Map()
  private handlerFactories: Map<ActionType, () => Promise<ActionHandler>> = new Map()
  private providerRegistry!: ProviderRegistryService
  private organizationId!: string
  private initialized = false

  constructor(private serviceRegistry: ServiceRegistry) {}

  /**
   * Initialize the action executor with all handler factories
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    logger.info('Initializing ActionExecutor with service registry')

    try {
      // Resolve core services from registry
      this.organizationId = await getService(this.serviceRegistry, ServiceKeys.ORGANIZATION_ID)
      this.providerRegistry = await getService(this.serviceRegistry, ServiceKeys.PROVIDER_REGISTRY)

      // Register handler factories (lazy initialization)
      await this.registerHandlerFactories()

      this.initialized = true
      logger.info('ActionExecutor initialized successfully', {
        organizationId: this.organizationId,
        handlerFactoryCount: this.handlerFactories.size,
      })
    } catch (error) {
      logger.error('Failed to initialize ActionExecutor', {
        error: error instanceof Error ? error.message : 'Unknown error',
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Execute a single action with capability checking and fallbacks
   */
  async execute(action: ActionDefinition, context: ActionContext): Promise<ActionResult> {
    await this.ensureInitialized()

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const startTime = Date.now()

    logger.info('Executing action', {
      executionId,
      actionType: action.type,
      actionId: action.id,
      threadId: context.message.threadId,
      organizationId: this.organizationId,
    })

    try {
      // Validate action before execution
      const isValid = await this.validateAction(action, context)
      if (!isValid) {
        throw new Error(`Action validation failed for ${action.type}`)
      }

      // Get handler for the action type
      const handler = await this.getOrCreateHandler(action.type)
      if (!handler) {
        throw new Error(`No handler available for action type: ${action.type}`)
      }

      // Check provider capabilities and get execution plan
      const { canExecute, fallbackAction } = await this.getExecutionPlan(action, context, handler)

      if (!canExecute && !fallbackAction) {
        return {
          actionId: action.id || `${action.type}-${context.message.threadId}`,
          actionType: action.type,
          success: false,
          error: `Action ${action.type} not supported by provider for integration ${context.message.integrationId}`,
          executionTime: Date.now(),
          metadata: {
            executionId,
            integrationId: context.message.integrationId,
            capabilityCheck: false,
            duration: Date.now() - startTime,
          },
        }
      }

      // Execute primary action or fallback
      const actionToExecute = canExecute ? action : fallbackAction!
      const result = await handler.handle(actionToExecute, context)

      // Enhance result with execution metadata
      result.metadata = {
        ...result.metadata,
        executionId,
        fallbackUsed: !canExecute,
        originalActionType: action.type,
        integrationId: context.message.integrationId,
        duration: Date.now() - startTime,
        handlerSource: 'service-registry',
      }

      logger.info('Action execution completed', {
        executionId,
        success: result.success,
        actionType: result.actionType,
        fallbackUsed: !canExecute,
        duration: Date.now() - startTime,
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Action execution failed', {
        executionId,
        actionType: action.type,
        error: errorMessage,
        threadId: context.message.threadId,
        duration: Date.now() - startTime,
      })

      return {
        actionId: action.id || `${action.type}-${context.message.threadId}`,
        actionType: action.type,
        success: false,
        error: errorMessage,
        executionTime: Date.now(),
        metadata: {
          executionId,
          integrationId: context.message.integrationId,
          duration: Date.now() - startTime,
          handlerSource: 'service-registry',
        },
      }
    }
  }

  /**
   * Execute multiple actions in batch with optimization
   */
  async executeBatch(
    actions: ActionDefinition[],
    context: ActionContext
  ): Promise<BatchActionResult> {
    await this.ensureInitialized()

    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const startTime = Date.now()

    logger.info('Executing batch actions', {
      batchId,
      actionCount: actions.length,
      organizationId: this.organizationId,
    })

    // Group actions by handler for bulk processing optimization
    const actionsByHandler = await this.groupActionsByHandler(actions, context)
    const results: ActionResult[] = []
    let successCount = 0
    let failureCount = 0

    // Execute actions grouped by handler
    for (const [handler, handlerActions] of actionsByHandler.entries()) {
      try {
        // Check if handler supports bulk operations
        if (handler.handleBulk) {
          logger.debug('Using bulk execution for handler', {
            batchId,
            actionCount: handlerActions.length,
            handlerType: handler.constructor.name,
          })

          const bulkResult = await handler.handleBulk(handlerActions, context)
          results.push(...bulkResult.results)
          successCount += bulkResult.successCount
          failureCount += bulkResult.failureCount
        } else {
          // Execute actions individually
          logger.debug('Using individual execution for handler', {
            batchId,
            actionCount: handlerActions.length,
            handlerType: handler.constructor.name,
          })

          for (const action of handlerActions) {
            const result = await this.execute(action, context)
            results.push(result)

            if (result.success) {
              successCount++
            } else {
              failureCount++
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error('Batch execution failed for handler', {
          batchId,
          error: errorMessage,
          handlerType: handler.constructor.name,
          actionCount: handlerActions.length,
        })

        // Create error results for all actions in this group
        const errorResults = handlerActions.map((action) => ({
          actionId: action.id || `${action.type}-${Date.now()}`,
          actionType: action.type,
          success: false,
          error: errorMessage,
          executionTime: Date.now(),
          metadata: { batchId, bulkError: true, handlerSource: 'service-registry' },
        }))

        results.push(...errorResults)
        failureCount += errorResults.length
      }
    }

    const totalExecutionTime = Date.now() - startTime

    logger.info('Batch execution completed', {
      batchId,
      totalActions: actions.length,
      successCount,
      failureCount,
      executionTime: totalExecutionTime,
    })

    return {
      batchId,
      totalActions: actions.length,
      successCount,
      failureCount,
      results,
      executionTime: totalExecutionTime,
      errors: results
        .filter((r) => !r.success)
        .map((r) => r.error)
        .filter(Boolean) as string[],
    }
  }

  /**
   * Validate action before execution
   */
  async validateAction(action: ActionDefinition, context: ActionContext): Promise<boolean> {
    try {
      // Basic validation
      if (!action.type) {
        logger.warn('Action missing type', { action })
        return false
      }

      if (!context.userId || !context.organizationId) {
        logger.warn('Invalid action context', { context })
        return false
      }

      // Check if we have a handler factory for this action type
      if (!this.handlerFactories.has(action.type)) {
        logger.warn('No handler factory available for action type', { actionType: action.type })
        return false
      }

      // Validate action-specific parameters
      if (!this.validateActionParameters(action)) {
        logger.warn('Invalid action parameters', { action })
        return false
      }

      return true
    } catch (error) {
      logger.error('Error validating action', {
        error: error instanceof Error ? error.message : 'Unknown error',
        action,
      })
      return false
    }
  }

  /**
   * Register handler factories for lazy initialization
   */
  private async registerHandlerFactories(): Promise<void> {
    // Register label/tag action handler factory
    const labelActions = [
      ActionType.APPLY_LABEL,
      ActionType.REMOVE_LABEL,
      ActionType.APPLY_TAG,
      ActionType.REMOVE_TAG,
    ]

    const labelHandlerFactory = async () => {
      return await createLabelActionHandler(this.serviceRegistry)
    }

    for (const actionType of labelActions) {
      this.handlerFactories.set(actionType, labelHandlerFactory)
    }

    // Register thread action handler factory
    const threadActions = [
      ActionType.ASSIGN_THREAD,
      ActionType.MARK_SPAM,
      ActionType.MARK_TRASH,
      ActionType.MOVE_TO_TRASH,
      ActionType.ARCHIVE,
      ActionType.ARCHIVE_THREAD,
      ActionType.UNARCHIVE_THREAD,
      ActionType.SEND_MESSAGE,
      ActionType.REPLY,
    ]

    const threadHandlerFactory = async () => {
      const { ThreadActionHandler } = await import('../handlers/thread-action-handler')
      const threadMutation = await getService(
        this.serviceRegistry,
        ServiceKeys.THREAD_MUTATION_SERVICE
      )
      const messageSender = await getService(this.serviceRegistry, ServiceKeys.MESSAGE_SENDER)
      const providerRegistry = await getService(this.serviceRegistry, ServiceKeys.PROVIDER_REGISTRY)

      return new ThreadActionHandler(
        threadMutation,
        this.organizationId,
        messageSender,
        providerRegistry
      )
    }

    for (const actionType of threadActions) {
      this.handlerFactories.set(actionType, threadHandlerFactory)
    }

    logger.debug('Handler factories registered', {
      factoryCount: this.handlerFactories.size,
      registeredActions: Array.from(this.handlerFactories.keys()),
    })
  }

  /**
   * Get or create handler for specific action type (lazy loading)
   */
  private async getOrCreateHandler(actionType: ActionType): Promise<ActionHandler | undefined> {
    // Return cached handler if available
    if (this.handlers.has(actionType)) {
      return this.handlers.get(actionType)
    }

    // Create handler using factory
    const factory = this.handlerFactories.get(actionType)
    if (!factory) {
      return undefined
    }

    logger.debug('Creating handler for action type', { actionType })
    const handler = await factory()

    // Cache the handler for reuse
    this.handlers.set(actionType, handler)
    return handler
  }

  /**
   * Get execution plan including capability checking and fallbacks
   */
  private async getExecutionPlan(
    action: ActionDefinition,
    context: ActionContext,
    handler: ActionHandler
  ): Promise<{
    canExecute: boolean
    fallbackAction?: ActionDefinition
  }> {
    // Get provider capabilities from integration
    // Note: This should ideally query the Integration table for the provider type
    // For now, we use a fallback to default capabilities if integration info not in context
    const providerType = context.integration?.provider as any
    const capabilities = providerType
      ? getProviderCapabilities(providerType)
      : this.getDefaultCapabilities()

    // Check if action is supported by provider
    const canExecute = handler.canHandle
      ? handler.canHandle(action.type, capabilities)
      : isActionSupported(action.type, capabilities)

    let fallbackAction: ActionDefinition | undefined

    // If primary action not supported, look for fallbacks
    if (!canExecute && action.fallbackActions?.length) {
      for (const fallback of action.fallbackActions) {
        const fallbackHandler = await this.getOrCreateHandler(fallback.type)
        if (fallbackHandler) {
          const fallbackSupported = fallbackHandler.canHandle
            ? fallbackHandler.canHandle(fallback.type, capabilities)
            : isActionSupported(fallback.type, capabilities)

          if (fallbackSupported) {
            fallbackAction = fallback
            break
          }
        }
      }
    }

    // If no explicit fallbacks, try to generate smart fallbacks
    if (!canExecute && !fallbackAction) {
      fallbackAction = this.generateSmartFallback(action, capabilities)
    }

    return {
      canExecute,
      fallbackAction,
    }
  }

  /**
   * Generate smart fallback actions when primary action not supported
   */
  private generateSmartFallback(
    action: ActionDefinition,
    capabilities: ProviderCapabilities
  ): ActionDefinition | undefined {
    const fallbackMap: Record<ActionType, ActionType[]> = {
      [ActionType.APPLY_LABEL]: [ActionType.APPLY_TAG],
      [ActionType.REMOVE_LABEL]: [ActionType.REMOVE_TAG],
      [ActionType.ARCHIVE]: [ActionType.APPLY_TAG],
      [ActionType.MARK_SPAM]: [ActionType.APPLY_TAG, ActionType.MARK_TRASH],
      [ActionType.FORWARD]: [ActionType.SEND_MESSAGE],
      [ActionType.DRAFT_EMAIL]: [ActionType.SEND_MESSAGE],
      [ActionType.REACT_TO_MESSAGE]: [ActionType.SEND_MESSAGE],
      [ActionType.SHARE_MESSAGE]: [ActionType.FORWARD, ActionType.SEND_MESSAGE],
    }

    const possibleFallbacks = fallbackMap[action.type] || []

    for (const fallbackType of possibleFallbacks) {
      if (isActionSupported(fallbackType, capabilities)) {
        logger.info('Generated smart fallback', {
          originalAction: action.type,
          fallbackAction: fallbackType,
        })

        return {
          ...action,
          type: fallbackType,
          params: this.adaptParametersForFallback(action, fallbackType),
          metadata: {
            ...action.metadata,
            isSmartFallback: true,
            originalActionType: action.type,
          },
        }
      }
    }

    return undefined
  }

  /**
   * Adapt action parameters when using fallback actions
   */
  private adaptParametersForFallback(
    originalAction: ActionDefinition,
    fallbackType: ActionType
  ): any {
    const baseParams = { ...originalAction.params }

    switch (fallbackType) {
      case ActionType.APPLY_TAG:
        if (originalAction.type === ActionType.APPLY_LABEL) {
          return {
            ...baseParams,
            tagName: baseParams.labelName || `label-${baseParams.labelId}`,
            labelId: undefined,
            labelName: undefined,
          }
        }

        if (originalAction.type === ActionType.ARCHIVE) {
          return {
            ...baseParams,
            tagName: 'archived',
            autoCreated: true,
          }
        }

        if (originalAction.type === ActionType.MARK_SPAM) {
          return {
            ...baseParams,
            tagName: 'spam',
            autoCreated: true,
          }
        }
        break

      case ActionType.SEND_MESSAGE:
        if (originalAction.type === ActionType.FORWARD) {
          return {
            ...baseParams,
            subject: `Fwd: ${baseParams.subject || ''}`,
            content: `Forwarded message:\n\n${baseParams.content || ''}`,
            isForward: true,
          }
        }
        break
    }

    return baseParams
  }

  /**
   * Group actions by their handlers for bulk optimization
   */
  private async groupActionsByHandler(
    actions: ActionDefinition[],
    context: ActionContext
  ): Promise<Map<ActionHandler, ActionDefinition[]>> {
    const grouped = new Map<ActionHandler, ActionDefinition[]>()

    for (const action of actions) {
      const handler = await this.getOrCreateHandler(action.type)
      if (!handler) continue

      if (!grouped.has(handler)) {
        grouped.set(handler, [])
      }
      grouped.get(handler)!.push(action)
    }

    return grouped
  }

  /**
   * Validate action-specific parameters
   */
  private validateActionParameters(action: ActionDefinition): boolean {
    switch (action.type) {
      case ActionType.ASSIGN_THREAD:
        return !!action.params.assigneeId

      case ActionType.SEND_MESSAGE:
      case ActionType.REPLY:
        return !!(action.params.to?.length || action.params.content)

      case ActionType.APPLY_LABEL:
      case ActionType.REMOVE_LABEL:
        return !!(action.params.labelId || action.params.labelName)

      case ActionType.APPLY_TAG:
      case ActionType.REMOVE_TAG:
        logger.debug('Validating tag action parameters', {
          actionType: action.type,
          params: action.params,
          hasTagId: !!action.params.tagId,
          hasTagIds: !!action.params.tagIds,
          hasTagName: !!action.params.tagName,
          tagIdsLength: Array.isArray(action.params.tagIds)
            ? action.params.tagIds.length
            : 'not array',
        })
        const hasValidTagIds =
          Array.isArray(action.params.tagIds) && action.params.tagIds.length > 0
        const isValid = !!(action.params.tagId || hasValidTagIds || action.params.tagName)
        logger.debug('Tag validation result', { isValid, hasValidTagIds })
        return isValid

      default:
        return true
    }
  }

  /**
   * Get default capabilities for unknown providers
   */
  private getDefaultCapabilities(): ProviderCapabilities {
    return {
      canSend: false,
      canReply: false,
      canForward: false,
      canDraft: false,
      canDelete: false,
      canArchive: false,
      canMarkSpam: false,
      canMarkTrash: false,
      canSearch: false,
      canApplyLabel: false,
      canRemoveLabel: false,
      canCreateLabel: false,
      labelScope: 'none',
      canManageThreads: false,
      canAssignThreads: false,
      canBulkOperations: false,
      canAttachFiles: false,
      canScheduleSend: false,
      canTrackOpens: false,
      canUseTemplates: false,
      canReact: false,
      canShare: false,
    }
  }

  /**
   * Ensure the executor is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  /**
   * Get execution statistics
   */
  getStats(): {
    handlerCount: number
    handlerFactoryCount: number
    supportedActions: ActionType[]
  } {
    return {
      handlerCount: this.handlers.size,
      handlerFactoryCount: this.handlerFactories.size,
      supportedActions: Array.from(this.handlerFactories.keys()),
    }
  }

  /**
   * Check if action type is supported
   */
  supportsAction(actionType: ActionType): boolean {
    return this.handlerFactories.has(actionType)
  }

  /**
   * Register additional handler
   */
  registerHandler(actionTypes: ActionType[], handlerFactory: () => Promise<ActionHandler>): void {
    for (const actionType of actionTypes) {
      this.handlerFactories.set(actionType, handlerFactory)
    }

    logger.debug('Additional handler factory registered', {
      actionTypes,
    })
  }
}

/**
 * Factory function to create ActionExecutor with service registry
 */
export async function createActionExecutor(
  serviceRegistry: ServiceRegistry
): Promise<ActionExecutor> {
  const executor = new ActionExecutor(serviceRegistry)
  await executor.initialize()
  return executor
}

/**
 * Legacy factory function for backward compatibility
 */
export function createActionExecutorLegacy(organizationId: string): ActionExecutor {
  // This would need a service registry - for now throw error to force migration
  throw new Error(
    'Legacy ActionExecutor creation no longer supported. Use createActionExecutor with ServiceRegistry instead.'
  )
}
