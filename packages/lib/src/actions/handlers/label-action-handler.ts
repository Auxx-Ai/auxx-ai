// packages/lib/src/actions/handlers/label-action-handler.ts

import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { TagService } from '../../tags/tag-service'
import { UniversalTagService } from '../../tags/universal-tag-service'
import { LabelRepo } from '@auxx/lib/email'
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

const logger = createScopedLogger('label-action-handler')

/**
 * LabelActionHandler - Handles label and tag operations with provider capability awareness
 *
 * Features:
 * - Universal tag system for provider-agnostic tagging
 * - Provider-specific label operations when supported
 * - Automatic fallback to tags when labels aren't supported
 * - Intelligent label/tag linking and synchronization
 * - Bulk operations for efficient batch processing
 *
 * Supported Actions:
 * - APPLY_LABEL: Apply provider label (with tag fallback)
 * - REMOVE_LABEL: Remove provider label (with tag fallback)
 * - APPLY_TAG: Apply universal tag (works on all providers)
 * - REMOVE_TAG: Remove universal tag
 */
export class LabelActionHandler implements ActionHandler {
  private universalTagService: UniversalTagService
  private tagService: TagService

  constructor(
    private organizationId: string,
    private providerRegistry: ProviderRegistryService,
    private userId: string
  ) {
    this.universalTagService = new UniversalTagService(db, organizationId)
    this.tagService = new TagService(organizationId, userId, db)
  }

