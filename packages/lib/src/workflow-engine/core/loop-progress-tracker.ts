// packages/lib/src/workflow-engine/core/loop-progress-tracker.ts

import { createScopedLogger } from '@auxx/logger'
import type { ExecutionContextManager } from './execution-context'

const logger = createScopedLogger('loop-progress-tracker')

/**
 * Loop progress update structure for WebSocket transmission
 */
export interface LoopProgressUpdate {
  type: 'loop_progress'
  workflowId: string
  executionId: string
  nodeId: string
  progress: {
    currentIteration: number
    totalIterations: number
    percentComplete: number
    estimatedTimeRemaining?: number
    currentItem?: any
    itemsPerSecond?: number
    status: 'running' | 'completed' | 'failed' | 'stopped'
  }
}

/**
 * Tracks loop execution progress and generates updates for real-time monitoring
 */
export class LoopProgressTracker {
  private iterationTimes: number[] = []
  private startTime: number = Date.now()
  private completedIterations: number = 0

  constructor(
    private workflowId: string,
    private executionId: string,
    private nodeId: string,
    private progressCallback?: (update: LoopProgressUpdate) => void | Promise<void>
  ) {}

  /**
   * Update progress for a loop iteration
   */
  async updateProgress(
    currentIteration: number,
    totalIterations: number,
    iterationDuration: number,
    currentItem?: any,
    status: 'running' | 'completed' | 'failed' | 'stopped' = 'running'
  ): Promise<void> {
    // Track iteration times for estimation
    this.iterationTimes.push(iterationDuration)
    if (this.iterationTimes.length > 10) {
      this.iterationTimes.shift() // Keep last 10 for moving average
    }

    // Update completed count
    if (status === 'running') {
      this.completedIterations = currentIteration + 1
    }

    // Calculate metrics
    const avgIterationTime = this.calculateAverageIterationTime()
    const estimatedTimeRemaining = this.calculateEstimatedTimeRemaining(
      currentIteration,
      totalIterations,
      avgIterationTime
    )
    const itemsPerSecond = avgIterationTime > 0 ? 1000 / avgIterationTime : 0

    const update: LoopProgressUpdate = {
      type: 'loop_progress',
      workflowId: this.workflowId,
      executionId: this.executionId,
      nodeId: this.nodeId,
      progress: {
        currentIteration,
        totalIterations,
        percentComplete: Math.round(((currentIteration + 1) / totalIterations) * 100),
        estimatedTimeRemaining,
        currentItem: this.sanitizeItem(currentItem),
        itemsPerSecond: Math.round(itemsPerSecond * 10) / 10,
        status,
      },
    }

    if (this.progressCallback) {
      try {
        await this.progressCallback(update)
      } catch (error) {
        logger.error('Failed to send progress update', {
          nodeId: this.nodeId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * Send a final progress update when loop completes
   */
  async completeProgress(
    totalIterations: number,
    status: 'completed' | 'failed' | 'stopped' = 'completed'
  ): Promise<void> {
    const totalTime = Date.now() - this.startTime
    const avgIterationTime = totalTime / this.completedIterations

    const update: LoopProgressUpdate = {
      type: 'loop_progress',
      workflowId: this.workflowId,
      executionId: this.executionId,
      nodeId: this.nodeId,
      progress: {
        currentIteration: this.completedIterations - 1,
        totalIterations,
        percentComplete: 100,
        estimatedTimeRemaining: 0,
        itemsPerSecond: avgIterationTime > 0 ? 1000 / avgIterationTime : 0,
        status,
      },
    }

    if (this.progressCallback) {
      try {
        await this.progressCallback(update)
      } catch (error) {
        logger.error('Failed to send completion update', {
          nodeId: this.nodeId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * Calculate average iteration time
   */
  private calculateAverageIterationTime(): number {
    if (this.iterationTimes.length === 0) return 0

    const sum = this.iterationTimes.reduce((a, b) => a + b, 0)
    return sum / this.iterationTimes.length
  }

  /**
   * Calculate estimated time remaining
   */
  private calculateEstimatedTimeRemaining(
    currentIteration: number,
    totalIterations: number,
    avgIterationTime: number
  ): number {
    const remainingIterations = totalIterations - currentIteration - 1
    return Math.max(0, remainingIterations * avgIterationTime)
  }

  /**
   * Sanitize item data for transmission
   */
  private sanitizeItem(item: any): any {
    if (!item) return null

    try {
      const str = JSON.stringify(item)
      // Limit item size to prevent large payloads
      if (str.length > 1000) {
        return {
          _truncated: true,
          _type: typeof item,
          preview: str.substring(0, 1000) + '...',
        }
      }
      return item
    } catch (error) {
      return {
        _error: 'Unable to serialize item',
        _type: typeof item,
      }
    }
  }

  /**
   * Reset the tracker for reuse
   */
  reset(): void {
    this.iterationTimes = []
    this.startTime = Date.now()
    this.completedIterations = 0
  }
}

/**
 * Factory function to create a loop progress tracker from execution context
 */
export function createLoopProgressTracker(
  contextManager: ExecutionContextManager,
  nodeId: string,
  progressCallback?: (update: LoopProgressUpdate) => void | Promise<void>
): LoopProgressTracker {
  const context = contextManager.getContext()
  return new LoopProgressTracker(context.workflowId, context.executionId, nodeId, progressCallback)
}

/**
 * Integration helper to connect loop progress with workflow execution options
 */
export function integrateLoopProgressWithCallbacks(
  contextManager: ExecutionContextManager,
  nodeId: string,
  options: any // WorkflowExecutionOptions
): LoopProgressTracker | null {
  // Check if we have the onNodeComplete callback
  if (!options.onNodeComplete) {
    return null
  }

  // Create a progress tracker that sends updates via the callback
  const progressCallback = async (update: LoopProgressUpdate) => {
    // Wrap the progress update as a node result
    const progressResult = {
      nodeId: update.nodeId,
      status: 'RUNNING' as any,
      output: update,
      metadata: {
        type: 'loop_progress',
        iteration: update.progress.currentIteration,
        total: update.progress.totalIterations,
      },
    }

    // Use the existing callback infrastructure
    if (options.onNodeProgress) {
      // If there's a specific progress callback, use it
      await options.onNodeProgress(nodeId, progressResult, contextManager.getContext())
    } else {
      // Otherwise, use the node complete callback
      await options.onNodeComplete(nodeId, progressResult, contextManager.getContext())
    }
  }

  return createLoopProgressTracker(contextManager, nodeId, progressCallback)
}
