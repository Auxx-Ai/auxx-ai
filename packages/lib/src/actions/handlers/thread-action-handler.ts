// packages/lib/src/actions/handlers/thread-action-handler.ts
import { ThreadMutationService } from '../../threads/thread-mutation.service'
import { MessageSenderService } from '../../messages/message-sender.service'
import { ProviderRegistryService } from '../../providers/provider-registry-service'
import { createScopedLogger } from '@auxx/logger'
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

const logger = createScopedLogger('thread-action-handler')

/**
 * ThreadActionHandler - Uses specialized thread services for action execution
 *
 * Updated to use the new modular service architecture:
 * - ThreadMutationService for thread state changes
 * - MessageSenderService for message sending
 *
 * Supported Actions:
 * - ASSIGN_THREAD: Thread assignment with organization validation
 * - MARK_SPAM: Sets thread status to SPAM
 * - MARK_TRASH/MOVE_TO_TRASH: Sets thread status to TRASH
 * - ARCHIVE/ARCHIVE_THREAD: Sets thread status to ARCHIVED
 * - UNARCHIVE_THREAD: Sets thread status to OPEN
 * - SEND_MESSAGE/REPLY: Comprehensive message sending with provider integration
 *
 * Features:
 * - Bulk operations using specialized service bulk methods
 * - Transaction safety for complex operations
 * - Comprehensive error handling and logging
 * - Provider capability awareness
 */
export class ThreadActionHandler implements ActionHandler {
  constructor(
    private threadMutation: ThreadMutationService,
    private organizationId: string,
    private messageSender?: MessageSenderService,
    private providerRegistry?: ProviderRegistryService
  ) {}

