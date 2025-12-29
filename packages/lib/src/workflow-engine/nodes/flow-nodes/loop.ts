// packages/lib/src/workflow-engine/nodes/flow-nodes/loop.ts

import { BaseNodeProcessor } from '../base-node'
import {
  WorkflowNodeType,
  type NodeExecutionResult,
  NodeRunningStatus,
  type WorkflowNode,
  type ValidationResult,
  type PreprocessedNodeData,
} from '../../core/types'
import { ExecutionContextManager } from '../../core/execution-context'
import { LoopContextManager, type LoopExecutionState } from '../../core/loop-context-extensions'
import { createLoopProgressTracker } from '../../core/loop-progress-tracker'
import { LoopMemoryManager, throttle } from '../../core/loop-memory-manager'
import { LoopErrorHandler, createErrorStrategy } from '../../core/loop-error-handler'
import { createScopedLogger } from '@auxx/logger'
import { WorkflowEventType } from '../../shared/types'

const logger = createScopedLogger('loop-processor')

/**
 * Loop node configuration - simplified to match frontend implementation
 */
interface LoopNodeConfig {
  title: string
  description?: string
  itemsSource: string // Array variable path like "{{customers}}"
  maxIterations: number // Safety limit (default: 100, max: 1000)
  accumulateResults: boolean // Collect results from iterations (default: true)
}

/**
 * Processor for loop nodes that iterate over arrays (foreach loops)
 *
 * This processor handles simple array iteration with the following features:
 * - Iterates over arrays from variables (e.g., {{customers}})
 * - Provides {{item}}, {{loop.index}}, and {{loop.count}} variables
 * - Supports result accumulation and iteration limits
 * - Emits LOOP_STARTED, LOOP_NEXT, and LOOP_COMPLETED events
 *
 * @example
 * // Loop configuration
 * {
 *   itemsSource: "{{customers}}",
 *   maxIterations: 100,
 *   accumulateResults: true
 * }
 *
 * // Available loop variables in body:
 * // - {{item}} - current customer object
 * // - {{loop.index}} - 0-based index (0, 1, 2, ...)
 * // - {{loop.count}} - 1-based count (1, 2, 3, ...)
 */
