// packages/lib/src/workflow-engine/core/types.ts

import type { Database } from '@auxx/database'
import type { ProcessedMessage } from '../types/message'
import type { ExecutionContextManager } from './execution-context'

// Re-export ProcessedMessage for use in this module
export type { ProcessedMessage }
export { ProcessingMode } from '../types/message'

/**
 * Base types supported across the workflow system
 */
export enum BaseType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  OBJECT = 'object',
  ARRAY = 'array',
  DATE = 'date',
  DATETIME = 'datetime',
  TIME = 'time',
  FILE = 'file',
  REFERENCE = 'reference',
  EMAIL = 'email',
  URL = 'url',
  PHONE = 'phone',
  ENUM = 'enum',
  JSON = 'json',
  RELATION = 'relation',
  ACTOR = 'actor',
  SECRET = 'secret',
  ANY = 'any',
  NULL = 'null',
  CURRENCY = 'currency',
  ADDRESS = 'address',
  TAGS = 'tags',
}

/**
 * Grouped BaseType values for UI pickers
 * Used for workflow form-input nodes
 */
export const BASE_TYPE_GROUPS: Record<string, BaseType[]> = {
  Basic: [BaseType.STRING, BaseType.NUMBER, BaseType.BOOLEAN],
  'Text Formats': [BaseType.EMAIL, BaseType.URL, BaseType.PHONE],
  'Date & Time': [BaseType.DATE, BaseType.DATETIME, BaseType.TIME],
  Selection: [BaseType.ENUM, BaseType.TAGS],
  Complex: [BaseType.ADDRESS, BaseType.CURRENCY, BaseType.FILE],
}

/**
 * Workflow trigger types - Simplified operation-based triggers
 * Separates operation (when/how) from entity (what)
 */
export enum WorkflowTriggerType {
  // Form-based workflow (no specific resource context)
  FORM = 'form',

  // Webhook trigger
  WEBHOOK = 'webhook',

  // Resource-based triggers
  MANUAL = 'manual', // Triggered manually from UI on a specific record
  CREATED = 'created', // Triggered when resource is created
  UPDATED = 'updated', // Triggered when resource is updated
  DELETED = 'deleted', // Triggered when resource is deleted

  // Time-based trigger
  SCHEDULED = 'scheduled',

  // Message-based trigger (special case - tied to messaging system)
  MESSAGE_RECEIVED = 'message-received',

  // UI-only identifier for resource trigger node (not stored in DB)
  // Actual trigger type comes from the operation field (created/updated/deleted/manual)
  RESOURCE_TRIGGER = 'resource-trigger',

  // Extension app trigger (webhook-driven, dispatched via BullMQ)
  APP_TRIGGER = 'app-trigger',

  // Extension app polling trigger (scheduled poll → dispatch via BullMQ)
  APP_POLLING_TRIGGER = 'app-polling-trigger',
}

/**
 * Array of all workflow trigger type values for Zod validation
 */
export const WORKFLOW_TRIGGER_TYPE_VALUES = [
  WorkflowTriggerType.FORM,
  WorkflowTriggerType.WEBHOOK,
  WorkflowTriggerType.MANUAL,
  WorkflowTriggerType.CREATED,
  WorkflowTriggerType.UPDATED,
  WorkflowTriggerType.DELETED,
  WorkflowTriggerType.SCHEDULED,
  WorkflowTriggerType.MESSAGE_RECEIVED,
  WorkflowTriggerType.RESOURCE_TRIGGER,
  WorkflowTriggerType.APP_TRIGGER,
  WorkflowTriggerType.APP_POLLING_TRIGGER,
] as const

/**
 * Human-readable names for workflow trigger types
 * Maps trigger type values to display names
 */
export const TRIGGER_NAME_MAP: Record<WorkflowTriggerType, string> = {
  [WorkflowTriggerType.FORM]: 'Form',
  [WorkflowTriggerType.WEBHOOK]: 'Webhook',
  [WorkflowTriggerType.MANUAL]: 'Manual',
  [WorkflowTriggerType.CREATED]: 'Created',
  [WorkflowTriggerType.UPDATED]: 'Updated',
  [WorkflowTriggerType.DELETED]: 'Deleted',
  [WorkflowTriggerType.SCHEDULED]: 'Scheduled',
  [WorkflowTriggerType.MESSAGE_RECEIVED]: 'Message Received',
  [WorkflowTriggerType.RESOURCE_TRIGGER]: 'Resource Trigger',
  [WorkflowTriggerType.APP_TRIGGER]: 'App Trigger',
  [WorkflowTriggerType.APP_POLLING_TRIGGER]: 'App Polling Trigger',
}

