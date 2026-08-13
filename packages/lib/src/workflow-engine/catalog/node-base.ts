// packages/lib/src/workflow-engine/catalog/node-base.ts

import { z } from 'zod'
import { NodeRunningStatus } from '../core/types'

/**
 * The pure half of the builder's node-base types (node-catalog Phase 1):
 * the base data shape every node's persisted `data` carries, and its zod
 * schema. Relocated from apps/web types/node-base.ts, which re-exports these
 * and keeps the React Flow node/edge types (`CommonNodeType`, `FlowNode`,
 * `SpecificNode`, …) plus a `BaseNodeData` narrowing `type` to the web
 * `NodeType` enum. Lib types `type` as `string` — the enum is a web construct;
 * the persisted value is the same string either way.
 */

/**
 * Branch classification for a node's outgoing handles.
 * Relocated from apps/web types/core.ts (which re-exports both).
 */
export type BranchType = 'default' | 'fail'
export type TargetBranch = { id: string; name: string; type: BranchType }

/**
 * Error handling strategy
 */
export enum ErrorHandleType {
  Continue = 'continue',
  Stop = 'stop',
  Retry = 'retry',
}

/**
 * Workflow retry configuration
 */
export interface WorkflowRetryConfig {
  maxRetries: number
  retryInterval: number
  backoffMultiplier?: number
}

/**
 * Connection tracking metadata (derived state — stripped on save,
 * regenerated on load by the workflow initializer)
 */
export interface NodeConnectionMetadata {
  _connectedSourceHandleIds?: string[]
  _connectedTargetHandleIds?: string[]
}

/**
 * Runtime/UI state properties for nodes
 */
export interface NodeRuntimeState extends NodeConnectionMetadata {
  // Selection and UI state
  _isBundled?: boolean
  _inParallelHovering?: boolean
  _isEntering?: boolean
  _isCandidate?: boolean
  collapsed?: boolean // Collapsed state for visual compaction

  // Execution state
  _runningStatus?: NodeRunningStatus
  _waitingRun?: boolean
  _singleRun?: boolean
  _singleRunningStatus?: NodeRunningStatus
  _runningBranchId?: string
  _retryIndex?: number

  // Container relationships
  _children?: { nodeId: string; nodeType: string }[]
}

/**
 * Loop/iteration context for nodes
 */
export interface NodeLoopContext {
  isInLoop?: boolean
  loopId?: string
  isInIteration?: boolean
  iterationId?: string
  _iterationLength?: number
  _iterationIndex?: number
  _loopLength?: number
  _loopIndex?: number
}

/**
 * Base data structure for all workflow nodes.
 * apps/web extends this with `type: NodeType` (its enum narrowing).
 */
export interface BaseNodeData extends NodeRuntimeState, NodeLoopContext {
  // Core properties
  id: string
  type: string
  title: string
  desc?: string
  description?: string // Alias for desc

  // Visual properties
  icon?: string
  color?: string

  // Validation state
  isValid?: boolean
  errors?: string[]
  disabled?: boolean

  // Output tracking
  outputVariables?: string[]

  // Credential connection
  credentialId?: string | null

  // Error handling
  errorStrategy?: ErrorHandleType
  retryConfig?: WorkflowRetryConfig

  // Selection state (from NodeHandleProps)
  selected: boolean

  // Additional properties for React Flow compatibility
  [key: string]: any
}

/**
 * Zod schema for base node data
 * This schema includes all common fields that every node should have
 */
export const baseNodeDataSchema = z.object({
  // Core properties
  id: z.string(),
  type: z.string(),
  title: z.string(),
  desc: z.string().optional(),
  description: z.string().optional(), // Alias for desc

  // Visual properties
  icon: z.string().optional(),
  color: z.string().optional(),

  // Validation state
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),

  // Output tracking
  outputVariables: z.array(z.string()).optional(),

  // Error handling
  errorStrategy: z.enum(ErrorHandleType).optional(),
  retryConfig: z
    .object({
      maxRetries: z.number(),
      retryInterval: z.number(),
      backoffMultiplier: z.number().optional(),
    })
    .optional(),

  // Selection state
  selected: z.boolean().default(false),

  // Runtime state properties (all optional)
  _isBundled: z.boolean().optional(),
  _inParallelHovering: z.boolean().optional(),
  _isEntering: z.boolean().optional(),
  _isCandidate: z.boolean().optional(),
  _runningStatus: z.enum(NodeRunningStatus).optional(),
  _waitingRun: z.boolean().optional(),
  _singleRun: z.boolean().optional(),
  _singleRunningStatus: z.enum(NodeRunningStatus).optional(),
  _runningBranchId: z.string().optional(),
  _retryIndex: z.number().optional(),
  _children: z.array(z.object({ nodeId: z.string(), nodeType: z.string() })).optional(),
  _connectedSourceHandleIds: z.array(z.string()).optional(),
  _connectedTargetHandleIds: z.array(z.string()).optional(),
  collapsed: z.boolean().optional(),

  // Loop context
  isInLoop: z.boolean().optional(),
  loopId: z.string().optional(),
  isInIteration: z.boolean().optional(),
  iterationId: z.string().optional(),
  _iterationLength: z.number().optional(),
  _iterationIndex: z.number().optional(),
  _loopLength: z.number().optional(),
  _loopIndex: z.number().optional(),
})
