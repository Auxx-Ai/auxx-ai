// packages/lib/src/workflow-engine/core/execution-tracking.ts

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('execution-tracking')

/**
 * Fork/branch context for parallel execution tracking
 */
export interface ForkContext {
  forkId?: string
  branchIndex?: number
  executionPath?: string
}

/**
 * Serializable state for persistence across pause/resume
 */
export interface ExecutionTrackingState {
  executionCounter: number
  lastExecutedNodeId: string | null
  currentDepth: number
  forkContext?: ForkContext
}

/**
 * Manages execution metadata and tracking
 *
 * Responsibilities:
 * - Track execution order (counter, predecessor)
 * - Track depth for UI indentation
 * - Manage fork/branch context for parallel execution
 * - Serialize/deserialize state for pause/resume
 */
export class ExecutionTrackingManager {
  private executionCounter = 0
  private lastExecutedNodeId: string | null = null
  private currentDepth = 0
  private forkContext = new Map<string, any>()

  // --- Lifecycle Management ---

  /**
   * Reset all tracking state for a new workflow run
   */
  reset(): void {
    this.executionCounter = 0
    this.lastExecutedNodeId = null
    this.currentDepth = 0
    this.forkContext.clear()

    logger.debug('Execution tracking reset')
  }

  /**
   * Export current state for persistence
   */
  exportState(): ExecutionTrackingState {
    return {
      executionCounter: this.executionCounter,
      lastExecutedNodeId: this.lastExecutedNodeId,
      currentDepth: this.currentDepth,
      forkContext: this.getForkContextSnapshot(),
    }
  }

  /**
   * Import state for resume
   */
  importState(state: ExecutionTrackingState): void {
    this.executionCounter = state.executionCounter
    this.lastExecutedNodeId = state.lastExecutedNodeId
    this.currentDepth = state.currentDepth

    // Restore fork context if present
    if (state.forkContext) {
      if (state.forkContext.forkId !== undefined) {
        this.forkContext.set('forkId', state.forkContext.forkId)
      }
      if (state.forkContext.branchIndex !== undefined) {
        this.forkContext.set('branchIndex', state.forkContext.branchIndex)
      }
      if (state.forkContext.executionPath !== undefined) {
        this.forkContext.set('executionPath', state.forkContext.executionPath)
      }
    }

    logger.debug('Execution tracking state imported', {
      executionCounter: this.executionCounter,
      lastExecutedNodeId: this.lastExecutedNodeId,
      currentDepth: this.currentDepth,
      hasForkContext: !!state.forkContext,
    })
  }

  // --- Execution Counter ---

  /**
   * Increment and get execution counter
   * Used to assign sequential index to node executions
   */
  incrementCounter(): number {
    return ++this.executionCounter
  }

  /**
   * Get current counter value without incrementing
   */
  getCounter(): number {
    return this.executionCounter
  }

  // --- Predecessor Tracking ---

  /**
   * Set the last executed node ID
   * Used to track execution predecessor for path visualization
   */
  setLastExecutedNode(nodeId: string): void {
    this.lastExecutedNodeId = nodeId
  }

  /**
   * Get the last executed node ID
   */
  getLastExecutedNode(): string | null {
    return this.lastExecutedNodeId
  }

  // --- Depth Management (for UI indentation) ---

  /**
   * Get current depth level
   * Used for UI indentation of nested contexts (loops, branches)
   */
  getDepth(): number {
    return this.currentDepth
  }

  /**
   * Increment depth when entering nested context
   * Call when entering: loops, branches, sub-workflows
   */
  incrementDepth(): void {
    this.currentDepth++
    logger.debug(`Depth incremented to ${this.currentDepth}`)
  }

  /**
   * Decrement depth when exiting nested context
   * Call when exiting: loops, branches, sub-workflows
   */
  decrementDepth(): void {
    if (this.currentDepth > 0) {
      this.currentDepth--
      logger.debug(`Depth decremented to ${this.currentDepth}`)
    } else {
      logger.warn('Attempted to decrement depth below 0')
    }
  }

  // --- Fork Context (for parallel execution) ---

  /**
   * Set fork context for parallel branch execution
   */
  setForkContext(forkId: string, branchIndex: number, executionPath: string): void {
    this.forkContext.set('forkId', forkId)
    this.forkContext.set('branchIndex', branchIndex)
    this.forkContext.set('executionPath', executionPath)

    logger.debug('Fork context set', { forkId, branchIndex, executionPath })
  }

  /**
   * Get fork context value
   */
  getForkContext<T = any>(key: 'forkId' | 'branchIndex' | 'executionPath'): T | undefined {
    return this.forkContext.get(key) as T | undefined
  }

  /**
   * Clear fork context after branch execution
   */
  clearForkContext(): void {
    this.forkContext.delete('forkId')
    this.forkContext.delete('branchIndex')
    this.forkContext.delete('executionPath')

    logger.debug('Fork context cleared')
  }

  /**
   * Get all fork context as object (for persistence)
   */
  getForkContextSnapshot(): ForkContext {
    return {
      forkId: this.forkContext.get('forkId'),
      branchIndex: this.forkContext.get('branchIndex'),
      executionPath: this.forkContext.get('executionPath'),
    }
  }

  // --- Utility ---

  /**
   * Generate unique execution ID
   * Format: exec_{timestamp}_{random}
   */
  generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
}
