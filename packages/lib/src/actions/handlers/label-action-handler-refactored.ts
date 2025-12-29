// packages/lib/src/actions/handlers/label-action-handler-refactored.ts

import { createScopedLogger } from '@auxx/logger'
import { ServiceRegistry } from '../../services/service-registry'
import { ServiceKeys, getService } from '../../services/service-registrations'
import { UniversalTagService } from '../../tags/universal-tag-service'
import { TagService } from '../../tags/tag-service'
import { ProviderRegistryService } from '../../providers/provider-registry-service'
import { getProviderCapabilities } from '../../providers/provider-capabilities'
import {
  ActionType,
  ActionDefinition,
  ActionContext,
  ActionResult,
  ActionHandler,
  BatchActionResult,
  ProviderCapabilities,
  isActionSupported,
} from '../core/action-types'

const logger = createScopedLogger('label-action-handler-refactored')

/**
 * Refactored LabelActionHandler using Service Registry Pattern
 *
 * Benefits:
 * - No manual service instantiation
 * - Automatic dependency injection
 * - Shared service instances across handlers
 * - Easier testing with service mocking
 * - Centralized service lifecycle management
 */
export class LabelActionHandlerRefactored implements ActionHandler {
  private universalTagService!: UniversalTagService
  private tagService!: TagService
  private providerRegistry!: ProviderRegistryService
  private organizationId!: string
  private userId!: string
  private initialized = false

  constructor(private serviceRegistry: ServiceRegistry) {}

