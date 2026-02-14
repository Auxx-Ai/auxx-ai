// packages/lib/src/workflow-engine/core/loop-context-extensions.ts

import { createScopedLogger } from '@auxx/logger'
import type { ExecutionContextManager } from './execution-context'

const logger = createScopedLogger('loop-context')

/**
 * Loop execution state that tracks current iteration
 */
export interface LoopExecutionState {
  loopNodeId: string
  currentIteration: number
  totalIterations: number
  items: any[]
  iteratorName?: string // @deprecated - always 'item' now
  depth?: number // Nesting depth: 1 for top-level, 2 for nested, etc.
  results: any[]
  startTime: number
  breakRequested: boolean
}

/**
 * Interface for loop context extensions
 */
interface LoopContextExtensions {
  activeLoops: Map<string, LoopExecutionState>
  loopIterationHistory: Array<{
    loopNodeId: string
    iteration: number
    timestamp: Date
    duration: number
  }>
  loopScopes: Map<string, Map<string, any>>
}

/**
 * Extends ExecutionContextManager with loop-specific functionality
 */
export class LoopContextManager {
  private static loopExtensions = new WeakMap<ExecutionContextManager, LoopContextExtensions>()

  /**
   * Initialize loop extensions for a context manager
   */
  static initializeLoopExtensions(contextManager: ExecutionContextManager): void {
    if (!LoopContextManager.loopExtensions.has(contextManager)) {
      LoopContextManager.loopExtensions.set(contextManager, {
        activeLoops: new Map(),
        loopIterationHistory: [],
        loopScopes: new Map(),
      })
    }
  }

  /**
   * Register an active loop
   */
  static registerActiveLoop(
    contextManager: ExecutionContextManager,
    loopState: LoopExecutionState
  ): void {
    LoopContextManager.initializeLoopExtensions(contextManager)
    const extensions = LoopContextManager.loopExtensions.get(contextManager)!

    // Check for nested loops
    if (extensions.activeLoops.size > 0) {
      const parentLoops = Array.from(extensions.activeLoops.keys())
      contextManager.log(
        'WARN',
        loopState.loopNodeId,
        `Nested loop detected. Parent loops: ${parentLoops.join(', ')}`
      )
    }

    extensions.activeLoops.set(loopState.loopNodeId, loopState)
    LoopContextManager.createLoopScope(contextManager, loopState.loopNodeId)
  }

  /**
   * Unregister an active loop
   */
  static unregisterActiveLoop(contextManager: ExecutionContextManager, loopNodeId: string): void {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    if (extensions) {
      extensions.activeLoops.delete(loopNodeId)
      extensions.loopScopes.delete(loopNodeId)
    }
  }

  /**
   * Update loop iteration
   */
  static updateLoopIteration(
    contextManager: ExecutionContextManager,
    loopNodeId: string,
    iteration: number
  ): void {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    if (!extensions) return

    const loopState = extensions.activeLoops.get(loopNodeId)
    if (loopState) {
      loopState.currentIteration = iteration
      LoopContextManager.injectLoopVariables(contextManager, loopState)
    }
  }

  /**
   * Create loop-scoped variables
   */
  private static createLoopScope(
    contextManager: ExecutionContextManager,
    loopNodeId: string
  ): void {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    if (extensions) {
      extensions.loopScopes.set(loopNodeId, new Map())
    }
  }

  /**
   * Set variable in loop scope
   */
  static setLoopVariable(
    contextManager: ExecutionContextManager,
    loopNodeId: string,
    key: string,
    value: any
  ): void {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    if (!extensions) return

    const scope = extensions.loopScopes.get(loopNodeId)
    if (scope) {
      scope.set(key, value)
    }
  }

  /**
   * Get variable with loop scope resolution
   */
  static getVariableWithLoopScope(contextManager: ExecutionContextManager, key: string): any {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    if (!extensions) return contextManager.getVariable(key)

    // Check loop scopes from innermost to outermost
    const activeLoopIds = Array.from(extensions.activeLoops.keys()).reverse()

    for (const loopId of activeLoopIds) {
      const scope = extensions.loopScopes.get(loopId)
      if (scope?.has(key)) {
        return scope.get(key)
      }
    }

    // Fall back to regular variable resolution
    return contextManager.getVariable(key)
  }

