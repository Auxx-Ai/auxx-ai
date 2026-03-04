// packages/lib/src/workflows/workflow-execution-service.ts

import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq, gt, gte, lt, lte, or } from 'drizzle-orm'
import { getQueue, Queues } from '../jobs/queues'
import { SystemUserService } from '../users/system-user-service'
import { calculateTotalTokens } from '../workflow-engine/core/execution-utils'
import { executeSingleNode } from '../workflow-engine/core/single-node-executor'
import type {
  NodeExecutionResult,
  PauseReason,
  StoredExecutionContext,
} from '../workflow-engine/core/types'
import {
  type ExecutionState,
  JoinState, // V5: Added for join state deserialization
  NodeRunningStatus,
  WorkflowPausedException,
} from '../workflow-engine/core/types'
import { WorkflowEngine } from '../workflow-engine/core/workflow-engine'
import { WorkflowGraphBuilder } from '../workflow-engine/core/workflow-graph-builder'
import { RedisWorkflowExecutionReporter } from '../workflow-engine/execution-reporter'
import { ApprovalQueryService } from '../workflow-engine/services/approval-query-service'
import { WorkflowEventType } from '../workflow-engine/shared/types'
import {
  type ErrorHandler,
  type ListRunOptions,
  NodeTriggerSource,
  type PaginatedResult,
  // type RunWorkflowParams,
  type RunNodeParams,
  type WorkflowExecutionError,
  WorkflowExecutionStatus,
  type WorkflowNode,
  type WorkflowNodeExecution,
  type WorkflowRun,
  WorkflowRunStatus,
  type WorkflowRunWithDetails,
  type WorkflowTriggerEvent,
  WorkflowTriggerSource,
  WorkflowTriggerType,
} from './types'

type SerializedExecutionState = {
  executionId: string
  workflowId: string
  status: WorkflowExecutionStatus
  currentNodeId: string | null
  visitedNodes: string[]
  nodeResults: Record<string, NodeExecutionResult>
  context: StoredExecutionContext
  startedAt: Date
  pausedAt?: Date
  pauseReason?: PauseReason
  resumeData?: any
  executionTracking?: any
  // Legacy fields for compatibility
  variables: Record<string, any>
  systemVariables: Record<string, any>
  nodeVariables: Record<string, Record<string, any>>
  logs: any[]
  executionPath: string[]
}

const logger = createScopedLogger('workflow-execution-service')

export interface WorkflowExecutionServiceOptions {
  errorHandler?: ErrorHandler
}

export class WorkflowExecutionService {
  private workflowEngine: WorkflowEngine
  private executingWorkflows = new Map<
    string,
    { startTime: Date; timeout?: NodeJS.Timeout; executionId?: string }
  >()
  private initPromise: Promise<void>
  private errorHandler?: ErrorHandler

  constructor(
    private db: Database = database,
    options: WorkflowExecutionServiceOptions = {}
  ) {
    this.errorHandler = options.errorHandler
    this.workflowEngine = new WorkflowEngine()

    // Initialize workflow engine with default processors
    this.initPromise = this.initializeEngine()
  }

  /**
   * Throw an error using the configured error handler or default behavior
   */
  private throwError(error: WorkflowExecutionError): never {
    if (this.errorHandler) {
      return this.errorHandler(error)
    }
    throw new Error(error.message)
  }

  private async initializeEngine() {
    await this.workflowEngine.getNodeRegistry().initializeWithDefaults()
  }

