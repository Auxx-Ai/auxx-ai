// packages/lib/src/workflow-engine/core/loop-execution-manager.ts
import type {
  WorkflowNode,
  Workflow,
  NodeExecutionResult,
  WorkflowExecutionOptions,
} from './types'
import type { ExecutionContextManager } from './execution-context'
import { findNodeById, getTargetsFromHandle } from './graph-navigation'
import { NodeRunningStatus } from './types'

/**
 * Callback for executing a single node
 * This breaks the circular dependency between LoopExecutionManager and WorkflowEngine
 */
export type NodeExecutionCallback = (
  node: WorkflowNode,
  contextManager: ExecutionContextManager,
  options: WorkflowExecutionOptions
) => Promise<NodeExecutionResult>

/**
 * Manages loop execution within workflows
 * Handles loop body traversal and node execution
 *
 * ARCHITECTURE:
 * - Receives callback to execute nodes (breaks circular dependency)
 * - Receives workflow and graph as parameters (stateless)
 * - Injects callbacks into loop processor
 * - Executes loop body by traversing graph
 *
 * RESPONSIBILITIES:
 * - Set up loop execution callbacks for processor
 * - Execute loop body nodes for each iteration
 * - Traverse loop body graph until loop-back
 * - Detect cycles within loop iterations
 * - Resolve next nodes considering loop-back edges
 */
export class LoopExecutionManager {
  /**
   * @param executeNodeCallback - Callback to execute individual nodes (from WorkflowEngine)
   */
  constructor(private executeNodeCallback: NodeExecutionCallback) {}

  /**
   * Set up loop execution by injecting callbacks into loop processor
   *
   * This is called by WorkflowEngine when a loop node is encountered.
   * It injects the executeLoopBodyCallback into the processor so the
   * processor can call back to execute the loop body.
   *
   * @param node - Loop node being executed
   * @param processor - Loop node processor instance
   * @param contextManager - Execution context
   * @param options - Execution options
   * @param workflow - Current workflow (for graph access)
   * @returns Promise<NodeExecutionResult> from processor execution
   */
  async setupLoopExecution(
    node: WorkflowNode,
    processor: any,
    contextManager: ExecutionContextManager,
    options: WorkflowExecutionOptions,
    workflow: Workflow
  ): Promise<NodeExecutionResult> {
    const loopProcessor = processor as any

    // Inject loop body execution callback
    loopProcessor.executeLoopBodyCallback = async (
      loopNode: WorkflowNode,
      iterationContext: ExecutionContextManager
    ) => {
      return this.executeLoopBody(loopNode, iterationContext, options, workflow)
    }

    // Inject progress callback if available
    if (options.onNodeComplete) {
      loopProcessor.progressCallback = async (update: any) => {
        const progressResult = {
          nodeId: update.nodeId,
          status: NodeRunningStatus.Running,
          output: update,
          executionTime: 0,
          metadata: {
            type: 'loop_progress',
            iteration: update.progress.currentIteration,
            total: update.progress.totalIterations,
          },
        }
        await options.onNodeComplete!(node.nodeId, progressResult, contextManager.getContext())
      }
    }

    try {
      // Preprocess the loop node (resolve array, validate config)
      const preprocessedData = await processor.preprocessNode(node, contextManager)

      // Execute the loop processor with preprocessed data (which will call our callbacks)
      return await processor.execute(node, contextManager, preprocessedData)
    } finally {
      // Clean up callback references to prevent memory leaks
      delete loopProcessor.executeLoopBodyCallback
      delete loopProcessor.progressCallback
    }
  }