  /**
   * Inject loop variables into context
   */
  private static injectLoopVariables(
    contextManager: ExecutionContextManager,
    loopState: LoopExecutionState
  ): void {
    const { loopNodeId, currentIteration, totalIterations, items } = loopState

    // Use setNodeVariable for automatic node-scoping
    // This creates flat variables like: loop-abc-123.index, loop-abc-123.item
    contextManager.setNodeVariable(loopNodeId, 'index', currentIteration)
    contextManager.setNodeVariable(loopNodeId, 'count', currentIteration + 1)
    contextManager.setNodeVariable(loopNodeId, 'total', totalIterations)
    contextManager.setNodeVariable(loopNodeId, 'isFirst', currentIteration === 0)
    contextManager.setNodeVariable(loopNodeId, 'isLast', currentIteration === totalIterations - 1)

    // Set current item if available
    if (items[currentIteration] !== undefined) {
      contextManager.setNodeVariable(loopNodeId, 'item', items[currentIteration])
    }

    // Set accumulated results if available
    if (loopState.results.length > 0) {
      contextManager.setNodeVariable(loopNodeId, 'results', [...loopState.results])
    }
  }

  /**
   * Track loop iteration for performance monitoring
   */
  static recordLoopIteration(
    contextManager: ExecutionContextManager,
    loopNodeId: string,
    iteration: number,
    duration: number
  ): void {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    if (!extensions) return

    extensions.loopIterationHistory.push({
      loopNodeId,
      iteration,
      timestamp: new Date(),
      duration,
    })

    // Trim history if too large (keep last 1000 entries)
    if (extensions.loopIterationHistory.length > 1000) {
      extensions.loopIterationHistory = extensions.loopIterationHistory.slice(-1000)
    }
  }

  /**
   * Get active loop states
   */
  static getActiveLoops(contextManager: ExecutionContextManager): Map<string, LoopExecutionState> {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    return extensions?.activeLoops || new Map()
  }

  /**
   * Check if a loop is active
   */
  static isLoopActive(contextManager: ExecutionContextManager, loopNodeId: string): boolean {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    return extensions?.activeLoops.has(loopNodeId) || false
  }

  /**
   * Get loop iteration history
   */
  static getLoopIterationHistory(
    contextManager: ExecutionContextManager
  ): Array<{ loopNodeId: string; iteration: number; timestamp: Date; duration: number }> {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    return extensions?.loopIterationHistory || []
  }

  /**
   * Request loop break
   */
  static requestLoopBreak(contextManager: ExecutionContextManager, loopNodeId: string): void {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    if (!extensions) return

    const loopState = extensions.activeLoops.get(loopNodeId)
    if (loopState) {
      loopState.breakRequested = true
      contextManager.log('INFO', loopNodeId, 'Loop break requested')
    }
  }

  /**
   * Check if loop break is requested
   */
  static isBreakRequested(contextManager: ExecutionContextManager, loopNodeId: string): boolean {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    if (!extensions) return false

    const loopState = extensions.activeLoops.get(loopNodeId)
    return loopState?.breakRequested || false
  }

  /**
   * Get current loop depth (for nested loops)
   */
  static getCurrentLoopDepth(contextManager: ExecutionContextManager): number {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    return extensions?.activeLoops.size || 0
  }

  /**
   * Get parent loop ID (for nested loops)
   */
  static getParentLoopId(
    contextManager: ExecutionContextManager,
    currentLoopId: string
  ): string | null {
    const extensions = LoopContextManager.loopExtensions.get(contextManager)
    if (!extensions) return null

    const loopIds = Array.from(extensions.activeLoops.keys())
    const currentIndex = loopIds.indexOf(currentLoopId)

    if (currentIndex > 0) {
      return loopIds[currentIndex - 1]
    }

    return null
  }
}