  /**
   * Create a new workflow run without executing it
   */
  async createRun(params: {
    workflowId: string
    inputs: Record<string, any>
    mode: 'test' | 'production'
    userId: string
    organizationId: string
    userEmail?: string
    userName?: string
  }): Promise<
    Pick<
      WorkflowRun,
      | 'id'
      | 'organizationId'
      | 'workflowAppId'
      | 'workflowId'
      | 'sequenceNumber'
      | 'type'
      | 'triggeredFrom'
      | 'version'
      | 'inputs'
      | 'status'
      | 'totalTokens'
      | 'totalSteps'
      | 'createdBy'
      | 'createdAt'
    >
  > {
    const { workflowId, inputs, mode, userId, organizationId, userEmail, userName } = params

    // Get workflow with validation
    const workflow = await this.db.query.Workflow.findFirst({
      where: (workflows, { eq, and }) =>
        and(eq(workflows.id, workflowId), eq(workflows.organizationId, organizationId)),
      with: {
        workflowApp: true,
      },
    })

    if (!workflow) {
      throw new Error('Workflow not found')
    }
    logger.info('create run:', workflow?.workflowAppId, workflowId, organizationId)

    // Get next sequence number
    const [lastRun] = await this.db
      .select({ sequenceNumber: schema.WorkflowRun.sequenceNumber })
      .from(schema.WorkflowRun)
      .where(eq(schema.WorkflowRun.workflowAppId, workflow.workflowAppId))
      .orderBy(desc(schema.WorkflowRun.sequenceNumber))
      .limit(1)
    const sequenceNumber = (lastRun?.sequenceNumber ?? 0) + 1

    // Count nodes for progress tracking
    const graph = WorkflowGraphBuilder.buildGraph(workflow)
    const nodeCount = graph.nodes.size

    // Create WorkflowRun record
    const effectiveUserId =
      userId || (await SystemUserService.getSystemUserForActions(organizationId))

    const [workflowRun] = await this.db
      .insert(schema.WorkflowRun)
      .values({
        organizationId,
        workflowAppId: workflow.workflowAppId,
        workflowId,
        sequenceNumber,
        type: workflow.triggerType || WorkflowTriggerType.MANUAL,
        triggeredFrom:
          mode === 'production' ? WorkflowTriggerSource.APP_RUN : WorkflowTriggerSource.DEBUGGING,
        version: workflow.version.toString(),
        graph: workflow.graph || {},
        inputs,
        status: WorkflowRunStatus.RUNNING,
        totalTokens: 0,
        totalSteps: nodeCount,
        createdBy: effectiveUserId, // Use system user if userId is null
      })
      .returning({
        id: schema.WorkflowRun.id,
        organizationId: schema.WorkflowRun.organizationId,
        workflowAppId: schema.WorkflowRun.workflowAppId,
        workflowId: schema.WorkflowRun.workflowId,
        sequenceNumber: schema.WorkflowRun.sequenceNumber,
        type: schema.WorkflowRun.type,
        triggeredFrom: schema.WorkflowRun.triggeredFrom,
        version: schema.WorkflowRun.version,
        inputs: schema.WorkflowRun.inputs,
        status: schema.WorkflowRun.status,
        totalTokens: schema.WorkflowRun.totalTokens,
        totalSteps: schema.WorkflowRun.totalSteps,
        createdBy: schema.WorkflowRun.createdBy,
        createdAt: schema.WorkflowRun.createdAt,
      })

    return workflowRun!
  }

  /**
   * Execute workflow asynchronously with optional reporter for events
   */
  async executeWorkflowAsync(
    workflowRun: WorkflowRun,
    reporter?: RedisWorkflowExecutionReporter,
    userEmail?: string,
    userName?: string
  ): Promise<void> {
    try {
      // Get workflow details
      const [workflow] = await this.db
        .select()
        .from(schema.Workflow)
        .where(eq(schema.Workflow.id, workflowRun.workflowId))
        .limit(1)

      if (!workflow) {
        throw new Error('Workflow not found')
      }

      // Get organization details
      const [organization] = await this.db
        .select({
          name: schema.Organization.name,
          handle: schema.Organization.handle,
        })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, workflowRun.organizationId))
        .limit(1)

      // Create trigger event
      const triggerEvent: WorkflowTriggerEvent = {
        type: workflow.triggerType || WorkflowTriggerType.MANUAL,
        data: workflowRun.inputs as Record<string, any>,
        timestamp: new Date(),
        organizationId: workflowRun.organizationId,
        userId: workflowRun.createdBy,
        userEmail: userEmail || undefined,
        userName: userName || undefined,
        organizationName: organization?.name || undefined,
        organizationHandle: organization?.handle || undefined,
      }

      // Execute workflow with optional reporter
      const result = await this.workflowEngine.executeWorkflow(workflow, triggerEvent, {
        debug: workflowRun.triggeredFrom === WorkflowTriggerSource.DEBUGGING,
        organizationId: workflowRun.organizationId,
        workflowRunId: workflowRun.id,
        workflowAppId: workflowRun.workflowAppId,
        reporter, // Pass reporter to engine
      })
      const createdAt = new Date(workflowRun.createdAt)