/**
 * Resource trigger operations that map to actual trigger types
 */
export type ResourceTriggerOperation = 'created' | 'updated' | 'deleted' | 'manual'

/**
 * Maps resource trigger operations to actual workflow trigger types
 * Used when saving workflows to convert from UI operation to DB trigger type
 */
export const RESOURCE_OPERATION_TO_TRIGGER_TYPE: Record<
  ResourceTriggerOperation,
  WorkflowTriggerType
> = {
  created: WorkflowTriggerType.CREATED,
  updated: WorkflowTriggerType.UPDATED,
  deleted: WorkflowTriggerType.DELETED,
  manual: WorkflowTriggerType.MANUAL,
}

/**
 * Check if a trigger type is a resource-based trigger
 */
export function isResourceTriggerType(triggerType: string): boolean {
  return [
    WorkflowTriggerType.CREATED,
    WorkflowTriggerType.UPDATED,
    WorkflowTriggerType.DELETED,
    WorkflowTriggerType.MANUAL,
  ].includes(triggerType as WorkflowTriggerType)
}

/**
 * Action and processor node types (non-trigger nodes)
 */
export enum WorkflowActionType {
  // Condition nodes
  IF_ELSE = 'if-else',

  // Action nodes
  ANSWER = 'answer',
  AI = 'ai',
  CODE = 'code',
  EXECUTE = 'execute',
  FIND = 'find',
  CRUD = 'crud',
  TRANSFORM = 'transform',
  TOOL_CALL = 'tool-call',
  VARIABLE_SET = 'variable-set',
  HTTP = 'http',

  // Transform nodes
  TEXT_CLASSIFIER = 'text-classifier',
  INFORMATION_EXTRACTOR = 'information-extractor',
  VAR_ASSIGN = 'var-assign',
  DATE_TIME = 'date-time',
  LIST = 'list',

  // Flow control nodes
  LOOP = 'loop',
  WAIT = 'wait',
  HUMAN_CONFIRMATION = 'human-confirmation',
  END = 'end',

  // Dataset nodes
  DOCUMENT_EXTRACTOR = 'document-extractor',
  CHUNKER = 'chunker',
  DATASET = 'dataset',
  KNOWLEDGE_RETRIEVAL = 'knowledge-retrieval',
}

/**
 * Combined namespace for all workflow node types (triggers + actions)
 * This allows accessing values like WorkflowNodeType.MESSAGE_RECEIVED
 */
export const WorkflowNodeType = {
  ...WorkflowTriggerType,
  ...WorkflowActionType,
} as const

/**
 * Type representing all possible workflow node type values
 */
export type WorkflowNodeType = WorkflowTriggerType | WorkflowActionType

/**
 * Type guard to check if a node type is a trigger
 */
export function isTriggerNodeType(type: WorkflowNodeType): type is WorkflowTriggerType {
  return Object.values(WorkflowTriggerType).includes(type as WorkflowTriggerType)
}

/**
 * Type guard to check if a node type is an action/processor
 */
export function isActionNodeType(type: WorkflowNodeType): type is WorkflowActionType {
  return Object.values(WorkflowActionType).includes(type as WorkflowActionType)
}

/**
 * Node types that are UI-only and should not be validated/executed by the workflow engine.
 * These nodes are configuration or annotation nodes that don't have processors.
 * - Input nodes (form-input, file-upload, number-input) configure manual trigger inputs
 * - Note nodes are visual annotations
 */
export const NON_EXECUTABLE_NODE_TYPES = [
  'form-input',
  'file-upload',
  'number-input',
  'note',
] as const

export type NonExecutableNodeType = (typeof NON_EXECUTABLE_NODE_TYPES)[number]

/**
 * Check if a node type is non-executable (UI-only)
 */
export function isNonExecutableNodeType(type: string): boolean {
  return NON_EXECUTABLE_NODE_TYPES.includes(type as NonExecutableNodeType)
}

/**
 * Workflow execution status
 */
export enum WorkflowExecutionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  PAUSED = 'PAUSED',
}