  /**
   * Execute the loop body (nodes inside the loop) for one iteration
   *
   * This is called by the loop processor for each iteration.
   * It finds the loop body entry point and executes all nodes until loop-back.
   *
   * @param loopNode - The loop node
   * @param contextManager - Iteration-specific context (with loop variables set)
   * @param options - Execution options
   * @param workflow - Current workflow (for graph access)
   * @returns Loop body execution result
   */
  private async executeLoopBody(
    loopNode: WorkflowNode,
    contextManager: ExecutionContextManager,
    options: WorkflowExecutionOptions,
    workflow: Workflow
  ): Promise<any> {
    console.log('🔍 LoopExecutionManager.executeLoopBody called', {
      loopNodeId: loopNode.nodeId,
      iteration: contextManager.getContext().executionId,
    })

    if (!workflow.graph?.edges) {
      throw new Error('Workflow graph edges are required for loop execution')
    }

    // Find nodes connected to 'loop-start' handle
    const loopStartTargets = getTargetsFromHandle(
      workflow.graph.edges,
      loopNode.nodeId,
      'loop-start'
    )

    console.log('🔍 Loop start targets found:', {
      startHandle: 'loop-start',
      targetsCount: loopStartTargets.length,
      targets: loopStartTargets,
    })

    const startNodeId = loopStartTargets[0]
    if (!startNodeId) {
      console.warn('⚠️ No loop body nodes found - missing loop-start connections!')
      contextManager.log('WARN', loopNode.name, 'Loop node has no loop-start connection', {
        nodeId: loopNode.nodeId,
      })
      return null
    }

    const startNode = findNodeById(workflow, startNodeId)
    console.log('🔍 Loop body start node:', {
      startNodeId,
      foundNode: !!startNode,
    })

    if (!startNode) {
      console.error('❌ Start node not found in graph:', startNodeId)
      throw new Error(`Loop start node not found: ${startNodeId}`)
    }

    // Execute nodes within the loop body
    console.log('🔍 About to execute loop body nodes...')
    const loopBodyResults = await this.executeLoopBodyNodes(
      workflow,
      startNode,
      contextManager,
      loopNode.nodeId,
      options
    )

    console.log('🔍 Loop body execution completed:', {
      resultsCount: Object.keys(loopBodyResults).length,
      nodeIds: Object.keys(loopBodyResults),
    })

    // Return the last result from the loop body
    const lastNodeId = Object.keys(loopBodyResults).pop()
    return lastNodeId ? loopBodyResults[lastNodeId]?.output : null
  }

  /**
   * Extract error message from various sources in a node execution result or error
   *
   * @param error - Error object or message
   * @param result - Node execution result (if available)
   * @returns Meaningful error message
   */
  private extractErrorMessage(error: unknown, result?: NodeExecutionResult): string {
    // Try to get error from result object first
    if (result?.error) {
      return String(result.error)
    }

    // Check for error in output
    if (result?.output?.error) {
      return String(result.output.error)
    }

    // Extract from Error object
    if (error instanceof Error) {
      return error.message
    }

    // Convert unknown error to string
    if (error) {
      return String(error)
    }

    return 'Unknown error'
  }