      // Update workflow run with results
      await this.db
        .update(schema.WorkflowRun)
        .set({
          outputs: result.context?.variables || {},
          status:
            result.status === WorkflowExecutionStatus.COMPLETED
              ? WorkflowRunStatus.SUCCEEDED
              : WorkflowRunStatus.FAILED,
          error: result.error,
          elapsedTime: (Date.now() - createdAt.getTime()) / 1000,
          finishedAt: new Date(),
          totalTokens: calculateTotalTokens(result.nodeResults),
        })
        .where(eq(schema.WorkflowRun.id, workflowRun.id))
    } catch (error) {
      if (error instanceof WorkflowPausedException) {
        // Handle workflow pause correctly - this is expected behavior, not an error
        await this.db
          .update(schema.WorkflowRun)
          .set({
            status: WorkflowRunStatus.WAITING,
            pausedAt: new Date(),
            pausedNodeId: error.state.currentNodeId,
            serializedState: this.serializeExecutionState(error.state),
          })
          .where(eq(schema.WorkflowRun.id, workflowRun.id))

        // Note: Pause events are already emitted by the workflow engine

        // Don't treat pause as error - return normally
        logger.info('Workflow execution paused', {
          workflowRunId: workflowRun.id,
          nodeId: error.state.currentNodeId,
          reason: error.state.pauseReason?.type,
        })
        return
      }

      // Handle real errors
      await this.db
        .update(schema.WorkflowRun)
        .set({
          status: WorkflowRunStatus.FAILED,
          error: error instanceof Error ? error.message : 'Unknown error',
          finishedAt: new Date(),
        })
        .where(eq(schema.WorkflowRun.id, workflowRun.id))
      throw error
    }
  }

  /**
   * Run a single node
   */
  async runSingleNode(params: RunNodeParams): Promise<WorkflowNodeExecution> {
    const { workflowAppId, workflowId, nodeId, inputs, userId, organizationId } = params

    try {
      // Ensure the workflow engine is initialized
      await this.initPromise

      // Get workflow with graph data
      const [workflow] = await this.db
        .select()
        .from(schema.Workflow)
        .where(
          and(
            eq(schema.Workflow.id, workflowId),
            eq(schema.Workflow.workflowAppId, workflowAppId),
            eq(schema.Workflow.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!workflow) {
        logger.warn('Workflow not found', { workflowId, workflowAppId, organizationId })
        throw new Error('Workflow not found')
      }

      // Get organization details for execution context (name + handle required by app blocks)
      const [organization] = await this.db
        .select({
          name: schema.Organization.name,
          handle: schema.Organization.handle,
        })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, organizationId))
        .limit(1)

      // Build graph to find node (engine handles all transformation)
      const graph = WorkflowGraphBuilder.buildGraph(workflow)
      const graphNode = graph.nodes.get(nodeId)

      if (!graphNode) {
        logger.warn('Node not found', { workflowId, workflowAppId, organizationId })
        throw new Error('Node not found in workflow')
      }

      // Convert GraphNode to WorkflowNode format for execution
      const node: WorkflowNode = {
        id: graphNode.id,
        workflowId: workflow.id,
        nodeId: graphNode.id,
        type: graphNode.type,
        name: graphNode.data?.title || graphNode.data?.name || 'Untitled',
        description: graphNode.data?.description,
        data: graphNode.data || {},
        // connections: {},
        metadata: graphNode.data?.metadata || {},
      }

      // Convert array format to Record for engine and storage
      const processedInputs = inputs.reduce(
        (acc, input) => {
          acc[input.variableId] = input.value
          return acc
        },
        {} as Record<string, any>
      )

      // Store the structured inputs metadata for analytics/debugging
      const inputMetadata = inputs.map((input) => ({
        variableId: input.variableId,
        nodeId: input.nodeId,
        type: input.type,
        lastUpdated: input.lastUpdated,
      }))

      // Create a standalone node execution record
      const effectiveUserId =
        userId || (await SystemUserService.getSystemUserForActions(organizationId))

      const [nodeExecution] = await this.db
        .insert(schema.WorkflowNodeExecution)
        .values({
          organizationId,
          workflowAppId,
          workflowId,
          workflowRunId: null, // No associated workflow run
          triggeredFrom: NodeTriggerSource.SINGLE_STEP,
          index: 1,
          nodeId,
          nodeType: node.type,
          title: node.name,
          inputs: processedInputs, // Store as Record for compatibility
          status: NodeRunningStatus.Running as any,
          createdById: effectiveUserId, // Use system user if userId is null
          executionMetadata: { inputMetadata }, // Store metadata separately
        })
        .returning()

      // Get node processor (registry already initialized in constructor)
      const nodeRegistry = this.workflowEngine.getNodeRegistry()
      const processor = nodeRegistry.getProcessor(node.type)

      if (!processor) {
        throw new Error(`No processor found for node type: ${node.type}`)
      }

      // Execute the node using standalone executeSingleNode function
      const startTime = Date.now()

      try {
        // Use standalone executeSingleNode with initialized registry
        const result = await executeSingleNode(
          node,
          processedInputs,
          {
            workflowId,
            executionId: `node-${nodeId}-${Date.now()}`,
            organizationId,
            userId,
            userEmail: params.userEmail,
            userName: params.userName,
            organizationName: params.organizationName ?? organization?.name,
            organizationHandle: params.organizationHandle ?? organization?.handle,
          },
          this.workflowEngine.getNodeRegistry(),
          workflow,
          this.db
        )

        const endTime = Date.now()
        const elapsedTime = (endTime - startTime) / 1000

        // Update node execution with results
        const [updatedExecution] = await this.db
          .update(schema.WorkflowNodeExecution)
          .set({
            outputs: result.outputs || null,
            processData: result.processData || null,
            status: NodeRunningStatus.Succeeded as any,
            error: null,
            elapsedTime,
            finishedAt: new Date(),
            executionMetadata: undefined,
          })
          .where(eq(schema.WorkflowNodeExecution.id, nodeExecution!.id))
          .returning()

        return updatedExecution
      } catch (executionError) {
        const elapsedTime = (Date.now() - startTime) / 1000

        // BlockValidationError — store structured field data and return instead of
        // throwing so the frontend onSuccess handler can surface per-field messages.
        if (
          executionError instanceof Error &&
          (executionError as any).name === 'BlockValidationError'
        ) {
          const fields = (executionError as any).fields as Array<{
            field: string
            message: string
          }>
          const [updatedExecution] = await this.db
            .update(schema.WorkflowNodeExecution)
            .set({
              status: NodeRunningStatus.Failed as any,
              error: executionError.message,
              elapsedTime,
              finishedAt: new Date(),
              executionMetadata: {
                validationError: { fields, message: executionError.message },
              },
            })
            .where(eq(schema.WorkflowNodeExecution.id, nodeExecution!.id))
            .returning()
          return updatedExecution!
        }

        // BlockRuntimeError — store as a failed execution with runtime error metadata.
        // Return instead of re-throwing so the frontend onSuccess handler can render
        // the app error differently from a platform crash.
        if (
          executionError instanceof Error &&
          (executionError as any).name === 'BlockRuntimeError'
        ) {
          const [updatedExecution] = await this.db
            .update(schema.WorkflowNodeExecution)
            .set({
              status: NodeRunningStatus.Failed as any,
              error: executionError.message,
              elapsedTime,
              finishedAt: new Date(),
              executionMetadata: {
                runtimeError: {
                  message: executionError.message,
                  code: (executionError as any).code,
                },
                consoleLogs: (executionError as any).consoleLogs || [],
              },
            })
            .where(eq(schema.WorkflowNodeExecution.id, nodeExecution!.id))
            .returning()
          return updatedExecution!
        }

        // Unhandled Lambda errors (app threw a plain Error) — store with appError
        // metadata so the frontend can distinguish app failures from platform crashes.
        const errorMessage =
          executionError instanceof Error ? executionError.message : 'Unknown error'
        const isAppError = errorMessage.startsWith('Lambda execution failed:')
        const consoleLogs =
          executionError && typeof executionError === 'object' && 'consoleLogs' in executionError
            ? (executionError as any).consoleLogs || []
            : []

        const [updatedExecution] = await this.db
          .update(schema.WorkflowNodeExecution)
          .set({
            status: NodeRunningStatus.Failed as any,
            error: errorMessage,
            elapsedTime,
            finishedAt: new Date(),
            ...(isAppError && {
              executionMetadata: {
                appError: true,
                consoleLogs,
              },
            }),
          })
          .where(eq(schema.WorkflowNodeExecution.id, nodeExecution!.id))
          .returning()

        // App errors return (shown in result tab), platform errors re-throw (trigger onError)
        if (isAppError) {
          return updatedExecution!
        }
        throw executionError
      }
    } catch (error) {
      logger.error('Failed to run node', { error, nodeId, workflowId, organizationId })
      throw new Error(error instanceof Error ? error.message : 'Failed to run node')
    }
  }

  /**
   * Get workflow run with all details
   */
  async getWorkflowRun(runId: string, organizationId: string): Promise<WorkflowRunWithDetails> {
    const run = await this.db.query.WorkflowRun.findFirst({
      where: and(
        eq(schema.WorkflowRun.id, runId),
        eq(schema.WorkflowRun.organizationId, organizationId)
      ),
      with: {
        workflow: true,
        workflowApp: true,
        createdBy: true,
        nodeExecutions: {
          orderBy: [schema.WorkflowNodeExecution.index],
        },
      },
    })

    if (!run) {
      throw new Error('Workflow run not found')
    }

    return run
  }

  /**
   * Serialize execution state for database storage
   */
  private serializeExecutionState(state: ExecutionState): SerializedExecutionState {
    // V5: Serialize join states using toJSON
    const serializedJoinStates = state.context.joinStates
      ? Object.fromEntries(
          Object.entries(state.context.joinStates).map(([k, v]) => [k, v.toJSON()])
        )
      : undefined

    return {
      executionId: state.executionId,
      workflowId: state.workflowId,
      status: state.status,
      currentNodeId: state.currentNodeId,
      visitedNodes: Array.from(state.visitedNodes),
      nodeResults: state.nodeResults,
      context: {
        ...state.context,
        // V5: Add serialized join states for recovery
        joinStates: serializedJoinStates,
      },
      startedAt: state.startedAt,
      pausedAt: state.pausedAt,
      pauseReason: state.pauseReason,
      resumeData: state.resumeData,
      // Include execution tracking for proper pause/resume depth tracking
      executionTracking: state.executionTracking,
      // Legacy fields for compatibility
      variables: state.context.variables,
      systemVariables: state.context.systemVariables,
      nodeVariables: state.context.nodeVariables,
      logs: state.context.logs,
      executionPath: state.context.executionPath,
    }
  }

  /**
   * Resume a paused workflow from a specific node
   * This is called when manual confirmation nodes are approved/denied or when wait conditions are met
   */
  async resumeWorkflow(workflowRunId: string, fromNodeId: string, nodeOutput?: any): Promise<void> {
    console.log('RESUME WORKFLOW CALLED', workflowRunId, fromNodeId, nodeOutput)
    try {
      // Ensure engine is initialized
      await this.initPromise

      logger.info('Starting workflow resume', { workflowRunId, fromNodeId, nodeOutput })

      // Load complete workflow run data with all relationships
      const workflowRun = await this.db.query.WorkflowRun.findFirst({
        where: eq(schema.WorkflowRun.id, workflowRunId),
        with: {
          workflow: true,
          createdBy: {
            columns: { email: true, name: true },
          },
        },
      })

      if (!workflowRun) {
        throw new Error(`Workflow run not found: ${workflowRunId}`)
      }

      if (workflowRun.status !== WorkflowRunStatus.WAITING) {
        logger.warn('Attempted to resume workflow not in WAITING status', {
          workflowRunId,
          currentStatus: workflowRun.status,
          fromNodeId,
        })
        throw new Error(`Cannot resume workflow in status ${workflowRun.status}`)
      }

      // Validate serialized state exists
      if (!workflowRun.serializedState) {
        throw new Error(`No serialized state found for workflow run: ${workflowRunId}`)
      }

      // Get organization details for context
      const [organization] = await this.db
        .select({
          name: schema.Organization.name,
          handle: schema.Organization.handle,
        })
        .from(schema.Organization)
        .where(eq(schema.Organization.id, workflowRun.organizationId))
        .limit(1)

      // Deserialize execution state using proper deserialization
      const serializedState = workflowRun.serializedState as SerializedExecutionState

      // V5: Deserialize join states from JSON
      const joinStates =
        serializedState?.context?.joinStates || serializedState?.joinStates
          ? Object.fromEntries(
              Object.entries(
                (serializedState?.context?.joinStates || serializedState?.joinStates) as Record<
                  string,
                  any
                >
              ).map(([k, v]) => [k, JoinState.fromJSON(v)])
            )
          : undefined

      const executionState: ExecutionState = {
        executionId: workflowRun.id,
        workflowId: workflowRun.workflowId,
        status: WorkflowExecutionStatus.PAUSED,
        currentNodeId: fromNodeId,
        visitedNodes: new Set(serializedState?.visitedNodes || []),
        nodeResults: serializedState?.nodeResults || {},
        context: {
          variables: serializedState?.variables || {},
          systemVariables: serializedState?.systemVariables || {},
          nodeVariables: serializedState?.nodeVariables || {},
          logs: serializedState?.logs || [],
          executionPath: serializedState?.executionPath || [],
          // V5: Restore join states
          joinStates,
          // V5: Restore branch context flags
          isBranchContext: serializedState?.context?.isBranchContext || false,
          parentExecutionId: serializedState?.context?.parentExecutionId,
          waitingJoin: serializedState?.context?.waitingJoin,
        },
        startedAt: new Date(workflowRun.createdAt),
        pausedAt: workflowRun.pausedAt ? new Date(workflowRun.pausedAt) : new Date(),
        pauseReason: serializedState?.pauseReason,
        // Restore execution tracking for proper depth continuation
        executionTracking: serializedState?.executionTracking,
        resumeData: {
          resumedAt: new Date(),
          resumedBy: workflowRun.createdBy,
          fromNodeId,
          nodeOutput,
        },
      }

      // Update workflow run status to RUNNING before resuming
      await this.db
        .update(schema.WorkflowRun)
        .set({
          status: WorkflowRunStatus.RUNNING,
          pausedAt: null,
          resumeAt: null,
          pausedNodeId: null,
        })
        .where(eq(schema.WorkflowRun.id, workflowRunId))

      // Create reporter for SSE events during resume
      const reporter = new RedisWorkflowExecutionReporter(workflowRunId)

      // Prepare resume options
      const resumeOptions = {
        fromNodeId,
        nodeOutput,
        variables: {
          resumedAt: new Date().toISOString(),
          resumedBy: workflowRun.createdBy,
        },
        workflowRunId,
        workflowAppId: workflowRun.workflowAppId, // Required for creating node execution records
        organizationId: workflowRun.organizationId, // Required for creating node execution records
        reporter,
        skipValidation: false,
      }

      logger.info('Resuming workflow execution via engine', {
        workflowRunId,
        fromNodeId,
        hasNodeOutput: !!nodeOutput,
      })

      // Resume execution using the workflow engine
      const result = await this.workflowEngine.resumeExecution(executionState, resumeOptions)

      // Handle successful resume - update database with final results
      await this.db
        .update(schema.WorkflowRun)
        .set({
          outputs: result.context?.variables || {},
          status:
            result.status === WorkflowExecutionStatus.COMPLETED
              ? WorkflowRunStatus.SUCCEEDED
              : result.status === WorkflowExecutionStatus.FAILED
                ? WorkflowRunStatus.FAILED
                : WorkflowRunStatus.RUNNING,
          finishedAt:
            result.status === WorkflowExecutionStatus.COMPLETED ||
            result.status === WorkflowExecutionStatus.FAILED
              ? new Date()
              : null,
          error: result.error,
          elapsedTime: (Date.now() - new Date(workflowRun.createdAt).getTime()) / 1000,
          totalTokens: calculateTotalTokens(result.nodeResults),
          // Clear serialized state if workflow completed
          serializedState:
            result.status === WorkflowExecutionStatus.COMPLETED ||
            result.status === WorkflowExecutionStatus.FAILED
              ? null
              : this.serializeExecutionState({
                  ...executionState,
                  status: result.status,
                  context: {
                    ...executionState.context,
                    variables: result.context?.variables || {},
                  },
                }),
        })
        .where(eq(schema.WorkflowRun.id, workflowRunId))

      logger.info('Workflow resume completed successfully', {
        workflowRunId,
        fromNodeId,
        finalStatus: result.status,
      })
    } catch (error) {
      // Handle WorkflowPausedException during resume - this is valid behavior
      if (error instanceof WorkflowPausedException) {
        logger.info('Workflow paused again during resume', {
          workflowRunId,
          fromNodeId,
          pausedAtNode: error.state.currentNodeId,
          reason: error.state.pauseReason?.type,
        })

        // Update database with new pause state
        await this.db
          .update(schema.WorkflowRun)
          .set({
            status: WorkflowRunStatus.WAITING,
            pausedAt: new Date(),
            pausedNodeId: error.state.currentNodeId,
            serializedState: this.serializeExecutionState(error.state),
          })
          .where(eq(schema.WorkflowRun.id, workflowRunId))

        // Resume from pause is considered successful - workflow is properly paused
        return
      }

      // Handle real errors during resume
      logger.error('Failed to resume workflow execution', {
        workflowRunId,
        fromNodeId,
        error: error instanceof Error ? error.message : String(error),
      })

      // Update workflow run with error
      await this.db
        .update(schema.WorkflowRun)
        .set({
          status: WorkflowRunStatus.FAILED,
          error: error instanceof Error ? error.message : 'Unknown error',
          finishedAt: new Date(),
        })
        .where(eq(schema.WorkflowRun.id, workflowRunId))

      throw error
    }
  }

  /**
   * List workflow runs with pagination
   */
  async listWorkflowRuns(
    workflowAppId: string,
    organizationId: string,
    options: ListRunOptions = {}
  ): Promise<PaginatedResult<WorkflowRun>> {
    const { limit = 20, cursor, status, startDate, endDate } = options

    // Build where conditions
    const whereConditions = [
      eq(schema.WorkflowRun.workflowAppId, workflowAppId),
      eq(schema.WorkflowRun.organizationId, organizationId),
    ]

    if (status) {
      whereConditions.push(eq(schema.WorkflowRun.status, status))
    }

    // Resolve cursor bounds for deterministic keyset pagination
    if (cursor) {
      // Fetch cursor run to derive stable keyset pagination bounds
      const cursorRun = await this.db.query.WorkflowRun.findFirst({
        where: and(
          eq(schema.WorkflowRun.id, cursor),
          eq(schema.WorkflowRun.organizationId, organizationId)
        ),
        columns: { createdAt: true, id: true },
      })

      if (cursorRun) {
        whereConditions.push(
          or(
            lt(schema.WorkflowRun.createdAt, cursorRun.createdAt),
            and(
              eq(schema.WorkflowRun.createdAt, cursorRun.createdAt),
              lt(schema.WorkflowRun.id, cursorRun.id)
            )
          )
        )
      }
    }

    if (startDate) {
      whereConditions.push(gte(schema.WorkflowRun.createdAt, startDate))
    }

    if (endDate) {
      whereConditions.push(lte(schema.WorkflowRun.createdAt, endDate))
    }

    const runs = await this.db.query.WorkflowRun.findMany({
      where: and(...whereConditions),
      orderBy: [desc(schema.WorkflowRun.createdAt), desc(schema.WorkflowRun.id)],
      limit: limit + 1,
      with: {
        workflow: {
          columns: { name: true, version: true },
        },
        createdBy: {
          columns: { id: true, name: true, email: true },
        },
      },
    })

    const hasNextPage = runs.length > limit
    const items = hasNextPage ? runs.slice(0, limit) : runs
    const nextCursor = hasNextPage ? items[items.length - 1].id : null

    return { items, nextCursor, hasNextPage }
  }

  /**
   * Subscribe to workflow run events
   * @deprecated SSE connections now handled directly via Redis in the API route
   */
  subscribeToRun(runId: string, response: Response): void {
    // No-op: Redis-based SSE handles this in the API route
    logger.warn('subscribeToRun is deprecated - SSE handled via Redis in API route', { runId })
  }

  /**
   * Unsubscribe from workflow run events
   * @deprecated SSE connections now handled directly via Redis in the API route
   */
  unsubscribeFromRun(runId: string): void {
    // No-op: Redis-based SSE handles this in the API route
    logger.warn('unsubscribeFromRun is deprecated - SSE handled via Redis in API route', { runId })
  }

  /**
   * Stop a workflow run
   */
  async stopWorkflowRun(params: {
    runId: string
    userId: string
    organizationId: string
    reporter?: RedisWorkflowExecutionReporter
  }): Promise<any> {
    const { runId, userId, organizationId, reporter } = params

    logger.info('Stopping workflow run (enhanced)', { runId, userId })

    try {
      // 1. Get the workflow run with validation
      await this.getWorkflowRunWithValidation(runId, organizationId)

      // 2. Cancel scheduled workers FIRST (before status change)
      await this.cancelScheduledWorkers(runId)

      // 3. Signal running workflow engine
      await this.signalWorkflowEngineStop(runId)

      // 4. Update database status
      const updatedRun = await this.updateRunStatusToStopped(runId, userId)

      // 5. Emit stopped events using provided reporter
      await this.emitWorkflowStoppedEvents(runId, userId, reporter)

      // 6. Cleanup execution resources
      await this.cleanupExecutionResources(runId)

      logger.info('Workflow run stopped successfully (enhanced)', { runId })
      return updatedRun
    } catch (error) {
      logger.error('Failed to stop workflow run (enhanced)', { runId, error })
      throw error
    }
  }

  /**
   * Get workflow run with validation for stopping
   */
  private async getWorkflowRunWithValidation(runId: string, organizationId: string) {
    const run = await this.db.query.WorkflowRun.findFirst({
      where: eq(schema.WorkflowRun.id, runId),
      with: { workflow: true },
    })

    if (!run) {
      this.throwError({
        code: 'NOT_FOUND',
        message: 'Workflow run not found',
        statusCode: 404,
      })
    }

    // Check permissions
    if (run?.workflow?.organizationId !== organizationId) {
      this.throwError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to stop this workflow run',
        statusCode: 403,
      })
    }

    // Enhanced status checking - allow stopping more states
    const stoppableStates: string[] = [
      WorkflowRunStatus.RUNNING,
      WorkflowRunStatus.WAITING,
      // Allow stopping paused workflows
    ]

    if (!stoppableStates.includes(run.status)) {
      logger.warn('Attempted to stop workflow with invalid status', {
        runId,
        status: run.status,
      })
      this.throwError({
        code: 'BAD_REQUEST',
        message: `Cannot stop workflow run with status: ${run.status}`,
        statusCode: 400,
      })
    }

    return run
  }

  /**
   * Cancel scheduled workers using database-first approach
   */
  private async cancelScheduledWorkers(runId: string): Promise<void> {
    try {
      // 1. First check database for any scheduled items related to this workflow run
      const [workflowRun, approvalRequests] = await Promise.all([
        // Check if there's a resumeAt scheduled for this workflow run
        this.db.query.WorkflowRun.findFirst({
          where: eq(schema.WorkflowRun.id, runId),
          columns: { resumeAt: true, pausedNodeId: true },
        }),

        // Check for any pending approval requests that may have scheduled jobs
        this.db.query.ApprovalRequest.findMany({
          where: and(
            eq(schema.ApprovalRequest.workflowRunId, runId),
            eq(schema.ApprovalRequest.status, 'pending'),
            gt(schema.ApprovalRequest.expiresAt, new Date())
          ),
          columns: { id: true, expiresAt: true },
        }),
      ])

      logger.info('Found scheduled items in database', {
        runId,
        hasResumeAt: !!workflowRun?.resumeAt,
        pausedNodeId: workflowRun?.pausedNodeId,
        pendingApprovals: approvalRequests.length,
      })

      // 2. Cancel BullMQ jobs based on database findings
      const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
      const cancelledJobs: string[] = []

      // Cancel resume job if workflow is scheduled to resume
      if (workflowRun?.resumeAt) {
        const resumeJobs = await workflowDelayQueue.getJobs(['delayed', 'waiting'], 0, 50)
        const targetResumeJobs = resumeJobs.filter(
          (job) =>
            job.name === 'resumeWorkflowJob' &&
            job.data.workflowRunId === runId &&
            job.data.resumeFromNodeId === workflowRun.pausedNodeId
        )

        for (const job of targetResumeJobs) {
          await job.remove()
          cancelledJobs.push(`resumeWorkflowJob:${job.id}`)
        }
      }

      // Cancel approval-related jobs for each pending approval
      if (approvalRequests.length > 0) {
        const allDelayedJobs = await workflowDelayQueue.getJobs(['delayed', 'waiting'], 0, 100)

        for (const approval of approvalRequests) {
          // Cancel timeout jobs
          const timeoutJobs = allDelayedJobs.filter(
            (job) => job.name === 'approvalTimeoutJob' && job.data.approvalRequestId === approval.id
          )

          // Cancel reminder jobs
          const reminderJobs = allDelayedJobs.filter(
            (job) =>
              job.name === 'approvalReminderJob' && job.data.approvalRequestId === approval.id
          )

          for (const job of [...timeoutJobs, ...reminderJobs]) {
            await job.remove()
            cancelledJobs.push(`${job.name}:${job.id}`)
          }
        }
      }

      logger.info('Cancelled scheduled jobs', {
        runId,
        cancelledCount: cancelledJobs.length,
        cancelledJobs,
      })
    } catch (error) {
      logger.error('Failed to cancel scheduled workers', { runId, error })
      // Don't throw - continue with other stopping mechanisms
    }
  }

  /**
   * Signal the workflow engine to stop
   */
  private async signalWorkflowEngineStop(runId: string): Promise<void> {
    try {
      // Cancel the execution in the workflow engine
      logger.info('Cancelling workflow execution in engine', { runId })
      this.workflowEngine.cancelWorkflowRun(runId)
    } catch (error) {
      logger.error('Failed to signal workflow engine stop', { runId, error })
      // Don't throw - continue with other stopping mechanisms
    }
  }

  /**
   * Update run status to stopped
   */
  private async updateRunStatusToStopped(runId: string, _userId: string) {
    const [updatedRun] = await this.db
      .update(schema.WorkflowRun)
      .set({
        status: WorkflowRunStatus.STOPPED,
        finishedAt: new Date(),
        error: 'Workflow was manually stopped by user',
      })
      .where(eq(schema.WorkflowRun.id, runId))
      .returning()

    return updatedRun
  }

  /**
   * Emit workflow stopped events
   */
  private async emitWorkflowStoppedEvents(
    runId: string,
    userId: string,
    reporter?: RedisWorkflowExecutionReporter
  ): Promise<void> {
    try {
      // Use the provided reporter (modern approach)
      if (reporter) {
        await reporter.emit(WorkflowEventType.WORKFLOW_CANCELLED, {
          workflowRunId: runId,
          cancelledBy: userId,
          cancelledAt: new Date(),
          reason: 'manual_stop',
          message: 'Workflow was manually stopped by user',
        })

        logger.info('Workflow stopped event emitted via reporter', { runId, userId })
      } else {
        // Fallback: create a temporary reporter for the event
        const tempReporter = new RedisWorkflowExecutionReporter(runId)
        await tempReporter.emit(WorkflowEventType.WORKFLOW_CANCELLED, {
          workflowRunId: runId,
          cancelledBy: userId,
          cancelledAt: new Date(),
          reason: 'manual_stop',
          message: 'Workflow was manually stopped by user',
        })

        logger.info('Workflow stopped event emitted via temporary reporter', { runId, userId })
      }
    } catch (error) {
      logger.error('Failed to emit workflow stopped events', { runId, error })
      // Don't throw - the workflow is already stopped
    }
  }

  /**
   * Cleanup execution resources
   */
  private async cleanupExecutionResources(runId: string): Promise<void> {
    try {
      // Clean up any resources
      if (this.executingWorkflows.has(runId)) {
        const execution = this.executingWorkflows.get(runId)
        if (execution?.timeout) {
          clearTimeout(execution.timeout)
        }
        this.executingWorkflows.delete(runId)
      }

      // Clean up pending approval requests for this workflow run
      try {
        const approvalService = new ApprovalQueryService(this.db)
        const cleanedCount = await approvalService.cleanupApprovalsForWorkflowRun(runId)
        if (cleanedCount > 0) {
          logger.info('Cleaned up approval requests during workflow stop', {
            runId,
            cleanedCount,
          })
        }
      } catch (approvalError) {
        logger.error('Failed to cleanup approval requests during workflow stop', {
          runId,
          error: approvalError instanceof Error ? approvalError.message : String(approvalError),
        })
        // Don't throw - this is cleanup, main workflow stop should still succeed
      }

      logger.info('Cleaned up execution resources', { runId })
    } catch (error) {
      logger.error('Failed to cleanup execution resources', { runId, error })
      // Don't throw - this is cleanup
    }
  }
}