  /**
   * Handle individual label/tag action execution
   */
  async handle(
    action: ActionDefinition,
    context: ActionContext,
    provider?: any
  ): Promise<ActionResult> {
    const startTime = Date.now()

    logger.info('Executing label/tag action', {
      actionType: action.type,
      actionId: action.id,
      threadId: context.message.threadId,
      organizationId: this.organizationId,
    })

    try {
      switch (action.type) {
        case ActionType.APPLY_LABEL:
          return await this.handleApplyLabel(action, context)

        case ActionType.REMOVE_LABEL:
          return await this.handleRemoveLabel(action, context)

        case ActionType.APPLY_TAG:
          return await this.handleApplyTag(action, context)

        case ActionType.REMOVE_TAG:
          return await this.handleRemoveTag(action, context)

        default:
          throw new Error(`Unsupported action type: ${action.type}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      logger.error('Label/tag action execution failed', {
        actionType: action.type,
        actionId: action.id,
        error: errorMessage,
        threadId: context.message.threadId,
        organizationId: this.organizationId,
      })

      return {
        actionId: action.id || `${action.type}-${context.message.threadId}`,
        actionType: action.type,
        success: false,
        error: errorMessage,
        executionTime: Date.now(),
        metadata: {
          threadId: context.message.threadId,
          duration: Date.now() - startTime,
        },
      }
    }
  }

  /**
   * Handle bulk label/tag operations
   */
  async handleBulk(
    actions: ActionDefinition[],
    context: ActionContext,
    provider?: any
  ): Promise<BatchActionResult> {
    const batchStartTime = Date.now()
    const batchId = `label-batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    logger.info('Executing bulk label/tag actions', {
      batchId,
      actionCount: actions.length,
      organizationId: this.organizationId,
    })

    // Group actions by type for optimized bulk processing
    const actionsByType = this.groupActionsByType(actions)
    const results: ActionResult[] = []
    let successCount = 0
    let failureCount = 0

    for (const [actionType, actionsOfType] of actionsByType.entries()) {
      try {
        const bulkResults = await this.handleBulkActionsByType(actionType, actionsOfType, context)

        results.push(...bulkResults)
        successCount += bulkResults.filter((r) => r.success).length
        failureCount += bulkResults.filter((r) => !r.success).length
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logger.error('Bulk label action type execution failed', {
          actionType,
          actionCount: actionsOfType.length,
          error: errorMessage,
          batchId,
        })

        // Create error results for all failed actions
        const errorResults = actionsOfType.map((action) => ({
          actionId: action.id || `${action.type}-${Date.now()}`,
          actionType: action.type,
          success: false,
          error: errorMessage,
          executionTime: Date.now(),
          metadata: { batchId, bulkError: true },
        }))

        results.push(...errorResults)
        failureCount += errorResults.length
      }
    }

    const totalExecutionTime = Date.now() - batchStartTime

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
   * Check if this handler can handle the given action type
   */
  canHandle(actionType: ActionType, providerCapabilities?: ProviderCapabilities): boolean {
    const supportedActions = [
      ActionType.APPLY_LABEL,
      ActionType.REMOVE_LABEL,
      ActionType.APPLY_TAG,
      ActionType.REMOVE_TAG,
    ]

    if (!supportedActions.includes(actionType)) {
      return false
    }

    // Universal tag operations always supported
    if (actionType === ActionType.APPLY_TAG || actionType === ActionType.REMOVE_TAG) {
      return true
    }

    // Label operations depend on provider capabilities
    if (providerCapabilities) {
      return isActionSupported(actionType, providerCapabilities)
    }

    return true
  }

  // Private methods for specific action handling

  private async handleApplyLabel(
    action: ActionDefinition,
    context: ActionContext
  ): Promise<ActionResult> {
    const { tagId, labelName, labelId } = action.params
    const threadId = context.message.threadId
    const integrationId = context.message.integrationId
    // Schema change: Integration.provider is now the source of truth
    const providerType = context.integration?.provider || 'unknown'

    // Get provider capabilities
    const capabilities = getProviderCapabilities(providerType as any)

    // Always apply universal tag first (this ensures tagging works regardless of provider support)
    let universalTagId = tagId
    if (!universalTagId && (labelName || labelId)) {
      // Create or find tag for this label
      universalTagId = await this.getOrCreateTagForLabel(labelName || labelId, labelName)
    }

    if (!universalTagId) {
      throw new Error('Either tagId or labelName/labelId is required for APPLY_LABEL action')
    }

    // Apply the universal tag
    const tagResult = await this.universalTagService.applyTag({
      tagId: universalTagId,
      entityType: 'thread',
      entityId: threadId,
      createdBy: context.userId,
    })

    let labelApplied = false
    let labelResult = null
    let providerError: string | undefined

    // Apply provider label if supported
    if (capabilities.canApplyLabel && capabilities.labelScope !== 'none') {
      try {
        const provider = await this.providerRegistry.getProvider(integrationId)

        // Get or create the linked label for this tag
        const linkedLabel = await this.universalTagService.getOrCreateLinkedLabel(
          universalTagId,
          integrationId,
          providerType as any,
          // Provider label creation function
          async (name: string, color?: string) => {
            if ('createLabel' in provider && typeof provider.createLabel === 'function') {
              return await provider.createLabel(name, color)
            }
            throw new Error('Provider does not support label creation')
          }
        )

        if (linkedLabel) {
          // Determine target based on provider's label scope
          const targetId = capabilities.labelScope === 'message' ? context.message.id : threadId

          const targetType = capabilities.labelScope === 'message' ? 'message' : 'thread'

          // Apply provider label
          if ('addLabel' in provider && typeof provider.addLabel === 'function') {
            labelResult = await provider.addLabel(linkedLabel.labelId, targetId, targetType)
            labelApplied = !!labelResult

            // Track label application in database
            if (labelResult && capabilities.labelScope === 'thread') {
              await this.addLabelToThread(linkedLabel.labelId, threadId)
            }
          }
        }
      } catch (error) {
        providerError = error instanceof Error ? error.message : 'Provider label application failed'
        logger.warn('Failed to apply provider label, tag applied successfully', {
          error: providerError,
          tagId: universalTagId,
          threadId,
        })
      }
    }

    return {
      actionId: action.id || `apply-label-${threadId}-${universalTagId}`,
      actionType: ActionType.APPLY_LABEL,
      success: true, // Success if tag applied, even if label failed
      result: {
        tagApplied: !!tagResult.id,
        labelApplied,
        tagId: universalTagId,
        labelId: labelResult?.id,
      },
      executionTime: Date.now(),
      metadata: {
        tagApplied: true,
        labelApplied,
        providerSupported: capabilities.canApplyLabel,
        scope: capabilities.labelScope,
        fallbackUsed: !labelApplied && capabilities.canApplyLabel,
        providerError,
      },
    }
  }

  private async handleRemoveLabel(
    action: ActionDefinition,
    context: ActionContext
  ): Promise<ActionResult> {
    const { tagId, labelName, labelId } = action.params
    const threadId = context.message.threadId
    const integrationId = context.message.integrationId
    // Schema change: Integration.provider is now the source of truth
    const providerType = context.integration?.provider || 'unknown'

    // Get provider capabilities
    const capabilities = getProviderCapabilities(providerType as any)

    // Find the tag to remove
    let universalTagId = tagId
    if (!universalTagId && (labelName || labelId)) {
      universalTagId = await this.findTagForLabel(labelName || labelId)
    }

    if (!universalTagId) {
      throw new Error('Either tagId or labelName/labelId is required for REMOVE_LABEL action')
    }

    let tagRemoved = false
    let labelRemoved = false
    let providerError: string | undefined

    // Remove provider label if supported
    if (capabilities.canRemoveLabel && capabilities.labelScope !== 'none') {
      try {
        const provider = await this.providerRegistry.getProvider(integrationId)

        // Find the linked label
        const tagsWithLabels = await this.universalTagService.getTagsWithLabels(integrationId)
        const tagWithLabel = tagsWithLabels.find((t) => t.tagId === universalTagId)

        if (
          tagWithLabel?.labelId &&
          'removeLabel' in provider &&
          typeof provider.removeLabel === 'function'
        ) {
          const targetId = capabilities.labelScope === 'message' ? context.message.id : threadId

          const targetType = capabilities.labelScope === 'message' ? 'message' : 'thread'

          await provider.removeLabel(tagWithLabel.labelId, targetId, targetType)
          labelRemoved = true

          // Remove from tracking table
          if (capabilities.labelScope === 'thread') {
            await this.removeLabelFromThread(tagWithLabel.labelId, threadId)
          }
        }
      } catch (error) {
        providerError = error instanceof Error ? error.message : 'Provider label removal failed'
        logger.warn('Failed to remove provider label, will still remove tag', {
          error: providerError,
          tagId: universalTagId,
          threadId,
        })
      }
    }

    // Remove the universal tag
    try {
      await this.universalTagService.removeTag({
        tagId: universalTagId,
        entityType: 'thread',
        entityId: threadId,
      })
      tagRemoved = true
    } catch (error) {
      logger.error('Failed to remove universal tag', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tagId: universalTagId,
        threadId,
      })
    }

    return {
      actionId: action.id || `remove-label-${threadId}-${universalTagId}`,
      actionType: ActionType.REMOVE_LABEL,
      success: tagRemoved, // Success if tag removed
      result: {
        tagRemoved,
        labelRemoved,
        tagId: universalTagId,
      },
      executionTime: Date.now(),
      metadata: {
        tagRemoved,
        labelRemoved,
        providerSupported: capabilities.canRemoveLabel,
        scope: capabilities.labelScope,
        providerError,
      },
    }
  }

  private async handleApplyTag(
    action: ActionDefinition,
    context: ActionContext
  ): Promise<ActionResult> {
    const { tagId, tagIds, tagName } = action.params
    const threadId = context.message.threadId

    // Handle multiple tags if provided
    if (tagIds && Array.isArray(tagIds)) {
      const results = []
      for (const tId of tagIds) {
        const tagResult = await this.universalTagService.applyTag({
          tagId: tId,
          entityType: 'thread',
          entityId: threadId,
          createdBy: context.userId,
        })
        results.push({ tagId: tId, applied: !!tagResult.id })
      }

      return {
        actionId: action.id || `apply-tags-${threadId}`,
        actionType: ActionType.APPLY_TAG,
        success: true,
        result: { appliedTags: results },
        executionTime: Date.now(),
        metadata: {
          bulkTagOperation: true,
          tagCount: tagIds.length,
        },
      }
    }

    // Handle single tag
    let universalTagId = tagId
    if (!universalTagId && tagName) {
      // Create or find tag by name
      universalTagId = await this.getOrCreateTagByName(tagName, action.params.autoCreated)
    }

    if (!universalTagId) {
      throw new Error('Either tagId or tagName is required for APPLY_TAG action')
    }

    const tagResult = await this.universalTagService.applyTag({
      tagId: universalTagId,
      entityType: 'thread',
      entityId: threadId,
      createdBy: context.userId,
    })

    return {
      actionId: action.id || `apply-tag-${threadId}-${universalTagId}`,
      actionType: ActionType.APPLY_TAG,
      success: true,
      result: {
        tagApplied: !!tagResult.id,
        tagId: universalTagId,
      },
      executionTime: Date.now(),
      metadata: {
        universalTag: true,
        providerAgnostic: true,
      },
    }
  }

  private async handleRemoveTag(
    action: ActionDefinition,
    context: ActionContext
  ): Promise<ActionResult> {
    const { tagId, tagIds } = action.params
    const threadId = context.message.threadId

    // Handle multiple tags if provided
    if (tagIds && Array.isArray(tagIds)) {
      const results = []
      for (const tId of tagIds) {
        try {
          await this.universalTagService.removeTag({
            tagId: tId,
            entityType: 'thread',
            entityId: threadId,
          })
          results.push({ tagId: tId, removed: true })
        } catch (error) {
          results.push({
            tagId: tId,
            removed: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }

      return {
        actionId: action.id || `remove-tags-${threadId}`,
        actionType: ActionType.REMOVE_TAG,
        success: true,
        result: { removedTags: results },
        executionTime: Date.now(),
        metadata: {
          bulkTagOperation: true,
          tagCount: tagIds.length,
        },
      }
    }

    // Handle single tag
    if (!tagId) {
      throw new Error('tagId is required for REMOVE_TAG action')
    }

    let tagRemoved = false
    try {
      await this.universalTagService.removeTag({
        tagId,
        entityType: 'thread',
        entityId: threadId,
      })
      tagRemoved = true
    } catch (error) {
      logger.error('Failed to remove tag', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tagId,
        threadId,
      })
    }

    return {
      actionId: action.id || `remove-tag-${threadId}-${tagId}`,
      actionType: ActionType.REMOVE_TAG,
      success: tagRemoved,
      result: {
        tagRemoved,
        tagId,
      },
      executionTime: Date.now(),
      metadata: {
        universalTag: true,
        providerAgnostic: true,
      },
    }
  }

  // Helper methods for bulk operations

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

  private async handleBulkActionsByType(
    actionType: ActionType,
    actions: ActionDefinition[],
    context: ActionContext
  ): Promise<ActionResult[]> {
    // For now, execute individually - could be optimized with batch operations
    const results: ActionResult[] = []

    for (const action of actions) {
      const result = await this.handle(action, context)
      results.push(result)
    }

    return results
  }

  // Helper methods for tag/label management

  private async getOrCreateTagForLabel(
    labelIdentifier: string,
    labelName?: string
  ): Promise<string> {
    const name = labelName || labelIdentifier

    // Try to find existing tag by title (Drizzle)
    const [existing] = await db
      .select({ id: schema.Tag.id })
      .from(schema.Tag)
      .where(and(eq(schema.Tag.organizationId, this.organizationId), eq(schema.Tag.title, name)))
      .limit(1)

    if (existing) return existing.id

    const newTag = await this.tagService.createTag({
      title: name,
      description: `Auto-created for label: ${labelIdentifier}`,
      color: '#6B7280',
    })

    return newTag.id
  }

  private async findTagForLabel(labelIdentifier: string): Promise<string | null> {
    // Try to find tag by title (Drizzle)
    const [tag] = await db
      .select({ id: schema.Tag.id })
      .from(schema.Tag)
      .where(
        and(
          eq(schema.Tag.organizationId, this.organizationId),
          eq(schema.Tag.title, labelIdentifier)
        )
      )
      .limit(1)

    return tag?.id || null
  }

  private async getOrCreateTagByName(tagName: string, autoCreated?: boolean): Promise<string> {
    // Try to find existing tag
    const [existingTag] = await db
      .select({ id: schema.Tag.id })
      .from(schema.Tag)
      .where(
        and(
          eq(schema.Tag.organizationId, this.organizationId),
          eq(schema.Tag.title, tagName) // Note: using 'title' field instead of 'name'
        )
      )
      .limit(1)

    if (existingTag) {
      return existingTag.id
    }

    // Create new tag if auto-creation is allowed
    if (autoCreated) {
      const newTag = await this.tagService.createTag({
        title: tagName,
        description: autoCreated ? 'Auto-created tag' : undefined,
        color: '#6B7280',
      })
      return newTag.id
    }

    throw new Error(`Tag "${tagName}" not found and auto-creation not enabled`)
  }

  private async addLabelToThread(labelId: string, threadId: string): Promise<void> {
    try {
      const repo = new LabelRepo()
      await repo.addLabelToThread(labelId, threadId)
    } catch (error) {
      logger.warn('Failed to track label on thread', {
        error: error instanceof Error ? error.message : 'Unknown error',
        labelId,
        threadId,
      })
    }
  }

  private async removeLabelFromThread(labelId: string, threadId: string): Promise<void> {
    try {
      const repo = new LabelRepo()
      await repo.removeLabelFromThread(labelId, threadId)
    } catch (error) {
      // It's okay if the record doesn't exist
      logger.debug('Label was not tracked on thread', {
        labelId,
        threadId,
      })
    }
  }
}