  /**
   * Execute all nodes within a loop body until loop-back or exit
   *
   * This traverses the loop body graph, executing each node sequentially
   * until it encounters a loop-back edge or runs out of nodes.
   *
   * @param workflow - Current workflow (for graph access)
   * @param entryNode - First node in loop body
   * @param contextManager - Iteration context
   * @param loopNodeId - ID of the loop node (for loop-back detection)
   * @param options - Execution options
   * @returns Map of node results
   */
  private async executeLoopBodyNodes(
    workflow: Workflow,
    entryNode: WorkflowNode,
    contextManager: ExecutionContextManager,
    loopNodeId: string,
    options: WorkflowExecutionOptions
  ): Promise<Record<string, NodeExecutionResult>> {
    const nodeResults: Record<string, NodeExecutionResult> = {}
    let currentNode: WorkflowNode | null = entryNode
    let iterationCount = 0
    const maxLoopBodyIterations = 100 // Prevent infinite loops within loop body

    // Track visited nodes within this loop iteration to detect cycles
    const loopBodyVisitedNodes = new Set<string>()

    while (currentNode && iterationCount < maxLoopBodyIterations) {
      iterationCount++

      // Check for cycles within loop body
      if (loopBodyVisitedNodes.has(currentNode.nodeId)) {
        contextManager.log('WARN', currentNode.nodeId, 'Cycle detected within loop body')
        break
      }
      loopBodyVisitedNodes.add(currentNode.nodeId)

      // Set current node (but don't mark as visited globally)
      // This allows re-execution in next iteration
      contextManager.setCurrentNode(currentNode.nodeId)

      // Execute the current node via callback
      // Wrap in try-catch to handle both thrown exceptions and Failed results
      let result: NodeExecutionResult
      try {
        result = await this.executeNodeCallback(currentNode, contextManager, options)
      } catch (error) {
        // Convert thrown exception to Failed result
        const errorMessage = this.extractErrorMessage(error)
        result = {
          nodeId: currentNode.nodeId,
          status: NodeRunningStatus.Failed,
          error: errorMessage,
          output: { error: errorMessage },
          executionTime: 0,
        }
      }

      nodeResults[currentNode.nodeId] = result

      // Handle node failure
      if (result.status === NodeRunningStatus.Failed) {
        // Check for error handling using edges
        const errorEdge = workflow.graph?.edges?.find(
          (edge) => edge.source === currentNode!.nodeId && edge.sourceHandle === 'onError'
        )

        if (errorEdge) {
          const errorNode = findNodeById(workflow, errorEdge.target)
          if (errorNode) {
            currentNode = errorNode
            contextManager.log(
              'INFO',
              currentNode.nodeId,
              'Moving to error handler node within loop'
            )
            continue
          }
        }

        // Extract error message with multiple fallbacks
        const errorMessage = this.extractErrorMessage(null, result)
        throw new Error(`Node ${currentNode.nodeId} failed within loop: ${errorMessage}`)
      }

      // Get next node
      const nextNodeId = this.resolveNextNodeForLoop(currentNode, result, loopNodeId, workflow)
      if (!nextNodeId) {
        break
      }

      currentNode = findNodeById(workflow, nextNodeId)
      if (!currentNode) {
        throw new Error(`Next node not found within loop: ${nextNodeId}`)
      }
    }

    if (iterationCount >= maxLoopBodyIterations) {
      throw new Error('Maximum iteration limit reached within loop body')
    }

    return nodeResults
  }

  /**
   * Check if the current node has a loop-back connection to the loop node
   *
   * @param node - Current node in loop body
   * @param loopNodeId - ID of the loop node
   * @param workflow - Current workflow
   * @returns true if node connects back to loop
   */
  private isLoopBackConnection(
    node: WorkflowNode,
    loopNodeId: string,
    workflow: Workflow
  ): boolean {
    if (!workflow.graph?.edges) {
      return false
    }

    return workflow.graph.edges.some(
      (edge) =>
        edge.source === node.nodeId &&
        edge.target === loopNodeId &&
        edge.targetHandle === 'loop-back'
    )
  }

  /**
   * Resolve next node within loop body, considering loop-back edges
   *
   * Returns null if the next node is a loop-back (signals iteration end).
   * Otherwise returns the next node ID to execute.
   *
   * @param node - Current node
   * @param result - Node execution result (for handle routing)
   * @param loopNodeId - ID of the loop node
   * @param workflow - Current workflow
   * @returns Next node ID or null if loop-back
   */
  private resolveNextNodeForLoop(
    node: WorkflowNode,
    result: NodeExecutionResult,
    loopNodeId: string,
    workflow: Workflow
  ): string | null {
    if (!workflow.graph?.edges) {
      return null
    }

    // Get next nodes based on the output handle
    const outputHandle = result.outputHandle || 'source'
    const nextEdges = workflow.graph.edges.filter(
      (edge) => edge.source === node.nodeId && edge.sourceHandle === outputHandle
    )

    // Check if any edge points back to the loop (iteration complete)
    const hasLoopBack = nextEdges.some(
      (edge) => edge.target === loopNodeId && edge.targetHandle === 'loop-back'
    )

    if (hasLoopBack) {
      return null // Break the body execution
    }

    // Return the first non-loop target
    const nextEdge = nextEdges.find(
      (edge) => !(edge.target === loopNodeId && edge.targetHandle === 'loop-back')
    )

    return nextEdge?.target || null
  }
}
