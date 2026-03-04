// packages/lib/src/workflow-engine/core/workflow-engine.ts
import { database as db, schema } from '@auxx/database'
import { NodeTriggerSource } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { WorkflowExecutionReporter } from '../execution-reporter'
import { WorkflowEventType } from '../shared/types'
import { BatchedJoinStateUpdater } from './batched-join-updater'
import { BranchMerger } from './branch-merger'
import { CancellationManager } from './cancellation-manager'
import {
  handleNodeError as handleNodeErrorUtil,
  handlePreprocessingError as handlePreprocessingErrorUtil,
} from './error-handlers'
import {
  WorkflowNodeError,
  WorkflowNodeExecutionError,
  WorkflowNodeProcessingError,
} from './errors'
import { ExecutionContextManager } from './execution-context'
import { ExecutionTrackingManager } from './execution-tracking'
import { calculateTotalTokens } from './execution-utils'
import { findEntryNode, findNodeById, getNextNodeIds } from './graph-navigation'
import {
  type BranchArrivalStatus,
  JoinExecutionManager,
  type JoinWaitOptions,
} from './join-execution-manager'
import { JoinStateCache } from './join-state-cache'
import { LoopContextManager } from './loop-context-extensions'
import { LoopExecutionManager } from './loop-execution-manager'
import { NodeProcessorRegistry } from './node-processor-registry'
import { determineNextNodesForResume, shouldPauseBeTerminal } from './pause-resume'
import { StatePersistenceManager } from './state-persistence-manager'
import type {
  BranchConvergenceResult,
  BranchResult,
  ExecutionState,
  JoinPointInfo,
  NodeExecutionResult,
  PauseReason,
  ResumeOptions,
  ValidationResult,
  Workflow,
  WorkflowExecutionOptions,
  WorkflowExecutionResult,
  WorkflowNode,
  WorkflowTriggerEvent,
} from './types'
import {
  JoinState, // V5: Import as value to call static fromJSON() method
  NodeRunningStatus,
  WorkflowExecutionStatus,
  WorkflowNodeType,
  WorkflowPausedException,
} from './types'
import { validateWorkflow } from './validation'
import { type WorkflowGraph, WorkflowGraphBuilder } from './workflow-graph-builder'
import { workflowMetrics } from './workflow-metrics'

const logger = createScopedLogger('workflow-engine')
/**
 * Main workflow execution engine
 */
export class WorkflowEngine {
  private nodeRegistry: NodeProcessorRegistry
  private currentWorkflow: Workflow | null = null
  private currentGraph: WorkflowGraph | null = null
  private cancellationManager = new CancellationManager()
  private trackingManager = new ExecutionTrackingManager()
  private persistenceManager = new StatePersistenceManager()
  private graphCache = new Map<string, WorkflowGraph>()
  private currentNodeResults: Record<string, NodeExecutionResult> = {}
  private joinExecutionManager: JoinExecutionManager
  private batchedJoinUpdater: BatchedJoinStateUpdater
  private joinStateCache: JoinStateCache
  private branchMerger: BranchMerger
  private loopExecutionManager: LoopExecutionManager

  constructor() {
    this.nodeRegistry = new NodeProcessorRegistry()
    // Initialize graph builder with registry
    WorkflowGraphBuilder.initialize(this.nodeRegistry)
    // Initialize join execution infrastructure
    this.batchedJoinUpdater = new BatchedJoinStateUpdater()
    this.joinStateCache = new JoinStateCache()
    this.joinExecutionManager = new JoinExecutionManager(
      this.batchedJoinUpdater,
      this.joinStateCache
    )
    this.branchMerger = new BranchMerger()
    // Initialize loop execution manager with callback to executeNodeInternal
    this.loopExecutionManager = new LoopExecutionManager((node, contextManager, options) =>
      this.executeNodeInternal(node, contextManager, options)
    )
  }
  /**
   * Reset execution tracking for a new workflow run
   */
  private resetExecutionTracking() {
    this.trackingManager.reset()
  }