/**
 * Node execution status
 * This enum is used by both frontend and backend for consistency
 */
export enum NodeRunningStatus {
  Pending = 'pending', // Node hasn't run yet
  Running = 'running', // Node is currently running
  Succeeded = 'succeeded', // Node finished successfully
  Failed = 'failed', // Node finished with an error
  Exception = 'exception', // Node finished and caused an exception
  Skipped = 'skipped', // Node was skipped (branch not taken)
  Stopped = 'stopped', // User manually stopped the workflow
  Waiting = 'waiting', // Special case for wait nodes
  Paused = 'paused', // Node execution is paused
}

/**
 * Node data contains all node-specific configuration in a flattened structure
 * The backend will extract config by removing base node properties
 */
export interface NodeData {
  // Core properties (not part of config)
  id: string
  type: string
  title: string
  desc?: string
  description?: string

  // Visual properties (not part of config)
  icon?: string
  color?: string
  selected?: boolean
  height?: number
  width?: number

  // Runtime state properties (not part of config)
  _isBundled?: boolean
  _inParallelHovering?: boolean
  _isEntering?: boolean
  _isCandidate?: boolean
  _runningStatus?: string
  _waitingRun?: boolean
  _singleRun?: boolean
  _singleRunningStatus?: string
  _runningBranchId?: string
  _retryIndex?: number

  // Connection metadata (not part of config)
  _sourcePosition?: string
  _targetPosition?: string
  _connectedSourceHandleIds?: string[]
  _connectedTargetHandleIds?: string[]

  // Container relationships (not part of config)
  _children?: Array<{ nodeId: string; nodeType: string }>

  // Loop context (not part of config)
  isInLoop?: boolean
  loopId?: string
  isInIteration?: boolean
  iterationId?: string
  _iterationLength?: number
  _iterationIndex?: number
  _loopLength?: number
  _loopIndex?: number

  // Metadata (not part of config)
  metadata?: Record<string, any>
  parentId?: string
  parentNode?: string

  // All other properties are considered part of the node's config
  [key: string]: any
}

/**
 * UI metadata for workflow visualization
 */
export interface NodeMetadata {
  position?: { x: number; y: number }
  color?: string
  icon?: string
  collapsed?: boolean
  notes?: string
}

/**
 * Core workflow node interface
 */
export interface WorkflowNode {
  id: string
  workflowId: string
  nodeId: string // Unique within workflow
  type: WorkflowNodeType
  name: string
  description?: string
  data: NodeData // Node configuration data matching frontend structure
  metadata?: NodeMetadata
}

/**
 * Workflow edge definition for graph-based navigation
 */
export interface WorkflowEdge {
  id: string
  source: string // Source node ID
  target: string // Target node ID
  sourceHandle: string // Output handle name (e.g., 'source', 'true', 'false', 'approved')
  targetHandle: string // Input handle name (usually 'target')
  data?: any // Optional edge metadata
}

/**
 * Workflow graph structure
 */
export interface WorkflowGraph {
  nodes: any[] // Frontend node data (we don't process these)
  edges: WorkflowEdge[]
  viewport?: any // Canvas viewport data
}

/**
 * Workflow definition
 */
export interface Workflow {
  id: string
  workflowId: string
  workflowAppId: string // ID of the workflow app this belongs to
  organizationId: string
  name: string
  description?: string
  enabled: boolean
  version: number
  triggerType: WorkflowTriggerType
  entityDefinitionId?: string // Entity identifier (system or custom) - replaces triggerConfig
  nodes: WorkflowNode[]
  graph?: WorkflowGraph // Graph data from frontend
  envVars?: any[] // Environment variables
  variables?: Record<string, any> // Workflow variables
  createdAt: Date
  updatedAt: Date
  createdById?: string
}

/**
 * Execution context holds variables and state during workflow execution
 */
export interface ExecutionContext {
  workflowId: string
  executionId: string
  organizationId: string
  userId?: string

  // Input data
  message?: ProcessedMessage
  triggerData?: any

  // Variables and state
  variables: Record<string, any>

  // Database connection
  db?: Database

  // Execution metadata
  startedAt: Date
  currentNodeId?: string
  visitedNodes: Set<string>

  // Branch context tracking (V5 enhancement)
  isBranchContext: boolean // Explicit flag instead of string matching
  parentExecutionId?: string // Parent execution ID if this is a branch