export class LoopProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.LOOP
  private memoryManager = new LoopMemoryManager()
  private errorHandler: LoopErrorHandler | null = null

  /**
   * Preprocess loop node configuration
   *
   * Validates and resolves the array to iterate over, calculating the total
   * number of iterations based on array length and maxIterations limit.
   *
   * @param node - The loop node to preprocess
   * @param contextManager - Execution context for variable resolution
   * @returns Preprocessed data with resolved array and iteration count
   * @throws Error if itemsSource is missing or doesn't resolve to an array
   *
   * @example
   * // Input node.data:
   * { itemsSource: "{{customers}}", maxIterations: 100, accumulateResults: true }
   *
   * // Returns:
   * {
   *   inputs: {
   *     items: [...array values...],
   *     totalIterations: 50, // min(array.length, maxIterations)
   *     itemVariable: 'item',
   *     indexVariable: 'index',
   *     accumulateResults: true
   *   },
   *   requiredVariables: ['customers'],
   *   metadata: { nodeType: 'loop', arrayLength: 50, maxIterations: 100 }
   * }
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as unknown as LoopNodeConfig

    // Validate required fields
    if (!config.itemsSource) {
      throw new Error('Loop node requires an array to iterate over (itemsSource)')
    }

    // Resolve array value
    const arrayValue = await this.resolveVariablePath(config.itemsSource, contextManager)

    if (!Array.isArray(arrayValue)) {
      throw new Error(
        `Expected array but got ${typeof arrayValue} for itemsSource: ${config.itemsSource}`
      )
    }

    // Calculate iterations with safety limit
    const maxIterations = config.maxIterations || 100
    const totalIterations = Math.min(arrayValue.length, maxIterations)

    return {
      inputs: {
        items: arrayValue,
        totalIterations,
        itemVariable: 'item', // Hardcoded per frontend
        indexVariable: 'index', // Hardcoded per frontend
        accumulateResults: config.accumulateResults ?? true,
      },
      metadata: {
        nodeType: 'loop',
        arrayLength: arrayValue.length,
        maxIterations,
      },
    }
  }

  /**
   * Execute the loop node
   *
   * Initializes the loop state, registers it in the context manager, executes
   * all iterations, and returns the final results.
   *
   * For each iteration:
   * - Sets {{item}} to the current array element
   * - Sets {{loop.index}} to the 0-based index
   * - Sets {{loop.count}} to the 1-based count
   * - Executes the loop body nodes
   * - Optionally accumulates results
   *
   * @param node - The loop node to execute
   * @param contextManager - Execution context
   * @param preprocessedData - Preprocessed configuration from preprocessNode
   * @returns Execution result with iteration counts and optional results array
   *
   * @example
   * // Output:
   * {
   *   status: 'succeeded',
   *   output: {
   *     totalIterations: 100,
   *     completedIterations: 100,
   *     results: [...] // if accumulateResults is true
   *   },
   *   outputHandle: 'source'
   * }
   */
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const inputs = preprocessedData!.inputs

    // Initialize error handler with default strategy
    this.errorHandler = new LoopErrorHandler(createErrorStrategy({}))

    // Initialize loop state
    const loopState: LoopExecutionState = {
      loopNodeId: node.nodeId,
      currentIteration: 0,
      totalIterations: inputs.totalIterations,
      items: inputs.items,
      iteratorName: 'item',
      results: [],
      startTime: Date.now(),
      breakRequested: false,
    }

    this.registerLoopState(contextManager, loopState)

    // Execute iterations
    const results = await this.executeLoopIterations(
      node,
      inputs as {
        items: any[]
        totalIterations: number
        itemVariable: string
        indexVariable: string
        accumulateResults: boolean
      },
      loopState,
      contextManager
    )

    this.unregisterLoopState(contextManager, node.nodeId)

    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        totalIterations: loopState.totalIterations,
        completedIterations: loopState.currentIteration,
        ...(inputs.accumulateResults && { results }),
      },
      outputHandle: 'source',
    }
  }

  /**
   * Extract variables from loop array source
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as LoopNodeConfig

    if (config.itemsSource && typeof config.itemsSource === 'string') {
      return this.extractVariableIds(config.itemsSource)
    }

    return []
  }

  /**
   * Validate loop node configuration
   */
  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as LoopNodeConfig

    // Required fields
    if (!config.itemsSource) {
      errors.push('Items source is required')
    }

    // Validate max iterations
    if (!config.maxIterations || config.maxIterations <= 0) {
      errors.push('Max iterations must be greater than 0')
    } else if (config.maxIterations > 1000) {
      warnings.push('Max iterations exceeds recommended limit of 1000')
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Register loop state in context manager
   */
  private registerLoopState(
    contextManager: ExecutionContextManager,
    loopState: LoopExecutionState
  ): void {
    LoopContextManager.registerActiveLoop(contextManager, loopState)
    contextManager.log('DEBUG', loopState.loopNodeId, 'Registered loop state', {
      totalIterations: loopState.totalIterations,
    })
  }

  /**
   * Unregister loop state from context manager
   */
  private unregisterLoopState(contextManager: ExecutionContextManager, loopNodeId: string): void {
    LoopContextManager.unregisterActiveLoop(contextManager, loopNodeId)
    contextManager.log('DEBUG', loopNodeId, 'Unregistered loop state')
  }

  /**
   * Execute the loop body (nodes inside the loop)
   */
  private async executeLoopBody(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    loopState: LoopExecutionState
  ): Promise<any> {
    console.log('🔍 LoopProcessor.executeLoopBody called', {
      nodeId: node.nodeId,
      iteration: loopState.currentIteration,
      hasCallback: !!(this as any).executeLoopBodyCallback,
    })

    contextManager.log(
      'DEBUG',
      node.name,
      `Executing loop body for iteration ${loopState.currentIteration}`
    )

    // Use the callback provided by WorkflowEngine
    const processor = this as any
    if (processor.executeLoopBodyCallback) {
      console.log('🔍 Calling executeLoopBodyCallback...')
      const result = await processor.executeLoopBodyCallback(node, contextManager)
      console.log('🔍 executeLoopBodyCallback returned:', { hasResult: !!result })
      return result
    }

    console.warn('⚠️ No executeLoopBodyCallback - using fallback!')
    // Fallback if no callback provided
    return {
      iteration: loopState.currentIteration,
      item: loopState.items[loopState.currentIteration],
    }
  }

  /**
   * Execute loop iterations with event emission and progress tracking
   *
   * This method handles the core iteration logic:
   * - Emits LOOP_STARTED event before first iteration
   * - For each iteration: updates variables, emits LOOP_NEXT, executes body
   * - Handles errors with retry logic
   * - Manages memory throttling and performance limits
   * - Emits LOOP_COMPLETED event after all iterations
   *
   * @param node - The loop node being executed
   * @param inputs - Preprocessed loop inputs (items, totalIterations, etc.)
   * @param loopState - Current loop execution state
   * @param contextManager - Execution context manager
   * @returns Array of results from each iteration (if accumulating)
   */
  private async executeLoopIterations(
    node: WorkflowNode,
    inputs: {
      items: any[]
      totalIterations: number
      itemVariable: string
      indexVariable: string
      accumulateResults: boolean
    },
    loopState: LoopExecutionState,
    contextManager: ExecutionContextManager
  ): Promise<any[]> {
    const results: any[] = []
    const options = contextManager.getOptions()

    // Record baseline memory before loop execution starts
    this.memoryManager.recordBaseline()

    // Debug logging
    logger.debug('Loop iteration options', {
      hasReporter: !!options?.reporter,
      workflowRunId: options?.workflowRunId,
      nodeId: node.nodeId,
    })

    // Emit LOOP_STARTED event (fixed from LOOP_NEXT)
    if (options?.reporter && options?.workflowRunId) {
      logger.debug('Emitting LOOP_STARTED event', {
        nodeId: node.nodeId,
        iterationCount: loopState.totalIterations,
      })
      await options.reporter.emit(WorkflowEventType.LOOP_STARTED, {
        loopId: node.nodeId,
        nodeId: node.nodeId,
        iterationCount: loopState.totalIterations,
        items: inputs.items,
      })
    } else {
      logger.warn('Cannot emit LOOP_STARTED - missing reporter or workflowRunId', {
        hasReporter: !!options?.reporter,
        workflowRunId: options?.workflowRunId,
      })
    }

    // Create progress tracker if available
    const processor = this as any
    const progressTracker = processor.progressCallback
      ? createLoopProgressTracker(contextManager, node.nodeId, processor.progressCallback)
      : null

    for (let i = 0; i < loopState.totalIterations; i++) {
      loopState.currentIteration = i

      // Check performance limits
      const terminationCheck = this.memoryManager.shouldTerminateLoop(loopState)
      if (terminationCheck.terminate) {
        contextManager.log('ERROR', node.name, `Loop terminated: ${terminationCheck.reason}`)
        throw new Error(terminationCheck.reason)
      }

      // Check if break was requested externally
      if (LoopContextManager.isBreakRequested(contextManager, node.nodeId)) {
        contextManager.log('INFO', node.name, `External break requested at iteration ${i}`)
        break
      }

      // Memory throttling
      if (i > 0 && i % 10 === 0 && this.memoryManager.shouldThrottle(loopState)) {
        const delay = this.memoryManager.getThrottleDelay(loopState)
        await throttle(delay)
        await this.memoryManager.tryGarbageCollection()
      }

      // Update loop iteration in context
      LoopContextManager.updateLoopIteration(contextManager, node.nodeId, i)

      // Set up iteration variables
      const currentItem = inputs.items[i]
      contextManager.setVariable(inputs.itemVariable, currentItem)
      contextManager.setVariable(inputs.indexVariable, i)

      // Emit LOOP_NEXT event (iteration starting)
      if (options?.reporter && options?.workflowRunId) {
        await options.reporter.emit(WorkflowEventType.LOOP_NEXT, {
          loopId: node.nodeId,
          loopNodeId: node.nodeId,
          iterationIndex: i,
          totalIterations: loopState.totalIterations,
          item: currentItem,
          variables: {
            index: i,
            item: currentItem,
          },
        })
      }

      const iterationStartTime = Date.now()

      try {
        // Execute loop body
        const iterationResult = await this.executeLoopBody(node, contextManager, loopState)

        if (inputs.accumulateResults) {
          results.push(iterationResult)
          loopState.results = results
        }

        // Reset consecutive error counter on success
        if (this.errorHandler) {
          this.errorHandler.resetConsecutiveErrors()
        }

        // Record iteration duration
        const iterationDuration = Date.now() - iterationStartTime
        LoopContextManager.recordLoopIteration(contextManager, node.nodeId, i, iterationDuration)

        // Send progress update
        if (progressTracker) {
          await progressTracker.updateProgress(
            i,
            loopState.totalIterations,
            iterationDuration,
            loopState.items[i],
            'running'
          )
        }
      } catch (error) {
        // Handle error
        const errorResult = await this.errorHandler!.handleIterationError(
          i,
          error instanceof Error ? error : new Error(String(error)),
          async () => {
            return await this.executeLoopBody(node, contextManager, loopState)
          }
        )

        if (errorResult.success) {
          if (inputs.accumulateResults) {
            results.push(errorResult.result)
            loopState.results = results
          }
        } else {
          contextManager.log(
            'ERROR',
            node.name,
            `Iteration ${i} failed: ${errorResult.error?.message}`
          )

          if (inputs.accumulateResults) {
            results.push({ error: errorResult.error?.message || 'Unknown error', iteration: i })
          }

          if (progressTracker) {
            await progressTracker.updateProgress(
              i,
              loopState.totalIterations,
              Date.now() - iterationStartTime,
              loopState.items[i],
              'failed'
            )
          }
        }
      }
    }

    // Send completion update
    if (progressTracker) {
      await progressTracker.completeProgress(
        loopState.totalIterations,
        loopState.breakRequested ? 'stopped' : 'completed'
      )
    }

    // Emit LOOP_COMPLETED event
    if (options?.reporter && options?.workflowRunId) {
      await options.reporter.emit(WorkflowEventType.LOOP_COMPLETED, {
        loopId: node.nodeId,
        nodeId: node.nodeId,
        totalIterations: loopState.currentIteration + (loopState.breakRequested ? 0 : 1),
        outputs: { results },
      })
    }

    return results
  }
}