  /**
   * Execute a workflow with the given trigger event
   *
   * ARCHITECTURE OVERVIEW:
   * This is the main entry point for workflow execution. It orchestrates the entire process
   * from initialization to completion/pause/failure. Key responsibilities:
   *
   * 1. SETUP PHASE:
   *    - Builds/caches workflow graph for navigation
   *    - Creates execution context with variables, system state
   *    - Initializes database execution record
   *
   * 2. EXECUTION PHASE:
   *    - Delegates to executeWorkflowNodes() for actual execution
   *    - Handles WorkflowPausedException (critical pause handling point)
   *    - This is where pause exceptions bubble up from nested execution
   *
   * 3. COMPLETION PHASE:
   *    - Updates database with results
   *    - Emits completion/failure events
   *    - Cleans up resources
   *
   * PAUSE/RESUME IMPLICATIONS:
   * - WorkflowPausedException handling happens here but does NOT persist state to database
   * - Caller (executeWorkflowAsync) is responsible for determining pause scope and DB updates
   * - Re-throws pause exception to caller without context about parallel branch state
   * - No awareness of whether pause is branch-level or workflow-level
   */
  async executeWorkflow(
    workflow: any, // Accept raw database format
    triggerEvent: WorkflowTriggerEvent,
    options: WorkflowExecutionOptions = {}
  ): Promise<WorkflowExecutionResult> {
    const executionId = this.generateExecutionId()
    // Reset execution tracking for new workflow run
    this.resetExecutionTracking()
    // Build graph - handles ALL transformation
    let graph = this.graphCache.get(workflow.id)
    if (!graph || options.skipCache) {
      graph = WorkflowGraphBuilder.buildGraph(workflow)
      this.graphCache.set(workflow.id, graph)
    }
    // Get transformed workflow from builder
    this.currentWorkflow = WorkflowGraphBuilder.getTransformedWorkflow()!
    this.currentGraph = graph
    logger.info('Starting workflow execution', {
      workflowId: workflow.id,
      executionId,
      triggerType: triggerEvent.type,
      organizationId: workflow.organizationId,
    })
    // Emit workflow-started event if reporter is provided
    if (options.reporter && options.workflowRunId) {
      await options.reporter.emit(WorkflowEventType.WORKFLOW_STARTED, {
        workflowId: workflow.id,
        workflowRunId: options.workflowRunId,
        trigger: triggerEvent,
        inputs: triggerEvent.data,
      })
    }
    // Create execution context
    const contextManager = new ExecutionContextManager(
      workflow.id,
      executionId,
      workflow.organizationId,
      triggerEvent.userId,
      triggerEvent.userEmail,
      triggerEvent.userName,
      triggerEvent.organizationName,
      triggerEvent.organizationHandle,
      db
    )
    contextManager.initializeWithTrigger(triggerEvent)
    // Set execution options
    contextManager.setOptions(options)
    if (options.debug) {
      contextManager.setDebugMode(true)
    }
    // Initialize system variables
    contextManager.initializeSystemVariables()
    // Set workflow context for AI nodes
    contextManager.setVariable('sys.workflow', this.currentWorkflow)
    // Initialize environment variables from workflow
    if (workflow.envVars) {
      contextManager.initializeEnvironmentVariables(workflow.envVars as any[])
    }
    // Resource triggers handle their own variable initialization via setResourceVariables()
    // This creates the correct node-scoped variables: nodeId.resource.field
    if (options.variables) {
      contextManager.setVariables(options.variables)
    }
    const startTime = Date.now()
    // Start metrics collection
    workflowMetrics.startExecution(workflow.id, executionId)
    try {
      // Validate workflow graph
      if (!options.skipValidation && graph.hasCycles) {
        throw new Error(`Workflow contains cycles: ${graph.cycleEdges.join(', ')}`)
      }
      // Find entry point from workflow
      const entryNode = findEntryNode(this.currentWorkflow)
      if (!entryNode) {
        throw new Error('No entry point found in workflow')
      }

      // Initialize node results tracking
      this.currentNodeResults = {}
      let nodeResults: Record<string, NodeExecutionResult> = {}
      // Execute workflow starting from entry point
      try {
        nodeResults = await this.executeWorkflowNodes(
          this.currentWorkflow,
          entryNode,
          contextManager,
          options,
          graph // Pass the graph to ensure it's available throughout execution
        )
        this.currentNodeResults = nodeResults
      } catch (error) {
        if (error instanceof WorkflowPausedException) {
          // Workflow was paused, return the pause state
          logger.info('Workflow execution paused', {
            workflowId: workflow.id,
            executionId,
            pausedAt: error.state.currentNodeId,
          })
          // Don't update execution record - let the service handle it
          throw error
        }
        throw error
      }
      const totalExecutionTime = Date.now() - startTime
      // Calculate total tokens used across all nodes
      const totalTokensUsed = calculateTotalTokens(nodeResults)
      // End metrics collection
      workflowMetrics.endExecution(executionId)
      logger.info('Workflow execution completed successfully', {
        workflowId: workflow.id,
        executionId,
        totalExecutionTime,
        nodesExecuted: Object.keys(nodeResults).length,
      })
      // Emit workflow-finished event if reporter is provided
      if (options.reporter && options.workflowRunId) {
        await options.reporter.emit(WorkflowEventType.WORKFLOW_FINISHED, {
          id: options.workflowRunId,
          workflowId: workflow.id,
          status: 'succeeded' as const,
          outputs: contextManager.getContext().variables,
          elapsedTime: totalExecutionTime / 1000, // Convert to seconds
          totalTokens: totalTokensUsed,
          totalSteps: Object.keys(nodeResults).length,
          createdAt: Math.floor(startTime / 1000), // Convert to seconds
          finishedAt: Math.floor(Date.now() / 1000), // Convert to seconds
        })
      }
      return {
        executionId,
        workflowId: workflow.id,
        status: WorkflowExecutionStatus.COMPLETED,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        totalExecutionTime,
        nodeResults: this.currentNodeResults,
        context: contextManager.getContext(),
      }
    } catch (error) {
      // Handle workflow pause exception correctly - don't treat as failure
      if (error instanceof WorkflowPausedException) {
        // Re-throw the pause exception to let the service handle it
        throw error
      }
      const totalExecutionTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Workflow execution failed', {
        workflowId: workflow.id,
        executionId,
        error: errorMessage,
        totalExecutionTime,
      })
      // Emit workflow-failed event if reporter is provided
      // This is the single place where WORKFLOW_FAILED is emitted for the entire workflow
      if (options.reporter && options.workflowRunId) {
        await options.reporter.emit(WorkflowEventType.WORKFLOW_FAILED, {
          workflowId: workflow.id,
          workflowRunId: options.workflowRunId,
          error: errorMessage,
          failedAt: new Date(),
        })
      }
      return {
        executionId,
        workflowId: workflow.id,
        status: WorkflowExecutionStatus.FAILED,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        totalExecutionTime,
        nodeResults: {},
        error: errorMessage,
        context: contextManager.getContext(),
      }
    } finally {
      // Clean up cancelled execution tracking
      this.cancellationManager.cleanup(executionId, options.workflowRunId)
      // Reset current graph
      this.currentGraph = null
    }
  }
  /**
   * Execute workflow nodes starting from the given entry point
   *
   * ARCHITECTURE OVERVIEW:
   * This is the main execution loop that handles sequential node execution with support
   * for parallel branches and join points. It's the heart of the workflow engine.
   *
   * KEY EXECUTION PATTERNS:
   *
   * 1. SEQUENTIAL EXECUTION:
   *    - Main while loop processes nodes one by one
   *    - Handles cancellation, timeouts, cycle detection
   *    - Moves to next node based on output handles
   *
   * 2. JOIN POINT HANDLING:
   *    - Detects when current node is a join point
   *    - Checks if all expected branches have arrived
   *    - If not all arrived: registers continuation callback and exits loop
   *    - If all arrived: executes join node and continues
   *
   * 3. FORK POINT HANDLING:
   *    - Detects when next nodes > 1 (parallel execution needed)
   *    - Fork WITH join: launches executeParallelBranches() and stops main execution
   *    - Fork WITHOUT join: uses legacy executeParallelNodes() and waits for all
   *
   * PAUSE/RESUME IMPLICATIONS:
   * - If ANY node in sequential execution pauses, entire loop stops via WorkflowPausedException
   * - Join nodes waiting for branches don't pause - they register callbacks and exit cleanly
   * - Fork points launch parallel branches then main execution stops (by design)
   * - No mechanism to pause just one sequential node while others continue
   * - Resume would restart this entire method from the resume point
   */
  private async executeWorkflowNodes(
    workflow: Workflow,
    entryNode: WorkflowNode,
    contextManager: ExecutionContextManager,
    options: WorkflowExecutionOptions,
    graph?: WorkflowGraph
  ): Promise<Record<string, NodeExecutionResult>> {
    const nodeResults: Record<string, NodeExecutionResult> = {}
    let currentNode: WorkflowNode | null = entryNode
    let iterationCount = 0
    const maxIterations = 1000 // Prevent infinite loops
    // Use provided graph or get from cache
    const workflowGraph = graph || this.graphCache.get(workflow.id)
    if (!workflowGraph) {
      throw new Error('Workflow graph not found')
    }
    while (currentNode && iterationCount < maxIterations) {
      iterationCount++
      // Check for cancellation
      if (
        this.cancellationManager.isCancelled(
          contextManager.getContext().executionId,
          options.workflowRunId
        )
      ) {
        logger.info('Workflow execution cancelled by user', {
          executionId: contextManager.getContext().executionId,
          workflowRunId: options.workflowRunId,
          nodeId: currentNode.nodeId,
        })
        throw new Error('Workflow execution cancelled by user')
      }
      // Check for timeout
      if (options.timeout && contextManager.getExecutionDuration() > options.timeout) {
        throw new Error(`Workflow execution timeout after ${options.timeout}ms`)
      }
      // Check if we've already visited this node (cycle detection)
      // Skip cycle detection for loop nodes as they need to be revisited
      if (
        currentNode.type !== WorkflowNodeType.LOOP &&
        contextManager.hasVisitedNode(currentNode.nodeId)
      ) {
        contextManager.log('WARN', currentNode.name, 'Cycle detected, stopping execution')
        break
      }
      contextManager.setCurrentNode(currentNode.nodeId)
      // Check if this is a join node waiting for branches
      const graph = this.graphCache.get(workflow.id)
      const joinInfo = graph?.joinPoints.get(currentNode.nodeId)
      // Skip join handling for entry nodes (triggers) - they should never be treated as join points
      // even if they have multiple incoming edges (e.g., form-input data connections)
      const isEntryNode = graph?.entryNodes.includes(currentNode.nodeId) ?? false
      if (joinInfo && iterationCount > 0 && !isEntryNode) {
        // Check for cancellation at join points
        if (
          this.cancellationManager.isCancelled(
            contextManager.getContext().executionId,
            options.workflowRunId
          )
        ) {
          logger.info('Workflow execution cancelled at join point', {
            nodeId: currentNode.nodeId,
            workflowRunId: options.workflowRunId,
          })
          throw new Error('Workflow execution cancelled by user')
        }
        // Not on first iteration (entry point)
        // This is a join node - check if all branches have arrived
        const joinState = await contextManager.getJoinState(currentNode.nodeId)
        if (!joinState) {
          // Join state not initialized - check if this is a branch context
          const executionId = contextManager.getContext().executionId
          const isBranchContext = executionId.includes('-branch-')

          if (isBranchContext) {
            // Branch reached join point - stop execution here
            // Main context will handle the join after all branches arrive
            // Return current results - branch stops before join node
            return nodeResults
          } else {
            // Main context missing join state - this is a serious error
            throw new Error(
              `Join state not initialized for ${currentNode.nodeId}. ` +
                `This indicates a bug in join state initialization.`
            )
          }
        } else {
          // Check if all branches have converged
          const allBranchesArrived =
            joinState.expectedInputs.size === joinState.completedInputs.size
          if (!allBranchesArrived) {
            // Not all branches have arrived - we need to wait
            // Register continuation callback for when join is ready
            const config = currentNode.data || {}
            await this.joinExecutionManager.registerContinuation(
              contextManager.getContext().executionId,
              currentNode.nodeId,
              joinState,
              async () => this.continueFromJoin(workflow, currentNode!, contextManager, options),
              {
                timeout: config.timeout,
                minRequired: config.requiredCount,
                waitStrategy: config.joinType || 'all',
                errorStrategy: config.errorHandling?.continueOnError ? 'best-effort' : 'fail-fast',
              }
            )
            // Return waiting result instead of breaking
            const waitResult = await this.joinExecutionManager.waitForBranches(joinState, {
              timeout: config.timeout,
              minRequired: config.requiredCount,
              waitStrategy: config.joinType || 'all',
              errorStrategy: config.errorHandling?.continueOnError ? 'best-effort' : 'fail-fast',
            })
            const waitingResult = this.joinExecutionManager.createWaitingResult(
              currentNode.nodeId,
              waitResult
            )
            nodeResults[currentNode.nodeId] = waitingResult
            this.currentNodeResults[currentNode.nodeId] = waitingResult
            // Exit the loop - execution will continue via callback
            return nodeResults
          }
          // All branches have converged! Merge branches BEFORE executing node
          await this.handleJoinPoint(currentNode, joinState, contextManager)

          // Don't continue! Let the node execute normally with merged context
          // The merged variables are now available in contextManager
          // Fall through to normal node execution...
        }
      }
      // Execute the current node
      const result = await this.executeNodeInternal(currentNode, contextManager, options)
      nodeResults[currentNode.nodeId] = result
      // Update global tracking
      this.currentNodeResults[currentNode.nodeId] = result
      // Determine next node based on result
      if (result.status === NodeRunningStatus.Skipped) {
        contextManager.log('INFO', currentNode.name, 'Node skipped, stopping execution branch', {
          nodeId: currentNode.nodeId,
          output: result.output,
        })
        break
      }
      if (result.status === NodeRunningStatus.Failed) {
        // Check for error handling using edges
        const errorEdge = workflow.graph?.edges?.find(
          (edge) => edge.source === currentNode!.nodeId && edge.sourceHandle === 'onError'
        )
        if (errorEdge) {
          const errorNode = findNodeById(workflow, errorEdge.target)
          if (errorNode) {
            currentNode = errorNode
            contextManager.log('INFO', currentNode.name, 'Moving to error handler node')
            continue
          }
        }
        throw new Error(`Node ${currentNode.name} failed: ${result.error}`)
      }
      let nextNodeIds = getNextNodeIds(currentNode, result, workflowGraph)
      // Check if the node provided explicit next node routing (e.g., from join error handling or test mode)
      if (result.metadata?.nextNodeId || result.nextNodeId) {
        const explicitNextNodeId = result.metadata?.nextNodeId || result.nextNodeId
        nextNodeIds = [explicitNextNodeId]
        contextManager.log('DEBUG', currentNode.name, 'Using explicit next node routing', {
          nextNodeId: explicitNextNodeId,
        })
      }
      if (nextNodeIds.length === 0) {
        contextManager.log('INFO', currentNode.name, 'No next nodes, workflow completed', {
          nodeId: currentNode.nodeId,
          outputHandle: result.outputHandle || 'source',
          hasWorkflowGraph: !!workflowGraph,
          graphCacheHasWorkflow: !!this.graphCache.get(workflow.id),
          currentGraphAvailable: !!this.currentGraph,
        })
        break
      }
      // Check if we have multiple nodes (parallel execution - fork point detected)
      if (nextNodeIds.length > 1) {
        contextManager.log(
          'INFO',
          currentNode.name,
          'Fork point detected, executing parallel branches',
          { parallelNodes: nextNodeIds }
        )
        // Get the graph to check for fork/join information
        const graph = this.graphCache.get(workflow.id)
        if (!graph) {
          throw new Error('Workflow graph not found in cache')
        }
        // Check if this is a recognized fork point
        const forkInfo = graph.forkPoints.get(currentNode.nodeId)
        const outputHandle = result.outputHandle || 'source'
        const currentFork = forkInfo?.find((f) => f.outputHandle === outputHandle)
        if (currentFork?.joinNodeId) {
          // We have a fork with a known join point
          contextManager.log('INFO', currentNode.name, 'Fork with join point detected', {
            forkNode: currentNode.nodeId,
            joinNode: currentFork.joinNodeId,
            branches: nextNodeIds,
          })

          // V5: Initialize join state for the convergence point
          const joinInfo = graph.joinPoints.get(currentFork.joinNodeId)
          if (!joinInfo) {
            throw new Error(`Join info not found for ${currentFork.joinNodeId}`)
          }

          await contextManager.initializeJoinState(
            currentFork.joinNodeId,
            currentNode.nodeId,
            Array.from(joinInfo.expectedInputs)
          )

          this.trackingManager.incrementDepth()

          // V5: Execute branches and wait for convergence
          const convergenceResult = await this.executeParallelBranches(
            workflow,
            nextNodeIds,
            contextManager,
            options,
            currentFork.joinNodeId // V5: Pass join node ID
          )

          this.trackingManager.decrementDepth()

          // V5: Handle convergence state
          switch (convergenceResult.state) {
            case 'converged': {
              // All required branches arrived - execute join
              const joinNode = findNodeById(workflow, currentFork.joinNodeId)
              if (!joinNode) {
                throw new Error(`Join node ${currentFork.joinNodeId} not found`)
              }

              contextManager.log('INFO', currentNode.name, 'Branches converged, executing join', {
                arrivedCount: convergenceResult.arrivedBranchIds.length,
              })

              // Handle join point merging
              await this.handleJoinPoint(joinNode, convergenceResult.joinState, contextManager)

              // Execute join node
              const joinResult = await this.executeNodeInternal(joinNode, contextManager, options)
              nodeResults[joinNode.nodeId] = joinResult
              this.currentNodeResults[joinNode.nodeId] = joinResult

              // Continue after join (get next nodes from join)
              const nextAfterJoin = getNextNodeIds(joinNode, joinResult, workflowGraph)
              if (nextAfterJoin.length === 0) {
                break // Terminal node
              }
              currentNode = findNodeById(workflow, nextAfterJoin[0])
              continue
            }

            case 'waiting': {
              // Some branches paused, can't proceed yet - PAUSE workflow
              // Continuation registered in waitForBranchConvergence, will resume when branches complete
              contextManager.log('INFO', currentNode.name, 'Waiting for paused branches', {
                pausedCount: convergenceResult.pausedBranchIds.length,
                arrivedCount: convergenceResult.arrivedBranchIds.length,
              })

              // Emit workflow paused event
              if (options.reporter && options.workflowRunId) {
                await options.reporter.emit(WorkflowEventType.WORKFLOW_PAUSED, {
                  workflowId: workflow.id,
                  workflowRunId: options.workflowRunId,
                  nodeId: currentFork.joinNodeId,
                  reason: `Waiting for ${convergenceResult.pausedBranchIds.length} paused branches`,
                  pausedAt: new Date(),
                  isTerminalPause: false,
                })
              }

              // Throw pause exception to pause workflow
              const pauseState = this.persistenceManager.saveState(
                contextManager.getContext().executionId,
                contextManager,
                nodeResults,
                {
                  status: WorkflowExecutionStatus.PAUSED,
                  currentNodeId: currentFork.joinNodeId,
                  pauseReason: {
                    type: 'wait',
                    nodeId: currentFork.joinNodeId,
                    message: `Waiting for ${convergenceResult.pausedBranchIds.length} paused branches`,
                    metadata: {
                      pausedBranches: convergenceResult.pausedBranchIds,
                      arrivedBranches: convergenceResult.arrivedBranchIds,
                    },
                  },
                  isTerminalPause: false,
                }
              )

              throw new WorkflowPausedException(pauseState)
            }

            case 'all-paused': {
              // All branches paused - pause entire workflow
              contextManager.log('INFO', currentNode.name, 'All branches paused', {
                pausedCount: convergenceResult.pausedBranchIds.length,
              })

              // Emit workflow paused event
              if (options.reporter && options.workflowRunId) {
                await options.reporter.emit(WorkflowEventType.WORKFLOW_PAUSED, {
                  workflowId: workflow.id,
                  workflowRunId: options.workflowRunId,
                  nodeId: currentFork.joinNodeId,
                  reason: 'All parallel branches paused',
                  pausedAt: new Date(),
                  isTerminalPause: true,
                })
              }

              // Throw pause exception to pause workflow
              const pauseState = this.persistenceManager.saveState(
                contextManager.getContext().executionId,
                contextManager,
                nodeResults,
                {
                  status: WorkflowExecutionStatus.PAUSED,
                  currentNodeId: currentFork.joinNodeId,
                  pauseReason: {
                    type: 'all_branches_paused',
                    nodeId: currentFork.joinNodeId,
                    message: 'All parallel branches paused',
                    metadata: { pausedBranches: convergenceResult.pausedBranchIds },
                  },
                  isTerminalPause: true,
                }
              )

              throw new WorkflowPausedException(pauseState)
            }
          }
        } else {
          // Fan-out pattern: execute parallel nodes without join convergence
          contextManager.log(
            'INFO',
            currentNode.name,
            'Fork without join point (fan-out pattern)',
            { parallelNodes: nextNodeIds }
          )
          // INCREMENT DEPTH FOR FAN-OUT BRANCHES (same as fork-join)
          this.trackingManager.incrementDepth()
          // Execute parallel nodes (they complete independently)
          const parallelResults = await this.executeParallelNodes(
            workflow,
            nextNodeIds,
            contextManager,
            options
          )
          // RESTORE DEPTH AFTER FAN-OUT COMPLETES
          this.trackingManager.decrementDepth()
          // Merge parallel results with existing results
          Object.assign(nodeResults, parallelResults)
          // Parallel execution complete
          contextManager.log('INFO', currentNode.name, 'Parallel execution completed (fan-out)')
          break
        }
      }
      // Single next node - continue sequential execution
      currentNode = findNodeById(workflow, nextNodeIds[0])
      if (!currentNode) {
        throw new Error(`Next node not found: ${nextNodeIds[0]}`)
      }
    }
    if (iterationCount >= maxIterations) {
      throw new Error('Maximum iteration limit reached, possible infinite loop')
    }
    return nodeResults
  }
  /**
   * Continue workflow execution from a join node after branches have converged
   *
   * ARCHITECTURE OVERVIEW:
   * This method is called asynchronously via callback when all expected branches
   * arrive at a join point. It runs in a separate execution context from the main
   * executeWorkflowNodes() loop.
   *
   * KEY RESPONSIBILITIES:
   *
   * 1. JOIN EXECUTION:
   *    - Retrieves join state with all converged branch results
   *    - Sets join state as input for the join node
   *    - Executes the join node itself via executeNodeInternal()
   *
   * 2. CONTINUATION:
   *    - Determines next nodes after join
   *    - If single next node: restarts executeWorkflowNodes() from that point
   *    - Merges additional results back to global currentNodeResults
   *
   * PAUSE/RESUME IMPLICATIONS:
   * - If join node itself pauses, WorkflowPausedException bubbles up from executeNodeInternal()
   * - Join node pause is isolated from main execution thread (already stopped at fork)
   * - Continuation happens in callback context, not main execution thread
   * - Resume would need to account for join callback vs main execution context
   * - Join pause would be independent of any parallel branch pauses
   */
  private async continueFromJoin(
    workflow: Workflow,
    joinNode: WorkflowNode,
    contextManager: ExecutionContextManager,
    options: WorkflowExecutionOptions
  ): Promise<void> {
    try {
      // Get the current join state
      const joinState = await contextManager.getJoinState(joinNode.nodeId)
      if (!joinState) {
        throw new Error(`Join state not found for node ${joinNode.nodeId}`)
      }
      // Set join state as input for the node
      contextManager.setNodeInput(joinNode.nodeId, { joinState: joinState })
      // Decrement depth after parallel branches converge back to join
      this.trackingManager.decrementDepth()
      // Execute the join node
      const result = await this.executeNodeInternal(joinNode, contextManager, options)
      this.currentNodeResults[joinNode.nodeId] = result
      // Continue with the rest of the workflow
      const graph = this.graphCache.get(workflow.id)
      const nextNodeIds = getNextNodeIds(joinNode, result, graph!)
      if (nextNodeIds.length === 1) {
        const nextNode = findNodeById(workflow, nextNodeIds[0])
        if (nextNode) {
          // Continue execution from the next node
          const additionalResults = await this.executeWorkflowNodes(
            workflow,
            nextNode,
            contextManager,
            options,
            graph // Pass the graph to ensure it's available
          )
          // Merge results
          Object.assign(this.currentNodeResults, additionalResults)
        }
      }
    } catch (error) {
      logger.error('Error continuing from join', {
        joinNodeId: joinNode.nodeId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
  /**
   * Handle join point - MERGES BRANCHES BEFORE NODE EXECUTION
   *
   * This method now handles ALL merge logic that was previously in the JoinNode processor.
   * After this runs, the merged context is available for the actual node to use.
   * The node executes normally with merged variables.
   *
   * ARCHITECTURE OVERVIEW:
   * - Gets join configuration from the workflow graph
   * - Waits for branches to arrive based on join strategy
   * - Merges branch results using BranchMerger
   * - Applies merged context for the node to use
   * - Returns void (node executes normally after this)
   *
   * @returns void (previously returned NodeExecutionResult)
   */
  private async handleJoinPoint(
    joinNode: WorkflowNode,
    joinState: JoinState,
    contextManager: ExecutionContextManager
  ): Promise<void> {
    const graph = this.graphCache.get(this.currentWorkflow!.id)
    const joinInfo = graph?.joinPoints.get(joinNode.nodeId)

    if (!joinInfo) {
      throw new Error(`No join info found for node ${joinNode.nodeId}`)
    }

    // 1. Determine error strategy
    const errorStrategy = joinInfo.errorHandling?.continueOnError
      ? 'best-effort'
      : joinInfo.errorHandling?.aggregateErrors
        ? 'collect-all'
        : 'fail-fast'

    // 2. Wait for branches with strategy-specific behavior
    const waitResult = await this.joinExecutionManager.waitForBranches(joinState, {
      timeout: joinInfo.timeout,
      minRequired: joinInfo.requiredCount || joinInfo.errorHandling?.minSuccessfulBranches,
      waitStrategy: joinInfo.joinType,
      errorStrategy: errorStrategy,
    })

    // 3. Handle wait results based on error propagation strategy
    if (!waitResult.canProceed) {
      if (waitResult.reason === 'timeout') {
        // Handle timeout
        const timeoutInfo = {
          arrivedBranches: Array.from(joinState.completedInputs),
          missingBranches: Array.from(joinState.expectedInputs).filter(
            (id) => !joinState.completedInputs.has(id)
          ),
          timeout: joinInfo.timeout,
        }

        contextManager.log(
          'ERROR',
          joinNode.name,
          'Join timeout - not all branches arrived',
          timeoutInfo
        )

        if (joinInfo.errorHandling?.continueOnError) {
          contextManager.log('WARN', joinNode.name, 'Continuing despite timeout', timeoutInfo)
        } else {
          throw new Error(
            `Join timeout: Only ${waitResult.arrivedCount}/${waitResult.expectedCount} branches arrived`
          )
        }
      } else if (errorStrategy === 'fail-fast' && waitResult.firstError) {
        throw new Error(`Branch failed: ${waitResult.firstError.error.message}`)
      } else {
        // Still waiting - this shouldn't happen in handleJoinPoint
        throw new Error('handleJoinPoint called while still waiting for branches')
      }
    }

    // 4. Analyze branch statuses
    const branchAnalysis = this.branchMerger.analyzeBranchStatuses(joinState.branchResults)
    const minRequired = joinInfo.errorHandling?.minSuccessfulBranches || 1

    // 5. Check if minimum successful branches met
    if (branchAnalysis.successCount < minRequired) {
      const errorData = {
        message: `Only ${branchAnalysis.successCount} branches succeeded, minimum required: ${minRequired}`,
        ...branchAnalysis,
        errors: joinInfo.errorHandling?.aggregateErrors
          ? this.branchMerger.aggregateErrors(joinState.branchResults)
          : this.branchMerger.collectErrors(joinState.branchResults),
      }

      if (!joinInfo.errorHandling?.continueOnError) {
        // Fail the workflow - throw aggregated error
        const aggregated = this.branchMerger.aggregateErrors(joinState.branchResults)
        throw new Error(aggregated.summary)
      }

      // continueOnError = true - log warning and continue with partial results
      contextManager.setVariable('_joinError', errorData)
      contextManager.log('WARN', joinNode.name, 'Continuing despite branch failures', errorData)
    }

    // 6. PERFORM THE MERGE - This is the key change!
    const mergeStrategy = joinInfo.mergeStrategy || { type: 'merge-all' }
    const mergedContext = await this.branchMerger.mergeBranchResults(
      joinState.branchResults,
      mergeStrategy,
      contextManager,
      joinNode.nodeId
    )

    // 7. Apply merged context to execution
    contextManager.applyMergedVariables(mergedContext)

    // 8. Store branch summary for node to access if needed
    contextManager.setVariable('_branchSummary', {
      total: Object.keys(joinState.branchResults).length,
      successful: branchAnalysis.successCount,
      failed: branchAnalysis.errorCount,
      timedOut: branchAnalysis.timeoutCount,
      mergedVariables: Object.keys(mergedContext),
      mergeStrategy: mergeStrategy.type,
    })

    // 9. Clean up join state
    await this.batchedJoinUpdater.flush()
    await this.joinExecutionManager.cleanupJoin(joinNode.nodeId)
    this.joinStateCache.invalidate(contextManager.getContext().executionId, joinNode.nodeId)

    contextManager.log('INFO', joinNode.name, 'Branches merged successfully', {
      mergedVariables: Object.keys(mergedContext).length,
      strategy: mergeStrategy.type,
      branches: {
        total: branchAnalysis.totalCount,
        successful: branchAnalysis.successCount,
        failed: branchAnalysis.errorCount,
      },
    })
  }
  /**
   * Handle join timeout scenario
   *
   * ARCHITECTURE OVERVIEW:
   * This method handles cases where join points timeout waiting for branches.
   * It determines whether timeout is expected behavior or a failure condition.
   *
   * KEY RESPONSIBILITIES:
   *
   * 1. TIMEOUT CLASSIFICATION:
   *    - Checks if join type expects timeouts ('timeout' join type)
   *    - Distinguishes expected vs unexpected timeout scenarios
   *
   * 2. RESULT GENERATION:
   *    - Expected timeout: Returns success with timeout metadata
   *    - Unexpected timeout: Returns failure with diagnostic information
   *
   * PAUSE/RESUME IMPLICATIONS:
   * - Currently doesn't distinguish between "branch is slow" and "branch is paused"
   * - Paused branches should not count toward timeout calculations
   * - Timeout might inappropriately trigger when branches are legitimately paused
   * - Need mechanism to:
   *   a) Exclude paused branches from timeout logic
   *   b) Extend timeout when branches are paused vs actually slow
   *   c) Provide different timeout behavior for paused vs running branches
   */
  private handleJoinTimeout(
    joinNode: WorkflowNode,
    joinState: JoinState,
    waitResult: BranchArrivalStatus
  ): NodeExecutionResult {
    const config = joinNode.data || {}
    logger.warn('Join timeout reached', {
      joinNodeId: joinNode.nodeId,
      timeout: config.timeout,
      arrivedCount: waitResult.arrivedCount,
      expectedCount: waitResult.expectedCount,
    })
    // Check if we should fail or continue on timeout
    if (config.joinType === 'timeout') {
      // This is expected behavior for timeout joins
      return {
        nodeId: joinNode.nodeId,
        status: NodeRunningStatus.Succeeded,
        output: {
          timedOut: true,
          arrivedCount: waitResult.arrivedCount,
          expectedCount: waitResult.expectedCount,
        },
        executionTime: 0,
      }
    } else {
      // Unexpected timeout
      return {
        nodeId: joinNode.nodeId,
        status: NodeRunningStatus.Failed,
        error: `Join timeout after ${config.timeout}ms. Arrived: ${waitResult.arrivedCount}/${waitResult.expectedCount}`,
        executionTime: 0,
      }
    }
  }
  /**
   * Execute a single node (internal)
   *
   * ARCHITECTURE OVERVIEW:
   * This is the core node execution method that handles the complete lifecycle
   * of individual node execution, including pause detection and database tracking.
   *
   * KEY RESPONSIBILITIES:
   *
   * 1. NODE LIFECYCLE MANAGEMENT:
   *    - Preprocessing via node processor
   *    - Database record creation (WorkflowNodeExecution)
   *    - Actual execution via processor.execute()
   *    - Success/failure event emission
   *    - Special handling for loop nodes
   *
   * 2. PAUSE DETECTION & HANDLING:
   *    - Checks if result.status === NodeRunningStatus.Paused
   *    - Calls pauseExecution() to save state and emit events
   *    - Throws WorkflowPausedException to bubble up to caller
   *
   * 3. DATABASE INTEGRATION:
   *    - Creates WorkflowNodeExecution records for tracking
   *    - Updates records with outputs/errors on completion
   *    - Emits events via reporter for SSE/monitoring
   *
   * PAUSE/RESUME IMPLICATIONS:
   * - This is THE critical pause detection point in the entire engine
   * - Currently treats all pauses the same - no distinction between:
   *   a) "Pause this branch only" vs "Pause entire workflow"
   *   b) "Wait for user input" vs "Wait for time delay"
   * - Pause immediately triggers workflow-level pause exception
   * - No context about parallel branch state when making pause decisions
   * - Node-level pause always becomes workflow-level pause
   */
  private async executeNodeInternal(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    options: WorkflowExecutionOptions
  ): Promise<NodeExecutionResult> {
    const executionId = contextManager.getContext().executionId
    // Track node execution ID for updates (needs to be accessible in catch block)
    let nodeExecutionId: string | undefined
    try {
      // Track node start in metrics
      workflowMetrics.nodeStart(executionId, node.nodeId)
      // Call onNodeStart callback
      if (options.onNodeStart) {
        await options.onNodeStart(node.nodeId, node, contextManager.getContext())
      }
      // Get processor first
      const processor = await this.nodeRegistry.getProcessor(node.type)
      if (!processor) {
        throw new Error(`No processor found for node type: ${node.type}`)
      }
      // Create node execution record BEFORE preprocessing to ensure nodeExecutionId exists for error handling
      let nodeExecution: any = null
      if (options.reporter && options.workflowRunId) {
        ;[nodeExecution] = await db
          .insert(schema.WorkflowNodeExecution)
          .values({
            workflowRunId: options.workflowRunId,
            workflowAppId: options.workflowAppId!,
            workflowId: this.currentWorkflow!.id,
            triggeredFrom: NodeTriggerSource.WORKFLOW_RUN,
            index: this.trackingManager.incrementCounter(),
            predecessorNodeId: this.trackingManager.getLastExecutedNode(),
            nodeId: node.nodeId,
            nodeType: node.type,
            title: node.name,
            status: NodeRunningStatus.Running,
            inputs: {}, // Will be updated after preprocessing
            executionMetadata: {
              // Track depth for indentation in UI
              depth: this.trackingManager.getDepth(),
              // Add execution context for parallel/fork tracking
              forkId: this.trackingManager.getForkContext('forkId'),
              branchIndex: this.trackingManager.getForkContext('branchIndex'),
              executionPath: this.trackingManager.getForkContext('executionPath'),
              // Add loop context if executing inside a loop
              ...this.getLoopInfoMetadata(contextManager),
            },
            organizationId: options.organizationId || contextManager.getContext().organizationId,
            createdById: contextManager.getContext().userId,
          })
          .returning()
        // Store the ID for later updates
        nodeExecutionId = nodeExecution.id
      }
      // Preprocess node to extract relevant inputs and metadata
      let preprocessedData: any
      try {
        preprocessedData = await processor.preprocessNode(node, contextManager)
        // Update node execution record with preprocessed inputs
        if (nodeExecutionId) {
          ;[nodeExecution] = await db
            .update(schema.WorkflowNodeExecution)
            .set({ inputs: preprocessedData.inputs })
            .where(eq(schema.WorkflowNodeExecution.id, nodeExecutionId))
            .returning()
        }
      } catch (error) {
        // Handle preprocessing errors specifically
        if (error instanceof WorkflowNodeProcessingError) {
          // Already a processing error, re-throw to be handled by main catch block
          throw error
        } else {
          const preprocessMessage = error instanceof Error ? error.message : 'Preprocessing failed'
          const errorType = error?.constructor?.name
          // Wrap generic preprocessing errors in WorkflowNodeProcessingError
          const nodeError = new WorkflowNodeProcessingError(
            preprocessMessage,
            {
              nodeId: node.nodeId,
              nodeType: node.type,
              nodeName: node.name,
              timestamp: new Date(),
              metadata: {
                errorType,
                originalMessage: preprocessMessage,
                phase: 'preprocessing',
              },
            },
            error as Error
          )
          throw nodeError
        }
      }
      // Emit node-started event if reporter is provided (after preprocessing succeeds)
      if (options.reporter && options.workflowRunId && nodeExecution) {
        await options.reporter.emit(WorkflowEventType.NODE_STARTED, nodeExecution)
      }
      let result: NodeExecutionResult
      // Special handling for loop nodes
      if (node.type === WorkflowNodeType.LOOP) {
        console.log('EXECUTING LOOP NODE:', node.nodeId)
        if (!this.currentWorkflow) {
          throw new Error('No current workflow context for loop execution')
        }
        result = await this.loopExecutionManager.setupLoopExecution(
          node,
          processor,
          contextManager,
          options,
          this.currentWorkflow
        )
      } else {
        result = await processor.execute(node, contextManager, preprocessedData)
      }

      console.log('Node execution result:', result)
      // Check if node requested pause
      if (result.status === NodeRunningStatus.Paused && result.pauseReason) {
        // Record pause in metrics
        workflowMetrics.recordPause(executionId)
        console.log('Workflow execution paused')
        // Determine if this is a branch-level or workflow-level pause
        // Check for both '-branch-' and '-parallel-' patterns in execution ID
        const isInBranchContext =
          executionId.includes('-branch-') || executionId.includes('-parallel-')
        const isTerminalPause = shouldPauseBeTerminal(result.pauseReason, isInBranchContext)
        logger.info('Node pause detected - analyzing context', {
          nodeId: node.nodeId,
          nodeType: node.type,
          executionId,
          isInBranchContext,
          pauseType: result.pauseReason.type,
          isTerminalPause,
          pauseReason: result.pauseReason,
        })
        // Save state and pause execution
        const state = await this.pauseExecution(
          contextManager.getContext().executionId,
          result.pauseReason,
          contextManager,
          this.currentNodeResults,
          options,
          isTerminalPause
        )
        // Store the paused node result
        this.currentNodeResults[node.nodeId] = result
        // For branch-level pauses that are not terminal, don't bubble up to main execution
        if (isInBranchContext && !isTerminalPause) {
          logger.info('Branch-level pause detected, not terminating workflow', {
            nodeId: node.nodeId,
            executionId,
            pauseReason: result.pauseReason.type,
          })
          // Still throw the exception - executeParallelBranches will handle it correctly
          // This allows the branch to exit cleanly without marking as "arrived" at join
          throw new WorkflowPausedException(state)
        }
        // Terminal pause or sequential execution - bubble up to main workflow
        throw new WorkflowPausedException(state)
      }
      // Track node completion in metrics
      workflowMetrics.nodeEnd(executionId, node.nodeId)
      // Call onNodeComplete callback
      if (options.onNodeComplete) {
        await options.onNodeComplete(node.nodeId, result, contextManager.getContext())
      }
      // Emit node-completed event if reporter is provided
      if (options.reporter && options.workflowRunId && nodeExecutionId) {
        // Update node execution record
        const [updatedNodeExecution] = await db
          .update(schema.WorkflowNodeExecution)
          .set({
            outputs: result.output,
            status:
              result.status === NodeRunningStatus.Skipped
                ? NodeRunningStatus.Skipped
                : NodeRunningStatus.Succeeded,
            elapsedTime: result.executionTime ? result.executionTime / 1000 : undefined,
            finishedAt: new Date(),
          })
          .where(eq(schema.WorkflowNodeExecution.id, nodeExecutionId))
          .returning()
        await options.reporter.emit(WorkflowEventType.NODE_COMPLETED, updatedNodeExecution)
      }
      // Update last executed node after successful execution
      this.trackingManager.setLastExecutedNode(node.nodeId)
      return result
    } catch (error: unknown) {
      // Record error in metrics
      workflowMetrics.recordError(executionId)
      if (error instanceof WorkflowPausedException) {
        throw error // Propagate pause
      }
      // Determine error type and handle accordingly
      if (error instanceof WorkflowNodeProcessingError) {
        // For preprocessing errors, emit both WORKFLOW_FAILED and NODE_FAILED
        await handlePreprocessingErrorUtil(error, node, options, contextManager, nodeExecutionId)
      } else if (error instanceof WorkflowNodeError) {
        // For other node errors, emit NODE_FAILED only
        await handleNodeErrorUtil(error, node, options, contextManager, nodeExecutionId)
      } else {
        const message = error instanceof Error ? error.message : ''
        const errorType = error?.constructor?.name
        // For generic errors, wrap in WorkflowNodeExecutionError and handle
        const nodeError = new WorkflowNodeExecutionError(
          message || 'Unknown node error',
          {
            nodeId: node.nodeId,
            nodeType: node.type,
            nodeName: node.name,
            timestamp: new Date(),
            metadata: {
              errorType,
              originalMessage: message,
            },
          },
          error as Error
        )
        await handleNodeErrorUtil(nodeError, node, options, contextManager, nodeExecutionId)
      }
      throw error
    }
  }
  /**
   * Public method to validate a workflow without executing it
   * Useful for pre-publish validation checks
   */
  public async validateWorkflowForPublish(workflow: Workflow): Promise<ValidationResult> {
    try {
      await validateWorkflow(workflow, this.nodeRegistry)
      return { valid: true, errors: [], warnings: [] }
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
      }
    }
  }
  /**
   * Generate a unique execution ID
   */
  private generateExecutionId(): string {
    return this.trackingManager.generateExecutionId()
  }

  /**
   * Get loop info metadata for node executions
   * Returns loopInfo object if the node is executing inside a loop, otherwise returns empty object
   */
  private getLoopInfoMetadata(contextManager: ExecutionContextManager): { loopInfo?: any } {
    const activeLoops = LoopContextManager.getActiveLoops(contextManager)

    // If no active loops, return empty object
    if (activeLoops.size === 0) {
      return {}
    }

    // Get the most recent (innermost) active loop
    const loopStates = Array.from(activeLoops.values())
    const currentLoop = loopStates[loopStates.length - 1]

    if (!currentLoop) {
      return {}
    }

    // Return loop info metadata
    return {
      loopInfo: {
        loopNodeId: currentLoop.loopNodeId,
        iterationIndex: currentLoop.currentIteration,
        totalIterations: currentLoop.totalIterations,
        item: currentLoop.items[currentLoop.currentIteration],
      },
    }
  }

  /**
   * Get the node processor registry for adding custom processors
   */
  getNodeRegistry(): NodeProcessorRegistry {
    return this.nodeRegistry
  }
  /**
   * Cancel a running workflow execution
   */
  cancelExecution(executionId: string): void {
    this.cancellationManager.cancelExecution(executionId)
  }
  /**
   * Cancel a running workflow by workflow run ID
   */
  cancelWorkflowRun(workflowRunId: string): void {
    this.cancellationManager.cancelWorkflowRun(workflowRunId)
  }
  /**
   * Clear the workflow graph cache
   */
  clearGraphCache(workflowId?: string): void {
    if (workflowId) {
      this.graphCache.delete(workflowId)
    } else {
      this.graphCache.clear()
    }
  }
  /**
   * Execute parallel branches with fire-and-forget pattern (for fork/join)
   *
   * ARCHITECTURE OVERVIEW:
   * This is the ONLY method that correctly handles branch-level pauses in the engine.
   * It launches independent parallel branches without waiting for completion.
   *
   * KEY RESPONSIBILITIES:
   *
   * 1. PARALLEL BRANCH LAUNCHING:
   *    - Creates isolated execution contexts for each branch
   *    - Executes branches via executeWorkflowNodes() independently
   *    - Uses Promise.allSettled() with fire-and-forget pattern
   *
   * 2. BRANCH RESULT HANDLING:
   *    - Captures branch results (success/error/pause)
   *    - Marks successful branches as "arrived" at join points
   *    - Handles branch failures independently
   *
   * 3. PAUSE HANDLING (CRITICAL):
   *    - Correctly catches WorkflowPausedException from branches
   *    - Does NOT mark paused branches as "arrived" at join
   *    - Allows join to wait indefinitely for paused branch resume
   *    - Exits branch execution cleanly without affecting other branches
   *
   * PAUSE/RESUME IMPLICATIONS:
   * - This is the ONLY place in engine that handles branch-level pauses correctly
   * - Paused branches don't interfere with other running branches
   * - Join points wait for paused branches (as designed)
   * - No central tracking of which branches are paused
   * - No mechanism to resume individual branches - would need enhancement
   * - Branch pause is isolated and doesn't bubble up to main execution
   */
  private async executeParallelBranches(
    workflow: Workflow,
    branchNodeIds: string[],
    contextManager: ExecutionContextManager,
    options: WorkflowExecutionOptions,
    joinNodeId: string // V5: NEW parameter
  ): Promise<BranchConvergenceResult> {
    const executionId = contextManager.getContext().executionId
    const forkNodeId = contextManager.getCurrentNode() || 'unknown'
    // Generate unique fork ID for this parallel execution
    const forkId = `fork-${forkNodeId}-${Date.now()}`
    // logger.info('Starting parallel branch execution', {
    //   branchCount: branchNodeIds.length,
    //   branches: branchNodeIds,
    // })
    // Track parallel execution start in metrics
    workflowMetrics.parallelStart(executionId, forkNodeId, branchNodeIds.length)
    // Get the graph for join detection
    const graph = this.graphCache.get(workflow.id)
    if (!graph) {
      throw new Error('Workflow graph not found')
    }
    // Track branch states for real-time workflow pause detection
    const branchStates = new Map<string, 'running' | 'completed' | 'paused' | 'failed'>()
    branchNodeIds.forEach((nodeId) => branchStates.set(nodeId, 'running'))
    // Execute all branches independently with isolated contexts
    const branchPromises = branchNodeIds.map(async (nodeId, branchIndex) => {
      // Check for cancellation before starting branch
      if (
        this.cancellationManager.isCancelled(
          contextManager.getContext().executionId,
          options.workflowRunId
        )
      ) {
        logger.info('Branch cancelled before execution', {
          nodeId,
          workflowRunId: options.workflowRunId,
        })
        throw new Error('Workflow execution cancelled by user')
      }
      const node = findNodeById(workflow, nodeId)
      if (!node) {
        throw new Error(`Branch node not found: ${nodeId}`)
      }
      // Create fully isolated context for the branch
      const branchContext = contextManager.createIsolatedBranchContext(
        `${contextManager.getContext().executionId}-branch-${nodeId}`
      )
      // Set fork context for this branch
      this.trackingManager.setForkContext(forkId, branchIndex, `${forkNodeId}->${nodeId}`)
      const startTime = Date.now()
      let branchResult: BranchResult
      let nodeResults: Record<string, NodeExecutionResult> | undefined
      try {
        // Execute the branch to completion - pass the graph so it can find next nodes
        nodeResults = await this.executeWorkflowNodes(
          workflow,
          node,
          branchContext,
          options,
          graph // Pass the graph to branch execution
        )
        // Branch completed successfully - monitoring will handle workflow pause detection
        // Capture branch result (NO MERGING HERE)
        branchResult = {
          branchNodeId: nodeId,
          status: 'success',
          output: nodeResults[nodeId],
          contextChanges: branchContext.getVariableChanges(), // Get only the changes
          executionTime: Date.now() - startTime,
          nodesExecuted: Object.keys(nodeResults).length,
          completedAt: new Date(),
        } as BranchResult
      } catch (error) {
        // Check if branch was paused
        if (error instanceof WorkflowPausedException) {
          logger.info('Branch execution paused', {
            nodeId,
            pausedAt: error.state.currentNodeId,
            reason: error.state.pauseReason,
          })
          // Don't mark branch as arrived - it's paused
          // The branch will be resumed later and continue to the join
          // Re-throw so Promise.allSettled can detect it as paused (not fulfilled)
          throw error
        }
        logger.error('Branch execution failed', {
          nodeId,
          error: error instanceof Error ? error.message : String(error),
        })
        // Branch failed - create proper Error object for BranchResult
        const branchError = error instanceof Error ? error : new Error(String(error))
        branchResult = {
          branchNodeId: nodeId,
          status: 'error',
          error: branchError,
          executionTime: Date.now() - startTime,
          completedAt: new Date(),
        }
      } finally {
        // Clear fork context after branch execution
        this.trackingManager.clearForkContext()
      }
      // Track branch completion in metrics
      workflowMetrics.branchComplete(executionId, forkNodeId, nodeId)
      // Find which join this branch leads to by checking the last executed node
      const lastExecutedNodeId =
        Object.keys(branchResult.status === 'success' && nodeResults ? nodeResults : {}).pop() ||
        nodeId
      const joinNodeId = this.findJoinForBranch(lastExecutedNodeId, graph)
      if (joinNodeId) {
        // Mark branch as completed at the join (but don't merge yet)
        contextManager.log('DEBUG', 'Branch Arrival', 'Marking branch as arrived at join', {
          branchNodeId: nodeId,
          lastExecutedNodeId,
          joinNodeId,
          branchStatus: branchResult.status,
        })
        await contextManager.markBranchAsArrived(joinNodeId, nodeId, branchResult)
        // Notify join execution manager
        await this.joinExecutionManager.markBranchArrived(
          executionId,
          joinNodeId,
          nodeId,
          branchResult
        )
      } else {
        // Log warning if no join found
        contextManager.log('WARN', 'Branch Arrival', 'Could not find join for completed branch', {
          branchNodeId: nodeId,
          lastExecutedNodeId,
          forkNodeId,
          availableJoins: Array.from(graph.joinPoints.keys()),
        })
      }
    })

    // V5: Get join info for convergence checking
    const joinInfo = graph.joinPoints.get(joinNodeId)
    if (!joinInfo) {
      throw new Error(`Join info not found for ${joinNodeId}`)
    }

    // V5: Wait for convergence instead of fire-and-forget
    return await this.waitForBranchConvergence(
      branchPromises,
      branchNodeIds,
      joinNodeId,
      joinInfo,
      contextManager,
      options,
      workflow
    )
  }

  /**
   * Restores join trackers from persisted state after system restart
   * V5 enhancement: Called during resumeExecution() before continuing execution
   */
  private restoreJoinTrackers(
    state: ExecutionState,
    contextManager: ExecutionContextManager,
    workflow: Workflow,
    options: WorkflowExecutionOptions
  ): void {
    if (!state.context.joinStates) {
      return // No joins to restore
    }

    const graph = this.graphCache.get(workflow.id)
    if (!graph) {
      logger.warn('Graph not found during join tracker restoration', { workflowId: workflow.id })
      return
    }

    for (const [joinNodeId, serializedJoinState] of Object.entries(state.context.joinStates)) {
      // Deserialize join state from database
      const joinState = JoinState.fromJSON(serializedJoinState)

      // Find which branches are still paused (not yet arrived)
      const pausedBranchIds = Array.from(joinState.expectedInputs).filter(
        (id) => !joinState.completedInputs.has(id)
      )

      if (pausedBranchIds.length === 0) {
        // All branches already arrived, no need to wait
        continue
      }

      // Get join node configuration
      const joinNode = findNodeById(workflow, joinNodeId)
      if (!joinNode) {
        logger.warn('Join node not found during restore', { joinNodeId })
        continue
      }

      const joinInfo = graph.joinPoints.get(joinNodeId)
      if (!joinInfo) {
        logger.warn('Join info not found during restore', { joinNodeId })
        continue
      }

      // Create list of paused branch execution IDs for tracking
      const pausedBranchExecutionIds = pausedBranchIds.map(
        (id) => `${state.executionId}-branch-${id}`
      )

      logger.info('Restoring join tracker after restart', {
        joinNodeId,
        pausedBranchCount: pausedBranchIds.length,
        arrivedBranchCount: joinState.completedInputs.size,
      })

      // Re-register continuation in activeJoins (hot state)
      // This allows branch resumes to findJoinForBranch() successfully
      const waitOptions: JoinWaitOptions = {
        timeout: joinInfo.timeout,
        minRequired: joinInfo.requiredCount,
        waitStrategy: joinInfo.joinType || 'all',
        errorStrategy: joinInfo.errorHandling?.continueOnError ? 'best-effort' : 'fail-fast',
      }

      this.joinExecutionManager.registerContinuation(
        state.executionId,
        joinNodeId,
        joinState,
        async () => {
          // Continuation callback - executes join when ready
          await this.handleJoinPoint(joinNode, joinState, contextManager)

          // Execute join node
          const joinResult = await this.executeNodeInternal(joinNode, contextManager, options)
          this.currentNodeResults[joinNode.nodeId] = joinResult

          // Main loop will handle continuation from here
        },
        waitOptions,
        pausedBranchExecutionIds
      )
    }
  }

  /**
   * Find the join node that a branch leads to
   *
   * ARCHITECTURE OVERVIEW:
   * Simple graph traversal method to determine which join point a completed
   * branch should "arrive" at. Used for branch-to-join mapping.
   *
   * KEY RESPONSIBILITIES:
   *
   * 1. GRAPH TRAVERSAL:
   *    - Checks direct connections from node's 'source' handle
   *    - Looks for edges targeting nodes marked as join points
   *    - Returns first join point found (simple implementation)
   *
   * 2. JOIN RESOLUTION:
   *    - Maps completed branches to their convergence points
   *    - Enables join points to track which branches have arrived
   *
   * PAUSE/RESUME IMPLICATIONS:
   * - Used to determine where paused branches should "arrive" when resumed
   * - Critical for knowing which join is waiting for a paused branch
   * - Simple implementation might miss complex graph patterns with multiple joins
   * - Enhanced implementation needed for:
   *   a) Complex graphs with multiple possible join targets
   *   b) Conditional joins based on branch execution paths
   *   c) Dynamic join point resolution based on runtime conditions
   */
  private findJoinForBranch(nodeId: string, graph: WorkflowGraph): string | undefined {
    // FIRST: Check if the node itself is a join point
    // This handles the case where branches complete at the join node (e.g., END node)
    if (graph.joinPoints.has(nodeId)) {
      return nodeId
    }

    // THEN: Check if this node is directly connected to a join
    const edges = graph.edgesBySourceHandle.get(`${nodeId}:source`) || []
    for (const edge of edges) {
      if (graph.joinPoints.has(edge.target)) {
        return edge.target
      }
    }
    // TODO: Implement more sophisticated join finding for complex graphs
    return undefined
  }
  /**
   * Check if join can proceed based on strategy
   * V5 enhancement: Simplified one-liner switch
   */
  private checkJoinCanProceed(
    joinInfo: JoinPointInfo,
    arrivedCount: number,
    expectedCount: number,
    pausedCount: number,
    failedCount: number
  ): boolean {
    const strategy = joinInfo.joinType || 'all'
    const errorStrategy = joinInfo.errorHandling?.continueOnError ? 'best-effort' : 'fail-fast'

    // Fail fast if any branch failed and error strategy is fail-fast
    if (failedCount > 0 && errorStrategy === 'fail-fast') {
      return false
    }

    // Check strategy (one-liner switch)
    switch (strategy) {
      case 'all':
        return arrivedCount === expectedCount && pausedCount === 0
      case 'any':
        return arrivedCount > 0
      case 'count':
        return arrivedCount >= (joinInfo.requiredCount || 1)
      case 'timeout':
        return arrivedCount > 0
      default:
        return arrivedCount === expectedCount && pausedCount === 0
    }
  }

  /**
   * Wait for parallel branches to converge at join point
   * V5 enhancement: Returns convergence state without pausing (pause happens in main loop)
   */
  private async waitForBranchConvergence(
    branchPromises: Promise<void>[],
    branchNodeIds: string[],
    joinNodeId: string,
    joinInfo: JoinPointInfo,
    contextManager: ExecutionContextManager,
    options: WorkflowExecutionOptions,
    workflow: Workflow
  ): Promise<BranchConvergenceResult> {
    const executionId = contextManager.getContext().executionId
    const isBranchContext = contextManager.getContext().isBranchContext

    // Wait for all branches to settle
    const outcomes = await Promise.allSettled(branchPromises)

    // Track outcomes
    const completedBranchIds: string[] = []
    const pausedBranchIds: string[] = []
    const failedBranchIds: string[] = []
    const pauseExceptions: WorkflowPausedException[] = []
    const errors: Error[] = []

    outcomes.forEach((outcome, index) => {
      const branchId = branchNodeIds[index]!

      if (outcome.status === 'fulfilled') {
        completedBranchIds.push(branchId)
      } else if (outcome.reason instanceof WorkflowPausedException) {
        pausedBranchIds.push(branchId)
        pauseExceptions.push(outcome.reason)
      } else {
        failedBranchIds.push(branchId)
        errors.push(
          outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason))
        )
      }
    })

    // Get join state to see arrivals
    const joinState = await contextManager.getJoinState(joinNodeId)
    if (!joinState) {
      throw new Error(`Join state not found for ${joinNodeId}`)
    }

    const arrivedBranchIds = Array.from(joinState.completedInputs)
    const waitingForBranchIds = branchNodeIds.filter((id) => !arrivedBranchIds.includes(id))

    // Check if join can proceed with arrivals
    const canProceed = this.checkJoinCanProceed(
      joinInfo,
      arrivedBranchIds.length,
      branchNodeIds.length,
      pausedBranchIds.length,
      failedBranchIds.length
    )

    // Determine convergence state (simplified 3-state model)
    let state: 'converged' | 'waiting' | 'all-paused'

    if (canProceed && waitingForBranchIds.length === 0) {
      state = 'converged' // Can execute join now
    } else if (pausedBranchIds.length === branchNodeIds.length) {
      state = 'all-paused' // All branches paused
    } else {
      state = 'waiting' // Some branches paused, can't proceed yet
    }

    // NESTED FORK HANDLING: Bubble pause exception to parent
    if (isBranchContext && state === 'waiting') {
      contextManager.log('INFO', 'Branch Convergence', 'Nested fork pause detected, bubbling up', {
        joinNodeId,
        pausedBranches: pausedBranchIds,
      })

      const pauseState = this.persistenceManager.saveState(
        executionId,
        contextManager,
        this.currentNodeResults,
        {
          status: WorkflowExecutionStatus.PAUSED,
          currentNodeId: joinNodeId,
          pauseReason: {
            type: 'nested_branch_pause',
            nodeId: joinNodeId,
            message: `Nested fork waiting for ${pausedBranchIds.length} paused branches`,
            metadata: { pausedBranches: pausedBranchIds },
          },
          isTerminalPause: false,
        }
      )

      throw new WorkflowPausedException(pauseState)
    }

    // Register continuation if waiting (ATOMIC with state persistence)
    if (state === 'waiting') {
      // Workflow is now passed as parameter
      const joinNode = findNodeById(workflow, joinNodeId)
      if (!joinNode) {
        throw new Error(`Join node ${joinNodeId} not found`)
      }

      // Create list of paused branch execution IDs
      const pausedBranchExecutionIds = pausedBranchIds.map((id) => `${executionId}-branch-${id}`)

      // ATOMIC OPERATION: Register continuation + persist state
      const waitOptions: JoinWaitOptions = {
        timeout: joinInfo.timeout,
        minRequired: joinInfo.requiredCount,
        waitStrategy: joinInfo.joinType || 'all',
        errorStrategy: joinInfo.errorHandling?.continueOnError ? 'best-effort' : 'fail-fast',
      }

      await this.joinExecutionManager.registerContinuation(
        executionId,
        joinNodeId,
        joinState,
        async () => {
          // IMPORTANT: This callback ONLY executes the join node
          // It does NOT handle full continuation (main loop will do that on resume)
          contextManager.log('INFO', 'Join Continuation', 'Executing join after branch resume', {
            joinNodeId,
          })

          // Handle join point merging
          await this.handleJoinPoint(joinNode, joinState, contextManager)

          // Execute join node
          const joinResult = await this.executeNodeInternal(joinNode, contextManager, options)
          this.currentNodeResults[joinNode.nodeId] = joinResult

          // Main loop will handle continuation from here
        },
        waitOptions,
        pausedBranchExecutionIds // Track which branches we're waiting for
      )

      // Persist state (includes join states via toJSON)
      this.persistenceManager.saveState(executionId, contextManager, this.currentNodeResults, {
        status: WorkflowExecutionStatus.RUNNING, // Not paused, just waiting
        currentNodeId: joinNodeId,
      })
    }

    return {
      joinNodeId,
      joinState,
      state,
      completedBranchIds,
      pausedBranchIds,
      failedBranchIds,
      arrivedBranchIds,
      pauseExceptions: pauseExceptions.length > 0 ? pauseExceptions : undefined,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Execute multiple nodes in parallel (legacy wait-for-all pattern)
   *
   * ARCHITECTURE OVERVIEW:
   * This is the legacy parallel execution method that waits for ALL parallel
   * nodes to complete before continuing. Used for fork points without joins.
   *
   * KEY RESPONSIBILITIES:
   *
   * 1. PARALLEL EXECUTION WITH WAITING:
   *    - Creates child contexts for each parallel execution
   *    - Executes all nodes via executeWorkflowNodes() concurrently
   *    - Uses Promise.all() to wait for ALL nodes to complete
   *
   * 2. RESULT MERGING:
   *    - Waits for all parallel branches to finish
   *    - Merges all results back to main context
   *    - Returns merged results for further processing
   *
   * 3. CONTEXT MANAGEMENT:
   *    - Creates child contexts to avoid variable conflicts
   *    - Merges child context changes back to main context
   *
   * PAUSE/RESUME IMPLICATIONS:
   * - If ANY parallel node pauses, Promise.all() rejects with WorkflowPausedException
   * - No partial completion handling - all or nothing approach
   * - Doesn't use join points, simpler but less flexible than executeParallelBranches()
   * - Pause bubbles up and stops entire workflow (no branch-level pause support)
   * - Resume would need to restart all parallel nodes, not just paused ones
   * - Less sophisticated than executeParallelBranches() for pause handling
   */
  private async executeParallelNodes(
    workflow: Workflow,
    nodeIds: string[],
    contextManager: ExecutionContextManager,
    options: WorkflowExecutionOptions
  ): Promise<Record<string, NodeExecutionResult>> {
    logger.info('Executing parallel nodes', {
      nodeIds,
      count: nodeIds.length,
      workflowId: workflow.id,
    })
    // Execute all nodes concurrently
    const parallelExecutions = nodeIds.map(async (nodeId) => {
      // Check for cancellation before starting parallel branch
      if (
        this.cancellationManager.isCancelled(
          contextManager.getContext().executionId,
          options.workflowRunId
        )
      ) {
        throw new Error('Workflow execution cancelled by user')
      }
      const node = findNodeById(workflow, nodeId)
      if (!node) {
        logger.error('Parallel node not found', { nodeId })
        throw new Error(`Parallel node not found: ${nodeId}`)
      }
      // Create child context for parallel execution to avoid conflicts
      const parallelContext = contextManager.createChildContext(
        `${contextManager.getContext().executionId}-parallel-${nodeId}`
      )
      // Copy execution options to child context
      if (contextManager.getOptions()) {
        parallelContext.setOptions(contextManager.getOptions()!)
      }
      // Execute the parallel branch - pass the graph so it can find next nodes
      const graph = this.graphCache.get(workflow.id)
      const branchResults = await this.executeWorkflowNodes(
        workflow,
        node,
        parallelContext,
        options,
        graph
      )
      // Merge context changes back
      contextManager.mergeChildContext(parallelContext)
      return branchResults
    })
    // Wait for all parallel branches to complete
    const results = await Promise.all(parallelExecutions)
    // Merge all results
    const mergedResults: Record<string, NodeExecutionResult> = {}
    results.forEach((branchResult) => {
      Object.assign(mergedResults, branchResult)
    })
    logger.info('Parallel execution completed', {
      nodeIds,
      totalNodes: Object.keys(mergedResults).length,
    })
    return mergedResults
  }
  /**
   * Pause workflow execution
   */
  async pauseExecution(
    executionId: string,
    reason: PauseReason,
    contextManager: ExecutionContextManager,
    nodeResults: Record<string, NodeExecutionResult>,
    options?: WorkflowExecutionOptions,
    isTerminalPause?: boolean
  ): Promise<ExecutionState> {
    // Get execution tracking data from tracking manager
    const executionTracking = this.trackingManager.exportState()

    // Call persistence manager to save state
    const state = this.persistenceManager.saveState(executionId, contextManager, nodeResults, {
      currentNodeId: reason.nodeId,
      status: isTerminalPause ? WorkflowExecutionStatus.PAUSED : WorkflowExecutionStatus.RUNNING,
      pauseReason: reason,
      isTerminalPause,
      executionTracking,
    })

    logger.info('Workflow execution paused', {
      executionId,
      nodeId: reason.nodeId,
      reason: reason.type,
      isTerminalPause: isTerminalPause ?? false, // Default to false (branch-level)
    })
    // Always emit node-paused first for granular tracking
    if (options?.reporter && options?.workflowRunId) {
      // 1. Always emit node-paused for the specific node that paused
      await options.reporter.emit(WorkflowEventType.NODE_PAUSED, {
        workflowId: state.workflowId,
        workflowRunId: options.workflowRunId,
        nodeId: reason.nodeId,
        reason: reason.type,
        pausedAt: state.pausedAt,
        isTerminalPause: !!isTerminalPause,
      })
      // 2. If it's a terminal pause, also emit workflow-paused
      if (isTerminalPause) {
        await options.reporter.emit(WorkflowEventType.WORKFLOW_PAUSED, {
          workflowId: state.workflowId,
          workflowRunId: options.workflowRunId,
          nodeId: reason.nodeId,
          reason: reason.type,
          pausedAt: state.pausedAt,
          isTerminalPause: true,
        })
      }
    }
    return state
  }
  /**
   * Resume workflow execution from saved state
   */
  async resumeExecution(
    state: ExecutionState,
    options: ResumeOptions
  ): Promise<WorkflowExecutionResult> {
    const { fromNodeId, nodeOutput, variables, skipValidation, workflowRunId, reporter } = options
    logger.info('Resuming workflow execution', {
      executionId: state.executionId,
      fromNodeId,
      hasNodeOutput: !!nodeOutput,
    })
    // Emit workflow-resumed event if reporter is provided
    if (reporter && workflowRunId) {
      // Determine resume reason based on node output and pause context
      let resumeReason = 'unknown'
      if (state.pauseReason) {
        if (state.pauseReason.type === 'wait') {
          resumeReason = 'wait_completed'
        } else if (state.pauseReason.type === 'human_confirmation') {
          if (nodeOutput?.outcome === 'approve') {
            resumeReason = 'manual_approved'
          } else if (nodeOutput?.outcome === 'deny') {
            resumeReason = 'manual_denied'
          } else if (nodeOutput?.outcome === 'timeout') {
            resumeReason = 'manual_timeout'
          } else {
            resumeReason = 'manual_resumed'
          }
        }
      }
      await reporter.emit(WorkflowEventType.WORKFLOW_RESUMED, {
        workflowId: state.workflowId,
        workflowRunId: workflowRunId,
        fromNodeId,
        resumedAt: new Date(),
        nodeOutput: nodeOutput || null,
        resumeReason,
        previousPauseReason: state.pauseReason?.type || 'unknown',
      })
    }
    // Restore execution context
    const contextManager = this.persistenceManager.restoreContext(state)
    // Restore execution tracking state for proper depth and index continuation
    if (state.executionTracking) {
      this.trackingManager.importState(state.executionTracking)
      logger.info('Restored execution tracking state', this.trackingManager.exportState())
    } else {
      // Fallback: Try to recalculate from existing node executions for backward compatibility
      // await this.recalculateTrackingState(state.workflowId, workflowRunId)
    }
    // Apply any new variables
    if (variables) {
      Object.entries(variables).forEach(([key, value]) => {
        contextManager.setVariable(key, value)
      })
    }
    // Find the workflow
    const workflow = await this.loadWorkflow(state.workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${state.workflowId} not found`)
    }
    // Rebuild graph if needed
    let graph = this.graphCache.get(workflow.id)
    if (!graph) {
      graph = WorkflowGraphBuilder.buildGraph(workflow)
      this.graphCache.set(workflow.id, graph)
    }
    this.currentWorkflow = WorkflowGraphBuilder.getTransformedWorkflow()!
    this.currentGraph = graph

    // Set workflow context for AI nodes when resuming
    contextManager.setVariable('sys.workflow', this.currentWorkflow)

    // V5: CRITICAL - Restore join trackers before resuming execution
    // This repopulates activeJoins from database state
    this.restoreJoinTrackers(state, contextManager, workflow, {
      ...options,
      workflowRunId,
      reporter,
    })

    // Find the node to resume from
    const resumeNode = findNodeById(this.currentWorkflow, fromNodeId)
    if (!resumeNode) {
      throw new Error(`Resume node ${fromNodeId} not found`)
    }
    // Always complete the resumed node and emit NODE_COMPLETED event
    logger.info('Processing resumed node completion', {
      fromNodeId,
      pausedNodeId: state.pauseReason?.nodeId,
      hasNodeOutput: !!nodeOutput,
      nodeOutput,
      resumingPausedNode: state.pauseReason?.nodeId === fromNodeId,
    })
    // If this is the node that was paused, mark it as completed
    if (state.pauseReason?.nodeId === fromNodeId) {
      // Merge the original pause output with the resume output to preserve wait durations
      const originalOutput = state.nodeResults[fromNodeId]?.output || {}
      const resumeOutput = nodeOutput || {
        status: 'completed_from_resume',
        resumed_at: new Date().toISOString(),
      }
      // Merge outputs, giving priority to resume output but preserving original wait metadata
      const finalOutput = {
        ...originalOutput, // Preserve original pause data (including wait_duration_ms)
        ...resumeOutput, // Add resume data
        // Override only if resume output doesn't provide wait_duration_ms or it's 0
        ...(resumeOutput.wait_duration_ms === 0 && originalOutput.wait_duration_ms
          ? { wait_duration_ms: originalOutput.wait_duration_ms }
          : {}),
        // Always mark as completed from resume
        status: 'completed_from_resume',
        resumed_at: new Date().toISOString(),
      }
      state.nodeResults[fromNodeId] = {
        ...state.nodeResults[fromNodeId],
        output: finalOutput,
        status: NodeRunningStatus.Succeeded,
      }
      logger.info('Updated node result for resumed node', {
        fromNodeId,
        finalOutput,
        resultStatus: state.nodeResults[fromNodeId].status,
      })
      // Always emit NODE_COMPLETED event for the resumed node
      if (reporter && workflowRunId) {
        logger.info('Emitting NODE_COMPLETED event for resumed node', {
          fromNodeId,
          workflowRunId,
          hasReporter: !!reporter,
        })
        // Fetch the existing node execution record to calculate actual elapsed time
        const [existingNodeExecution] = await db
          .select()
          .from(schema.WorkflowNodeExecution)
          .where(
            and(
              eq(schema.WorkflowNodeExecution.workflowRunId, workflowRunId),
              eq(schema.WorkflowNodeExecution.nodeId, fromNodeId)
            )
          )
          .limit(1)

        if (existingNodeExecution) {
          // Calculate actual elapsed time from node creation to now
          const now = new Date()
          const createdAt = new Date(existingNodeExecution.createdAt)
          const actualElapsedTime = (now.getTime() - createdAt.getTime()) / 1000 // Convert to seconds

          logger.info('Calculated elapsed time for resumed node', {
            fromNodeId,
            createdAt: createdAt.toISOString(),
            finishedAt: now.toISOString(),
            elapsedTime: actualElapsedTime,
          })

          // Update the database record with correct timing and outputs
          const [updatedNodeExecution] = await db
            .update(schema.WorkflowNodeExecution)
            .set({
              outputs: finalOutput,
              status: NodeRunningStatus.Succeeded,
              elapsedTime: actualElapsedTime,
              finishedAt: now,
            })
            .where(eq(schema.WorkflowNodeExecution.id, existingNodeExecution.id))
            .returning()

          // Emit NODE_COMPLETED event with the actual updated record
          await reporter.emit(WorkflowEventType.NODE_COMPLETED, updatedNodeExecution)
          logger.info('NODE_COMPLETED event emitted successfully with actual elapsed time', {
            fromNodeId,
            elapsedTime: actualElapsedTime,
          })
        } else {
          logger.warn('Could not find existing node execution record for resumed node', {
            fromNodeId,
            workflowRunId,
          })
        }
      } else {
        logger.warn('Cannot emit NODE_COMPLETED - missing reporter or workflowRunId', {
          hasReporter: !!reporter,
          workflowRunId,
        })
      }
    } else {
      logger.info('Not the paused node - skipping completion logic', {
        pausedNodeId: state.pauseReason?.nodeId,
        fromNodeId,
        isPausedNode: state.pauseReason?.nodeId === fromNodeId,
      })
    }
    // Determine next nodes based on output
    // Use the final output for next node determination (either provided nodeOutput or default)
    const outputForNextNodes =
      state.pauseReason?.nodeId === fromNodeId
        ? nodeOutput || { status: 'completed_from_resume', resumed_at: new Date().toISOString() }
        : nodeOutput
    const allNextNodeIds = determineNextNodesForResume(
      resumeNode,
      outputForNextNodes,
      this.currentGraph
    )

    // Filter out already-visited nodes to prevent re-execution
    const nextNodeIds = allNextNodeIds.filter((nodeId) => !state.visitedNodes.has(nodeId))

    if (nextNodeIds.length === 0) {
      logger.info('No next nodes found - completing workflow execution')
      // No more nodes to execute, workflow is complete
      return await this.completeExecution(
        state.executionId,
        contextManager,
        state.nodeResults,
        WorkflowExecutionStatus.COMPLETED,
        undefined,
        { reporter, workflowRunId }
      )
    }
    // Continue execution from next nodes
    try {
      let additionalResults: Record<string, NodeExecutionResult> = {}
      if (nextNodeIds.length === 1) {
        logger.info('Continuing sequential execution from next node', {
          nextNodeId: nextNodeIds[0],
          hasReporter: !!reporter,
          workflowRunId: workflowRunId || state.executionId,
        })
        // Single next node - continue sequential execution
        const nextNode = findNodeById(this.currentWorkflow, nextNodeIds[0])
        if (nextNode) {
          logger.info('Found next node, executing', {
            nextNodeId: nextNode.nodeId,
            nodeType: nextNode.type,
          })
          additionalResults = await this.executeWorkflowNodes(
            this.currentWorkflow,
            nextNode,
            contextManager,
            {
              workflowRunId: workflowRunId || state.executionId,
              workflowAppId: options.workflowAppId,
              organizationId: options.organizationId,
              reporter,
            },
            this.currentGraph // Pass the graph to ensure it's available
          )
          logger.info('Sequential execution completed', {
            resultCount: Object.keys(additionalResults).length,
            results: Object.keys(additionalResults),
          })
        } else {
          logger.error('Next node not found', { nextNodeId: nextNodeIds[0] })
        }
      } else {
        logger.info('Executing multiple next nodes in parallel', {
          nextNodeIds,
          hasReporter: !!reporter,
          workflowRunId: workflowRunId || state.executionId,
        })
        // Multiple next nodes - execute in parallel
        additionalResults = await this.executeParallelNodes(
          this.currentWorkflow,
          nextNodeIds,
          contextManager,
          {
            workflowRunId: workflowRunId || state.executionId,
            workflowAppId: options.workflowAppId,
            organizationId: options.organizationId,
            reporter,
          }
        )
        logger.info('Parallel execution completed', {
          resultCount: Object.keys(additionalResults).length,
          results: Object.keys(additionalResults),
        })
      }
      // Merge results
      const finalResults = { ...state.nodeResults, ...additionalResults }
      return await this.completeExecution(
        state.executionId,
        contextManager,
        finalResults,
        WorkflowExecutionStatus.COMPLETED,
        undefined,
        { reporter, workflowRunId }
      )
    } catch (error) {
      logger.error('Failed to resume workflow execution', {
        executionId: state.executionId,
        error: error instanceof Error ? error.message : String(error),
      })
      return await this.completeExecution(
        state.executionId,
        contextManager,
        state.nodeResults,
        WorkflowExecutionStatus.FAILED,
        error instanceof Error ? error.message : String(error),
        { reporter, workflowRunId }
      )
    }
  }
  /**
   * Load workflow from database
   */
  private async loadWorkflow(workflowId: string): Promise<any> {
    return await db.query.Workflow.findFirst({
      where: eq(schema.Workflow.id, workflowId),
    })
  }
  /**
   * Complete workflow execution and emit completion events
   */
  private async completeExecution(
    executionId: string,
    contextManager: ExecutionContextManager,
    nodeResults: Record<string, NodeExecutionResult>,
    status: WorkflowExecutionStatus,
    error?: string,
    options?: {
      reporter?: WorkflowExecutionReporter
      workflowRunId?: string
    }
  ): Promise<WorkflowExecutionResult> {
    const context = contextManager.getContext()
    const completedAt = new Date()
    // Emit workflow completion events if reporter is provided
    if (options?.reporter && options?.workflowRunId) {
      if (status === WorkflowExecutionStatus.COMPLETED) {
        logger.info('Emitting WORKFLOW_FINISHED event', {
          executionId,
          workflowId: context.workflowId,
          workflowRunId: options.workflowRunId,
        })
        await options.reporter.emit(WorkflowEventType.WORKFLOW_FINISHED, {
          id: options.workflowRunId,
          workflowId: context.workflowId,
          status: 'succeeded' as const,
          outputs: contextManager.getAllVariables(),
          elapsedTime: (completedAt.getTime() - context.startedAt.getTime()) / 1000, // Convert to seconds
          totalTokens: calculateTotalTokens(nodeResults),
          totalSteps: Object.keys(nodeResults).length,
          createdAt: Math.floor(context.startedAt.getTime() / 1000), // Convert to seconds
          finishedAt: Math.floor(completedAt.getTime() / 1000), // Convert to seconds
        })
      } else if (status === WorkflowExecutionStatus.FAILED) {
        logger.info('Emitting WORKFLOW_FAILED event', {
          executionId,
          workflowId: context.workflowId,
          workflowRunId: options.workflowRunId,
          error,
        })
        await options.reporter.emit(WorkflowEventType.WORKFLOW_FAILED, {
          workflowId: context.workflowId,
          workflowRunId: options.workflowRunId,
          error: error || 'Unknown error',
          failedAt: completedAt,
        })
      }
    }
    // Clean up state
    this.persistenceManager.clearState(executionId)
    return {
      executionId,
      workflowId: context.workflowId,
      status,
      startedAt: context.startedAt,
      completedAt,
      totalExecutionTime: Date.now() - context.startedAt.getTime(),
      nodeResults,
      finalOutput: contextManager.getAllVariables(),
      error,
      context,
    }
  }
  /**
   * Get execution state
   */
  getExecutionState(executionId: string): ExecutionState | undefined {
    return this.persistenceManager.getState(executionId)
  }
}
