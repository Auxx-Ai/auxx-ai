// packages/lib/src/workflow-engine/core/state-persistence-manager.ts

import { ExecutionContextManager } from './execution-context'
import type {
  ExecutionState,
  NodeExecutionResult,
  PauseReason,
  WorkflowExecutionStatus,
} from './types'

/**
 * Options for saving execution state
 */
export interface SaveStateOptions {
  /** Current node being executed or paused at */
  currentNodeId?: string
  /** Execution status (RUNNING, PAUSED, etc.) */
  status?: WorkflowExecutionStatus
  /** Reason for pausing (if applicable) */
  pauseReason?: PauseReason
  /** Whether this is a terminal pause (entire workflow) vs branch-level pause */
  isTerminalPause?: boolean
  /** Execution tracking data from ExecutionTrackingManager */
  executionTracking?: {
    executionCounter: number
    lastExecutedNodeId: string | null
    currentDepth: number
    forkContext?: {
      forkId?: string
      branchIndex?: number
      executionPath?: string
    }
  }
}

/**
 * Manages workflow execution state persistence for pause/resume functionality
 *
 * Maintains two separate stores:
 * - executionStates: All execution states (terminal + branch pauses)
 * - pausedExecutions: Only terminal pauses (workflow-level)
 *
 * This distinction is critical for parallel execution where branch-level
 * pauses should not mark the entire workflow as paused.
 */
export class StatePersistenceManager {
  private executionStates = new Map<string, ExecutionState>()
  private pausedExecutions = new Map<string, ExecutionState>()

  /**
   * Save execution state for pause/resume
   *
   * @param executionId - Unique execution identifier
   * @param contextManager - Current execution context
   * @param nodeResults - Results from executed nodes
   * @param options - Save options including pause reason, terminal flag, tracking data
   * @returns The created execution state
   */
  saveState(
    executionId: string,
    contextManager: ExecutionContextManager,
    nodeResults: Record<string, NodeExecutionResult>,
    options: SaveStateOptions = {}
  ): ExecutionState {
    const context = contextManager.getContext()

    const state: ExecutionState = {
      executionId,
      workflowId: context.workflowId,
      status: options.status || context.status!,
      currentNodeId: options.currentNodeId || null,
      visitedNodes: new Set(context.visitedNodes),
      nodeResults: { ...nodeResults },
      context: {
        variables: contextManager.getAllVariables(),
        systemVariables: contextManager.getSystemVariables(),
        nodeVariables: contextManager.getAllNodeVariables(),
        logs: context.logs,
        executionPath: contextManager.getExecutionPath(),
      },
      startedAt: context.startedAt,
      pausedAt: options.pauseReason ? new Date() : undefined,
      pauseReason: options.pauseReason,
      executionTracking: options.executionTracking,
    }

    // Always store in executionStates
    this.executionStates.set(executionId, state)

    // Only store in pausedExecutions for terminal pauses
    if (options.isTerminalPause) {
      this.pausedExecutions.set(executionId, state)
    }

    return state
  }

  /**
   * Get execution state (from either store)
   * Checks both executionStates and pausedExecutions
   *
   * @param executionId - Execution identifier
   * @returns Execution state if found
   */
  getState(executionId: string): ExecutionState | undefined {
    return this.executionStates.get(executionId) || this.pausedExecutions.get(executionId)
  }

  /**
   * Get paused execution state (terminal pauses only)
   * Only checks pausedExecutions store
   *
   * @param executionId - Execution identifier
   * @returns Execution state if it's a terminal pause
   */
  getPausedState(executionId: string): ExecutionState | undefined {
    return this.pausedExecutions.get(executionId)
  }

  /**
   * Check if execution has a terminal pause
   *
   * @param executionId - Execution identifier
   * @returns True if execution is in pausedExecutions
   */
  isTerminalPause(executionId: string): boolean {
    return this.pausedExecutions.has(executionId)
  }

  /**
   * Clear execution state from both stores
   * Called on workflow completion or cancellation
   *
   * @param executionId - Execution identifier
   */
  clearState(executionId: string): void {
    this.executionStates.delete(executionId)
    this.pausedExecutions.delete(executionId)
  }

  /**
   * Restore execution context from saved state
   * Creates a new ExecutionContextManager and populates it
   *
   * @param state - Saved execution state
   * @returns Restored execution context manager
   */
  restoreContext(state: ExecutionState): ExecutionContextManager {
    // Create new context manager with system variables
    const contextManager = new ExecutionContextManager(
      state.workflowId,
      state.executionId,
      state.context.systemVariables['sys.organizationId'] as string,
      state.context.systemVariables['sys.userId'] as string,
      state.context.systemVariables['sys.userEmail'] as string,
      state.context.systemVariables['sys.userName'] as string,
      state.context.systemVariables['sys.organizationName'] as string,
      state.context.systemVariables['sys.organizationHandle'] as string
    )

    // Initialize system variables to populate sys.* variables in the variables map
    // contextManager.initializeSystemVariables()

    // Restore all workflow variables
    Object.entries(state.context.variables).forEach(([key, value]) => {
      contextManager.setVariable(key, value)
    })

    // Restore node-specific variables
    Object.entries(state.context.nodeVariables).forEach(([nodeId, vars]) => {
      Object.entries(vars).forEach(([key, value]) => {
        contextManager.setNodeVariable(nodeId, key, value)
      })
    })

    // Restore visited nodes
    state.visitedNodes.forEach((nodeId) => {
      contextManager.markNodeVisited(nodeId)
    })

    // Restore logs (preserve order)
    state.context.logs.forEach((log) => {
      contextManager.log(log.level, log.nodeId, log.message, log.data)
    })

    return contextManager
  }
}