  // Join state tracking for parallel execution
  joinStates?: Record<string, JoinState>
  waitingJoin?: string // Join node ID if workflow is waiting at a join
  status?: WorkflowExecutionStatus
  // Debugging and logging
  debug?: boolean
  logs: ExecutionLog[]
}

/**
 * Result of a node execution
 */
export interface NodeExecutionResult {
  nodeId: string
  status: NodeRunningStatus
  output?: any
  processData?: any
  error?: string

  // Handle-based routing
  outputHandle?: string // Single output handle (e.g., 'source', 'true', 'approved')
  // outputHandles?: string[] // Multiple output handles for parallel execution (future use)

  // Direct node routing
  nextNodeId?: string // Direct next node ID for routing (used by some nodes like human-confirmation in test mode)

  executionTime: number
  metadata?: Record<string, any>
  pauseReason?: PauseReason // Reason for pausing if status is Paused
}

/**
 * Complete workflow execution result
 */
export interface WorkflowExecutionResult {
  executionId: string
  workflowId: string
  status: WorkflowExecutionStatus
  startedAt: Date
  completedAt?: Date
  totalExecutionTime: number
  nodeResults: Record<string, NodeExecutionResult>
  finalOutput?: any
  error?: string
  context: ExecutionContext
}

/**
 * Execution log entry
 */
export interface ExecutionLog {
  timestamp: Date
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  nodeId?: string
  message: string
  data?: any
}

/**
 * Workflow trigger event
 */
export interface WorkflowTriggerEvent {
  type: WorkflowTriggerType
  data: any
  timestamp: Date
  organizationId: string
  userId?: string
  userEmail?: string
  userName?: string
  organizationName?: string
  organizationHandle?: string
}

/**
 * Preprocessed node data interface
 * Contains inputs and metadata extracted during node preprocessing
 */
export interface PreprocessedNodeData {
  inputs: Record<string, any>
  metadata?: Record<string, any>
}

/**
 * Base interface for all node processors
 */
export interface NodeProcessor {
  readonly type: WorkflowNodeType | string // string supports app blocks (format: "appId:blockId")

  /**
   * Preprocess node to extract relevant inputs and metadata
   */
  preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData>