  /**
   * Initialize handler by resolving services from registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    logger.debug('Initializing LabelActionHandler with service registry')

    try {
      // Resolve services from registry
      this.organizationId = await getService(this.serviceRegistry, ServiceKeys.ORGANIZATION_ID)
      this.userId = (await this.serviceRegistry.get<string>(ServiceKeys.USER_ID)) || 'system'
      this.universalTagService = await getService(
        this.serviceRegistry,
        ServiceKeys.UNIVERSAL_TAG_SERVICE
      )
      this.tagService = await getService(this.serviceRegistry, ServiceKeys.TAG_SERVICE)
      this.providerRegistry = await getService(this.serviceRegistry, ServiceKeys.PROVIDER_REGISTRY)

      this.initialized = true
      logger.info('LabelActionHandler initialized successfully', {
        organizationId: this.organizationId,
        userId: this.userId,
      })
    } catch (error) {
      logger.error('Failed to initialize LabelActionHandler', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      throw error
    }
  }

  /**
   * Handle a single label/tag action
   */
  async handle(action: ActionDefinition, context: ActionContext): Promise<ActionResult> {
    await this.ensureInitialized()

    const startTime = Date.now()
    const actionId = action.id || `${action.type}-${context.message.threadId}-${Date.now()}`

    logger.info('Handling label/tag action', {
      actionId,
      actionType: action.type,
      threadId: context.message.threadId,
      organizationId: this.organizationId,
    })

    try {
      // Get provider capabilities for the current integration
      // Schema change: Integration.provider is now the source of truth
      const providerType = (context.integration?.provider || 'unknown') as any
      const capabilities = getProviderCapabilities(providerType)

      // Route to appropriate handler based on action type
      switch (action.type) {
        case ActionType.APPLY_LABEL:
          return await this.handleApplyLabel(action, context, capabilities, actionId, startTime)

        case ActionType.REMOVE_LABEL:
          return await this.handleRemoveLabel(action, context, capabilities, actionId, startTime)

        case ActionType.APPLY_TAG:
          return await this.handleApplyTag(action, context, actionId, startTime)

        case ActionType.REMOVE_TAG:
          return await this.handleRemoveTag(action, context, actionId, startTime)

        default:
          return this.createErrorResult(
            actionId,
            action.type,
            `Unsupported action type: ${action.type}`,
            startTime
          )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Error handling label/tag action', {
        actionId,
        actionType: action.type,
        error: errorMessage,
      })

      return this.createErrorResult(actionId, action.type, errorMessage, startTime)
    }
  }

  /**
   * Handle bulk label/tag operations
   */
  async handleBulk(
    actions: ActionDefinition[],
    context: ActionContext
  ): Promise<BatchActionResult> {
    await this.ensureInitialized()

    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const startTime = Date.now()

    logger.info('Handling bulk label/tag actions', {
      batchId,
      actionCount: actions.length,
      organizationId: this.organizationId,
    })

    const results: ActionResult[] = []
    let successCount = 0
    let failureCount = 0

    // Group actions by type for bulk processing
    const actionsByType = this.groupActionsByType(actions)

    for (const [actionType, typeActions] of actionsByType.entries()) {
      try {
        logger.debug('Processing bulk actions of type', {
          batchId,
          actionType,
          actionCount: typeActions.length,
        })

        // Process actions of the same type together
        for (const action of typeActions) {
          const result = await this.handle(action, context)
          results.push(result)

          if (result.success) {
            successCount++
          } else {
            failureCount++
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error('Error processing bulk actions', {
          batchId,
          actionType,
          error: errorMessage,
        })

        // Create error results for failed actions
        const errorResults = typeActions.map((action) =>
          this.createErrorResult(
            action.id || `${action.type}-bulk-error`,
            action.type,
            errorMessage,
            startTime
          )
        )

        results.push(...errorResults)
        failureCount += errorResults.length
      }
    }

    const totalExecutionTime = Date.now() - startTime

    logger.info('Bulk label/tag actions completed', {
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
   * Check if handler can handle a specific action type
   */
  canHandle(actionType: ActionType, capabilities: ProviderCapabilities): boolean {
    const supportedActions = [
      ActionType.APPLY_LABEL,
      ActionType.REMOVE_LABEL,
      ActionType.APPLY_TAG,
      ActionType.REMOVE_TAG,
    ]

    if (!supportedActions.includes(actionType)) {
      return false
    }

    // Tag operations are always supported (universal)
    if (actionType === ActionType.APPLY_TAG || actionType === ActionType.REMOVE_TAG) {
      return true
    }

    // Label operations require provider support
    return isActionSupported(actionType, capabilities)
  }

  /**
   * Handle APPLY_LABEL action with provider capability checking
   */
  private async handleApplyLabel(
    action: ActionDefinition,
    context: ActionContext,
    capabilities: ProviderCapabilities,
    actionId: string,
    startTime: number
  ): Promise<ActionResult> {
    const { labelId, labelName, tagName } = action.params

    // Check if provider supports labels
    if (!capabilities.canApplyLabel) {
      logger.info('Provider does not support labels, falling back to universal tags', {
        actionId,
        providerType: context.integration?.provider || 'unknown',
      })

      // Fallback to applying a universal tag
      const fallbackTagName = tagName || labelName || `label-${labelId}`

      // First, find or create tag by name
      const tag = await this.tagService.findOrCreateTag(fallbackTagName, this.organizationId, {
        isLabelFallback: true,
        originalLabelId: labelId,
        originalLabelName: labelName,
      })

      await this.universalTagService.applyTag({
        tagId: tag.id,
        entityType: 'thread',
        entityId: context.message.threadId,
        createdBy: context.userId,
      })

      return this.createSuccessResult(
        actionId,
        ActionType.APPLY_LABEL,
        { appliedTag: fallbackTagName, fallbackUsed: true },
        startTime
      )
    }

    // Apply provider-specific label
    // Note: This would integrate with the provider's label system
    logger.info('Applying provider label', {
      actionId,
      labelId,
      labelName,
      threadId: context.message.threadId,
    })

    // TODO: Implement provider-specific label application
    // For now, we'll also apply a universal tag to maintain consistency
    if (tagName || labelName) {
      const tag = await this.tagService.findOrCreateTag(
        tagName || labelName!,
        this.organizationId,
        {
          linkedToLabel: labelId || labelName,
        }
      )

      await this.universalTagService.applyTag({
        tagId: tag.id,
        entityType: 'thread',
        entityId: context.message.threadId,
        createdBy: context.userId,
      })
    }

    return this.createSuccessResult(
      actionId,
      ActionType.APPLY_LABEL,
      { labelId, labelName },
      startTime
    )
  }

  /**
   * Handle REMOVE_LABEL action
   */
  private async handleRemoveLabel(
    action: ActionDefinition,
    context: ActionContext,
    capabilities: ProviderCapabilities,
    actionId: string,
    startTime: number
  ): Promise<ActionResult> {
    const { labelId, labelName, tagName } = action.params

    // Similar logic to APPLY_LABEL but for removal
    if (!capabilities.canRemoveLabel) {
      const fallbackTagName = tagName || labelName || `label-${labelId}`

      // Find tag by name
      const tag = await this.tagService.findTagByName(fallbackTagName, this.organizationId)
      if (tag) {
        await this.universalTagService.removeTag({
          tagId: tag.id,
          entityType: 'thread',
          entityId: context.message.threadId,
        })
      }

      return this.createSuccessResult(
        actionId,
        ActionType.REMOVE_LABEL,
        { removedTag: fallbackTagName, fallbackUsed: true },
        startTime
      )
    }

    // Remove provider-specific label and associated universal tag
    if (tagName || labelName) {
      const tag = await this.tagService.findTagByName(tagName || labelName!, this.organizationId)
      if (tag) {
        await this.universalTagService.removeTag({
          tagId: tag.id,
          entityType: 'thread',
          entityId: context.message.threadId,
        })
      }
    }

    return this.createSuccessResult(
      actionId,
      ActionType.REMOVE_LABEL,
      { labelId, labelName },
      startTime
    )
  }

  /**
   * Handle APPLY_TAG action (universal tags)
   */
  private async handleApplyTag(
    action: ActionDefinition,
    context: ActionContext,
    actionId: string,
    startTime: number
  ): Promise<ActionResult> {
    const { tagId, tagIds, tagName } = action.params

    if (tagIds && Array.isArray(tagIds)) {
      // Apply multiple tags
      for (const tId of tagIds) {
        await this.universalTagService.applyTag({
          tagId: tId,
          entityType: 'thread',
          entityId: context.message.threadId,
          createdBy: context.userId,
        })
      }

      return this.createSuccessResult(
        actionId,
        ActionType.APPLY_TAG,
        { appliedTagIds: tagIds },
        startTime
      )
    } else if (tagId) {
      // Apply single tag by ID
      await this.universalTagService.applyTag({
        tagId: tagId,
        entityType: 'thread',
        entityId: context.message.threadId,
        createdBy: context.userId,
      })

      return this.createSuccessResult(
        actionId,
        ActionType.APPLY_TAG,
        { appliedTagId: tagId },
        startTime
      )
    } else if (tagName) {
      // Apply single tag by name
      const tag = await this.tagService.findOrCreateTag(tagName, this.organizationId)
      await this.universalTagService.applyTag({
        tagId: tag.id,
        entityType: 'thread',
        entityId: context.message.threadId,
        createdBy: context.userId,
      })

      return this.createSuccessResult(
        actionId,
        ActionType.APPLY_TAG,
        { appliedTagName: tagName },
        startTime
      )
    }

    throw new Error('No tag ID or name provided for APPLY_TAG action')
  }

  /**
   * Handle REMOVE_TAG action
   */
  private async handleRemoveTag(
    action: ActionDefinition,
    context: ActionContext,
    actionId: string,
    startTime: number
  ): Promise<ActionResult> {
    const { tagId, tagIds, tagName } = action.params

    if (tagIds && Array.isArray(tagIds)) {
      // Remove multiple tags
      for (const tId of tagIds) {
        await this.universalTagService.removeTag({
          tagId: tId,
          entityType: 'thread',
          entityId: context.message.threadId,
        })
      }

      return this.createSuccessResult(
        actionId,
        ActionType.REMOVE_TAG,
        { removedTagIds: tagIds },
        startTime
      )
    } else if (tagId) {
      // Remove single tag by ID
      await this.universalTagService.removeTag({
        tagId: tagId,
        entityType: 'thread',
        entityId: context.message.threadId,
      })

      return this.createSuccessResult(
        actionId,
        ActionType.REMOVE_TAG,
        { removedTagId: tagId },
        startTime
      )
    } else if (tagName) {
      // Remove single tag by name
      const tag = await this.tagService.findTagByName(tagName, this.organizationId)
      if (tag) {
        await this.universalTagService.removeTag({
          tagId: tag.id,
          entityType: 'thread',
          entityId: context.message.threadId,
        })
      }

      return this.createSuccessResult(
        actionId,
        ActionType.REMOVE_TAG,
        { removedTagName: tagName },
        startTime
      )
    }

    throw new Error('No tag ID or name provided for REMOVE_TAG action')
  }

  /**
   * Group actions by type for bulk processing
   */
  private groupActionsByType(actions: ActionDefinition[]): Map<ActionType, ActionDefinition[]> {
    const grouped = new Map<ActionType, ActionDefinition[]>()

    for (const action of actions) {
      if (!grouped.has(action.type)) {
        grouped.set(action.type, [])
      }
      grouped.get(action.type)!.push(action)
    }

    return grouped
  }

  /**
   * Create a success result
   */
  private createSuccessResult(
    actionId: string,
    actionType: ActionType,
    result: any,
    startTime: number
  ): ActionResult {
    return {
      actionId,
      actionType,
      success: true,
      result,
      executionTime: Date.now(),
      metadata: {
        duration: Date.now() - startTime,
        handlerType: 'LabelActionHandlerRefactored',
      },
    }
  }

  /**
   * Create an error result
   */
  private createErrorResult(
    actionId: string,
    actionType: ActionType,
    error: string,
    startTime: number
  ): ActionResult {
    return {
      actionId,
      actionType,
      success: false,
      error,
      executionTime: Date.now(),
      metadata: {
        duration: Date.now() - startTime,
        handlerType: 'LabelActionHandlerRefactored',
      },
    }
  }

  /**
   * Ensure handler is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }
}

/**
 * Factory function to create LabelActionHandler with service registry
 */
export async function createLabelActionHandler(
  serviceRegistry: ServiceRegistry
): Promise<LabelActionHandlerRefactored> {
  const handler = new LabelActionHandlerRefactored(serviceRegistry)
  await handler.initialize()
  return handler
}