  /**
   * Handle individual action execution
   */
  async handle(
    action: ActionDefinition,
    context: ActionContext,
    provider?: any
  ): Promise<ActionResult> {
    const startTime = Date.now()

    logger.info('Executing thread action', {
      actionType: action.type,
      actionId: action.id,
      threadId: context.message.threadId,
      organizationId: this.organizationId,
    })

    try {
      switch (action.type) {
        case ActionType.ASSIGN_THREAD:
          return await this.handleAssignThread(action, context)

        case ActionType.MARK_SPAM:
          return await this.handleMarkAsSpam(action, context)

        case ActionType.MARK_TRASH:
        case ActionType.MOVE_TO_TRASH:
          return await this.handleMoveToTrash(action, context)

        case ActionType.ARCHIVE:
        case ActionType.ARCHIVE_THREAD:
          return await this.handleArchiveThread(action, context)

        case ActionType.UNARCHIVE_THREAD:
          return await this.handleUnarchiveThread(action, context)

        case ActionType.SEND_MESSAGE:
        case ActionType.REPLY:
        // return await this.handleSendMessage(action, context)

        default:
          throw new Error(`Unsupported action type: ${action.type}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      logger.error('Thread action execution failed', {
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
   * Handle bulk action execution
   */
  async handleBulk(
    actions: ActionDefinition[],
    context: ActionContext,
    provider?: any
  ): Promise<BatchActionResult> {
    const batchStartTime = Date.now()
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    logger.info('Executing bulk thread actions', {
      batchId,
      actionCount: actions.length,
      organizationId: this.organizationId,
    })

    // Group actions by type for efficient bulk processing
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
        logger.error('Bulk action type execution failed', {
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

    logger.info('Bulk thread actions completed', {
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

    if (!supportedActions.includes(actionType)) {
      return false
    }

    // Check provider capabilities if provided
    if (providerCapabilities) {
      return isActionSupported(actionType, providerCapabilities)
    }

    return true
  }

  // Private methods for specific action handling

  private async handleAssignThread(
    action: ActionDefinition,
    context: ActionContext
  ): Promise<ActionResult> {
    const { assigneeId } = action.params
    const threadId = action.params.threadId || context.message.threadId

    if (!assigneeId) {
      throw new Error('assigneeId is required for ASSIGN_THREAD action')
    }

    const result = await this.threadMutation.assignThread(threadId, assigneeId)

    return {
      actionId: action.id || `assign-${threadId}`,
      actionType: ActionType.ASSIGN_THREAD,
      success: true,
      result: { threadId, assigneeId, updatedThread: result },
      executionTime: Date.now(),
      metadata: {
        threadId,
        assigneeId,
        previousAssignee: result.assigneeId,
      },
    }
  }

  private async handleMarkAsSpam(
    action: ActionDefinition,
    context: ActionContext
  ): Promise<ActionResult> {
    const threadId = action.params.threadId || context.message.threadId

    const result = await this.threadMutation.markAsSpam(threadId)

    return {
      actionId: action.id || `spam-${threadId}`,
      actionType: ActionType.MARK_SPAM,
      success: true,
      result: result,
      executionTime: Date.now(),
      metadata: {
        threadId,
        threadStatus: 'SPAM',
        previousStatus: result.status,
      },
    }
  }

  private async handleMoveToTrash(
    action: ActionDefinition,
    context: ActionContext
  ): Promise<ActionResult> {
    const threadId = action.params.threadId || context.message.threadId

    const result = await this.threadMutation.moveToTrash(threadId)

    return {
      actionId: action.id || `trash-${threadId}`,
      actionType: ActionType.MARK_TRASH,
      success: true,
      result: result,
      executionTime: Date.now(),
      metadata: {
        threadId,
        threadStatus: 'TRASH',
        previousStatus: result.status,
      },
    }
  }

  private async handleArchiveThread(
    action: ActionDefinition,
    context: ActionContext
  ): Promise<ActionResult> {
    const threadId = action.params.threadId || context.message.threadId

    const result = await this.threadMutation.archiveThread(threadId)

    return {
      actionId: action.id || `archive-${threadId}`,
      actionType: ActionType.ARCHIVE_THREAD,
      success: true,
      result: result,
      executionTime: Date.now(),
      metadata: {
        threadId,
        threadStatus: 'ARCHIVED',
        previousStatus: result.status,
      },
    }
  }

  private async handleUnarchiveThread(
    action: ActionDefinition,
    context: ActionContext
  ): Promise<ActionResult> {
    const threadId = action.params.threadId || context.message.threadId

    const result = await this.threadMutation.unarchiveThread(threadId)

    return {
      actionId: action.id || `unarchive-${threadId}`,
      actionType: ActionType.UNARCHIVE_THREAD,
      success: true,
      result: result,
      executionTime: Date.now(),
      metadata: {
        threadId,
        threadStatus: 'OPEN',
        previousStatus: result.status,
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
    // Extract thread IDs for bulk operations
    const threadIds = actions.map((action) => action.params.threadId || context.message.threadId)

    switch (actionType) {
      case ActionType.MARK_TRASH:
      case ActionType.MOVE_TO_TRASH:
        return this.handleBulkMoveToTrash(actions, threadIds)

      case ActionType.MARK_SPAM:
        return this.handleBulkMarkAsSpam(actions, threadIds)

      case ActionType.ARCHIVE_THREAD:
        return this.handleBulkArchive(actions, threadIds)

      case ActionType.UNARCHIVE_THREAD:
        return this.handleBulkUnarchive(actions, threadIds)

      case ActionType.ASSIGN_THREAD:
        return this.handleBulkAssign(actions, context)

      default:
        // For actions that don't support bulk operations, execute individually
        const results: ActionResult[] = []
        for (const action of actions) {
          const result = await this.handle(action, context)
          results.push(result)
        }
        return results
    }
  }

  private async handleBulkMoveToTrash(
    actions: ActionDefinition[],
    threadIds: string[]
  ): Promise<ActionResult[]> {
    const bulkResult = await this.threadMutation.moveToTrashBulk(threadIds)

    return actions.map((action, index) => ({
      actionId: action.id || `bulk-trash-${threadIds[index]}`,
      actionType: ActionType.MARK_TRASH,
      success: true,
      executionTime: Date.now(),
      metadata: {
        threadId: threadIds[index],
        bulkCount: bulkResult.count,
        bulkOperation: true,
      },
    }))
  }

  private async handleBulkMarkAsSpam(
    actions: ActionDefinition[],
    threadIds: string[]
  ): Promise<ActionResult[]> {
    const bulkResult = await this.threadMutation.markAsSpamBulk(threadIds)

    return actions.map((action, index) => ({
      actionId: action.id || `bulk-spam-${threadIds[index]}`,
      actionType: ActionType.MARK_SPAM,
      success: true,
      executionTime: Date.now(),
      metadata: {
        threadId: threadIds[index],
        bulkCount: bulkResult.count,
        bulkOperation: true,
      },
    }))
  }

  private async handleBulkArchive(
    actions: ActionDefinition[],
    threadIds: string[]
  ): Promise<ActionResult[]> {
    const bulkResult = await this.threadMutation.archiveThreadBulk(threadIds)

    return actions.map((action, index) => ({
      actionId: action.id || `bulk-archive-${threadIds[index]}`,
      actionType: ActionType.ARCHIVE_THREAD,
      success: true,
      executionTime: Date.now(),
      metadata: {
        threadId: threadIds[index],
        bulkCount: bulkResult.count,
        bulkOperation: true,
      },
    }))
  }

  private async handleBulkUnarchive(
    actions: ActionDefinition[],
    threadIds: string[]
  ): Promise<ActionResult[]> {
    const bulkResult = await this.threadMutation.unarchiveThreadBulk(threadIds)

    return actions.map((action, index) => ({
      actionId: action.id || `bulk-unarchive-${threadIds[index]}`,
      actionType: ActionType.UNARCHIVE_THREAD,
      success: true,
      executionTime: Date.now(),
      metadata: {
        threadId: threadIds[index],
        bulkCount: bulkResult.count,
        bulkOperation: true,
      },
    }))
  }

  private async handleBulkAssign(
    actions: ActionDefinition[],
    context: ActionContext
  ): Promise<ActionResult[]> {
    // Group by assignee for efficient bulk assignment
    const assignmentGroups = new Map<string, { actions: ActionDefinition[]; threadIds: string[] }>()

    actions.forEach((action, index) => {
      const assigneeId = action.params.assigneeId
      if (!assigneeId) {
        throw new Error('assigneeId is required for bulk ASSIGN_THREAD actions')
      }

      if (!assignmentGroups.has(assigneeId)) {
        assignmentGroups.set(assigneeId, { actions: [], threadIds: [] })
      }

      const group = assignmentGroups.get(assigneeId)!
      group.actions.push(action)
      group.threadIds.push(action.params.threadId || context.message.threadId)
    })

    const results: ActionResult[] = []

    for (const [assigneeId, group] of assignmentGroups.entries()) {
      const bulkResult = await this.threadMutation.assignThreadBulk(group.threadIds, assigneeId)

      const groupResults = group.actions.map((action, index) => ({
        actionId: action.id || `bulk-assign-${group.threadIds[index]}`,
        actionType: ActionType.ASSIGN_THREAD,
        success: true,
        executionTime: Date.now(),
        metadata: {
          threadId: group.threadIds[index],
          assigneeId,
          bulkCount: bulkResult.count,
          bulkOperation: true,
        },
      }))

      results.push(...groupResults)
    }

    return results
  }
}