  /**
   * Execute the node with the given context manager
   */
  execute(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<NodeExecutionResult>

  /**
   * Validate node configuration
   */
  validate(node: WorkflowNode): Promise<ValidationResult>
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Workflow builder interface for programmatically creating workflows
 */
export interface WorkflowBuilder {
  setName(name: string): WorkflowBuilder
  setDescription(description: string): WorkflowBuilder
  setTrigger(type: WorkflowTriggerType, entityDefinitionId?: string): WorkflowBuilder
  addNode(node: Omit<WorkflowNode, 'id' | 'workflowId'>): WorkflowBuilder
  connect(fromNodeId: string, toNodeId: string, connectionType?: string): WorkflowBuilder
  build(): Workflow
}

/**
 * Workflow execution options
 */
export interface WorkflowExecutionOptions {
  debug?: boolean
  timeout?: number
  variables?: Record<string, any>
  skipValidation?: boolean
  skipCache?: boolean // Skip graph cache and rebuild
  dryRun?: boolean
  workflowRunId?: string // Added for cancellation tracking
  organizationId?: string // Organization ID for context
  workflowAppId?: string // Workflow app ID for node execution tracking
  useBatchedJoinUpdates?: boolean // Enable batched updates for high-throughput scenarios
  reporter?: import('../execution-reporter').WorkflowExecutionReporter // Optional reporter for events

  /**
   * Variable validation mode
   * - 'strict': Fail execution if required variables are missing
   * - 'warn': Log warning but continue execution (backward compatible)
   * - 'off': No validation (for performance-critical paths)
   *
   * Default: 'warn' for backward compatibility
   */
  variableValidationMode?: 'strict' | 'warn' | 'off'

  // Fork/branch execution context for tracking parallel execution
  forkContext?: {
    forkId: string
    branchIndex: number
    executionPath: string
  }

  // Event callbacks for real-time execution tracking
  onNodeStart?: (
    nodeId: string,
    node: WorkflowNode,
    context: ExecutionContext
  ) => void | Promise<void>
  onNodeComplete?: (
    nodeId: string,
    result: NodeExecutionResult,
    context: ExecutionContext
  ) => void | Promise<void>
  onNodeError?: (nodeId: string, error: Error, context: ExecutionContext) => void | Promise<void>
}

/**
 * Workflow statistics
 */
export interface WorkflowStats {
  totalExecutions: number
  successfulExecutions: number
  failedExecutions: number
  averageExecutionTime: number
  lastExecuted?: Date
  executionsByStatus: Record<WorkflowExecutionStatus, number>
}

/**
 * Execution state for pause/resume functionality
 */
export interface ExecutionState {
  executionId: string
  workflowId: string
  status: WorkflowExecutionStatus
  currentNodeId: string | null
  visitedNodes: Set<string>
  nodeResults: Record<string, NodeExecutionResult>
  context: StoredExecutionContext
  startedAt: Date
  pausedAt?: Date
  pauseReason?: PauseReason
  resumeData?: any

  /**
   * Execution tracking fields for maintaining state across pause/resume
   * These fields preserve depth tracking and execution order
   */
  executionTracking?: {
    executionCounter: number
    lastExecutedNodeId: string | null
    currentDepth: number
    // Fork/branch context for parallel execution tracking
    forkContext?: {
      forkId?: string
      branchIndex?: number
      executionPath?: string
    }
  }
}

/**
 * Stored execution context (serializable)
 */
export interface StoredExecutionContext {
  variables: Record<string, any>
  systemVariables: Record<string, any>
  nodeVariables: Record<string, Record<string, any>>
  logs: ExecutionLog[]
  executionPath: string[]

  // V5 enhancement: Persist join states for recovery
  joinStates?: Record<string, any> // JoinState.toJSON() output
  waitingJoin?: string // Join node ID if workflow is waiting

  // V5 enhancement: Preserve branch context flags
  isBranchContext?: boolean
  parentExecutionId?: string
}

/**
 * Reason for pausing execution
 */
export interface PauseReason {
  type:
    | 'human_confirmation'
    | 'wait'
    | 'error'
    | 'user_requested'
    | 'all_branches_paused' // V5: All parallel branches paused at join
    | 'nested_branch_pause' // V5: Nested fork waiting for paused branches
    | 'document_processing' // Waiting for embeddings to complete (Dataset node)
  nodeId: string
  message?: string
  metadata?: any
}

/**
 * Options for resuming execution
 */
export interface ResumeOptions {
  fromNodeId: string
  nodeOutput?: any
  variables?: Record<string, any>
  skipValidation?: boolean
  workflowRunId?: string
  workflowAppId?: string // Required for creating node execution records
  organizationId?: string // Required for creating node execution records
  reporter?: import('../execution-reporter').WorkflowExecutionReporter
}

/**
 * Exception thrown when workflow is paused
 */
export class WorkflowPausedException extends Error {
  constructor(public state: ExecutionState) {
    super('Workflow execution paused')
    this.name = 'WorkflowPausedException'
  }
}

/**
 * Fork point information for parallel branch detection
 */
export interface ForkPointInfo {
  nodeId: string
  outputHandle: string
  branchNodeIds: string[] // Direct targets of the fork
  joinNodeId?: string // The convergence point for these branches
}

/**
 * Join point information for branch convergence
 */
export interface JoinPointInfo {
  nodeId: string
  expectedInputs: Set<string> // Direct predecessor node IDs
  joinType: 'all' | 'any' | 'count' | 'timeout'
  requiredCount?: number // For 'count' type
  timeout?: number // For 'timeout' type (ms)
  mergeStrategy?: MergeStrategy // How to merge branch results
  errorHandling?: {
    minSuccessfulBranches?: number
    continueOnError?: boolean
    aggregateErrors?: boolean
  }
}

/**
 * Execution pattern types for workflow analysis
 */
export enum ExecutionPattern {
  SEQUENTIAL = 'sequential', // A → B → C
  DIAMOND = 'diamond', // A → [B, C] → D (fork-join)
  PANNING_OUT = 'panning-out', // A → [B, C, D] (fork only)
  NESTED_DIAMOND = 'nested-diamond', // Diamond within diamond
  CASCADE = 'cascade', // Multiple sequential diamonds
  COMPLEX = 'complex', // Mixed patterns
}

/**
 * Fork execution strategy configuration
 */
export interface ForkExecutionStrategy {
  pattern: ExecutionPattern
  executionMode: 'fire-and-forget' | 'wait-and-merge' | 'async-converge'
  branchConfig: {
    isolationLevel: 'full' | 'partial' | 'shared'
    errorPropagation: 'fail-fast' | 'collect-all' | 'best-effort'
    timeoutBehavior: 'wait-all' | 'timeout-individual' | 'timeout-global'
  }
}

/**
 * Strategy for merging branch results at join points
 */
export interface MergeStrategy {
  type: 'last-write' | 'first-write' | 'merge-all' | 'custom'
  conflictResolution?: 'error' | 'warn' | 'ignore' | 'last-wins' | 'first-wins' | 'custom'
  customMerger?: (results: BranchResult[]) => any
  conflictResolver?: (key: string, values: any[]) => any
}

/**
 * Result from a parallel branch execution
 */
/**
 * Extended Error type with optional code property
 * Used for branch execution errors
 */
export interface BranchError extends Error {
  code?: string
}

export interface BranchResult {
  branchNodeId: string
  status: 'success' | 'error' | 'timeout' | 'paused' | 'failed'
  completedAt?: Date

  // Success case
  output?: NodeExecutionResult
  contextChanges?: Record<string, any> // Variables set by the branch

  // Error case
  error?: BranchError

  // Pause case (V5 enhancement)
  pauseState?: ExecutionState

  // Metrics
  executionTime?: number
  nodesExecuted?: number
}

/**
 * Result of branch convergence analysis (V5 enhancement)
 * Simplified 3-state model
 */
export interface BranchConvergenceResult {
  joinNodeId: string
  joinState: JoinState

  // Simplified: 3 states instead of 4
  state: 'converged' | 'waiting' | 'all-paused'
  // converged: Can execute join now
  // waiting: Some branches paused, can't proceed yet (main loop returns, no pause)
  // all-paused: All branches paused (emit WORKFLOW_PAUSED)

  // Branch tracking
  completedBranchIds: string[]
  pausedBranchIds: string[]
  failedBranchIds: string[]
  arrivedBranchIds: string[]

  // For diagnostics
  pauseExceptions?: WorkflowPausedException[]
  errors?: Error[]
}

/**
 * Join state for tracking branch convergence
 * V5 enhancement: Converted to class with serialization methods
 */
export class JoinState {
  joinNodeId: string
  forkNodeId: string
  expectedInputs: Set<string>
  completedInputs: Set<string>
  branchResults: Record<string, BranchResult>
  startedAt: Date

  constructor(joinNodeId: string, forkNodeId: string, expectedInputs: string[]) {
    this.joinNodeId = joinNodeId
    this.forkNodeId = forkNodeId
    this.expectedInputs = new Set(expectedInputs)
    this.completedInputs = new Set()
    this.branchResults = {}
    this.startedAt = new Date()
  }

  /**
   * Mark a branch as arrived at the join point
   * Returns true if all expected branches have now arrived
   */
  markBranchAsArrived(branchId: string, result: BranchResult): boolean {
    if (!this.expectedInputs.has(branchId)) {
      throw new Error(`Branch ${branchId} was not expected at join ${this.joinNodeId}`)
    }

    this.completedInputs.add(branchId)
    this.branchResults[branchId] = result

    return this.completedInputs.size === this.expectedInputs.size
  }

  /**
   * Check if all expected branches have arrived
   */
  isComplete(): boolean {
    return this.completedInputs.size === this.expectedInputs.size
  }

  /**
   * Get branches that haven't arrived yet
   */
  getPendingBranches(): string[] {
    return Array.from(this.expectedInputs).filter((id) => !this.completedInputs.has(id))
  }

  /**
   * Serialize to JSON for database storage
   */
  toJSON(): any {
    return {
      joinNodeId: this.joinNodeId,
      forkNodeId: this.forkNodeId,
      expectedInputs: Array.from(this.expectedInputs),
      completedInputs: Array.from(this.completedInputs),
      branchResults: this.branchResults,
      startedAt: this.startedAt.toISOString(),
    }
  }

  /**
   * Deserialize from JSON (database recovery)
   */
  static fromJSON(data: any): JoinState {
    const state = new JoinState(data.joinNodeId, data.forkNodeId, data.expectedInputs)
    state.completedInputs = new Set(data.completedInputs)
    state.branchResults = data.branchResults
    state.startedAt = new Date(data.startedAt)
    return state
  }
}
