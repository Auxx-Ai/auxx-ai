// packages/lib/src/workflow-engine/core/error-handlers.ts

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import type { ExecutionContextManager } from './execution-context'
import type { WorkflowNode, WorkflowExecutionOptions } from './types'
import { WorkflowNodeError, WorkflowNodeProcessingError } from './errors'
import { NodeRunningStatus } from './types'
import { WorkflowEventType } from '../shared/types'

const logger = createScopedLogger('workflow-error-handlers')

/**
 * Handle preprocessing errors by emitting both WORKFLOW_FAILED and NODE_FAILED events
 */
export async function handlePreprocessingError(
  error: WorkflowNodeProcessingError,
  node: WorkflowNode,
  options: WorkflowExecutionOptions,
  contextManager: ExecutionContextManager,
  nodeExecutionId?: string
) {
  // Call onNodeError callback
  if (options.onNodeError) {
    await options.onNodeError(node.nodeId, error, contextManager.getContext())
  }

  if (options.reporter && options.workflowRunId) {
    // Emit NODE_FAILED event with detailed node context
    // Note: WORKFLOW_FAILED will be emitted by the main workflow catch block
    if (nodeExecutionId) {
      try {
        const [failedNodeExecution] = await db
          .update(schema.WorkflowNodeExecution)
          .set({
            status: NodeRunningStatus.Failed,
            error: error.message,
            finishedAt: new Date(),
          })
          .where(eq(schema.WorkflowNodeExecution.id, nodeExecutionId))
          .returning()

        if (failedNodeExecution) {
          logger.info('Emitting NODE_FAILED event (preprocessing error)', {
            nodeId: failedNodeExecution.nodeId,
            nodeType: failedNodeExecution.nodeType,
            error: error.message,
            workflowRunId: options.workflowRunId,
          })

          await options.reporter.emit(WorkflowEventType.NODE_FAILED, {
            ...failedNodeExecution,
            errorSource: error.context.errorSource,
            errorMetadata: error.context.metadata,
          })
        }
      } catch (updateError) {
        logger.error('Failed to update node execution on preprocessing error', {
          error: updateError,
        })
      }
    }
  }
}

/**
 * Handle node errors by emitting NODE_FAILED event only
 */
export async function handleNodeError(
  error: WorkflowNodeError,
  node: WorkflowNode,
  options: WorkflowExecutionOptions,
  contextManager: ExecutionContextManager,
  nodeExecutionId?: string
) {
  // Call onNodeError callback
  if (options.onNodeError) {
    await options.onNodeError(node.nodeId, error, contextManager.getContext())
  }

  // Emit NODE_FAILED event only (execution errors are node-level failures)
  if (options.reporter && options.workflowRunId && nodeExecutionId) {
    try {
      const [failedNodeExecution] = await db
        .update(schema.WorkflowNodeExecution)
        .set({
          status: NodeRunningStatus.Failed,
          error: error.message,
          finishedAt: new Date(),
        })
        .where(eq(schema.WorkflowNodeExecution.id, nodeExecutionId))
        .returning()

      if (failedNodeExecution) {
        logger.info('Emitting NODE_FAILED event', {
          nodeId: failedNodeExecution.nodeId,
          nodeType: failedNodeExecution.nodeType,
          error: error.message,
          workflowRunId: options.workflowRunId,
        })

        await options.reporter.emit(WorkflowEventType.NODE_FAILED, {
          ...failedNodeExecution,
          errorSource: error.context.errorSource,
          errorMetadata: error.context.metadata,
        })
      }
    } catch (updateError) {
      logger.error('Failed to update node execution on error', { error: updateError })
    }
  }
}
