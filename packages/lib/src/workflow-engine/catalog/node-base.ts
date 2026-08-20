// packages/lib/src/workflow-engine/catalog/node-base.ts

import { z } from 'zod'
import type { NodeRunningStatus } from '../core/types'

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
 * Runtime/UI state properties for nodes.
 *
 * Every `_`-prefixed member here is DERIVED state (see
 * `catalog/derived-keys.ts`): the canvas initializer writes it on load, the
 * save path strips it, the engine never reads it, and no agent may author it.
 * It is declared on the TS type because canvas code legitimately reads it —
 * but it must never appear in a manifest's `configSchema`, which describes
 * PERSISTED config.
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

  /**
   * Branch handles this node renders, top-to-bottom. Declared ONCE here
   * rather than per node type: five node interfaces used to redeclare it, and
   * `http` additionally required it in its zod schema — a key the save path
   * guarantees will be absent. The authoritative derivation is the manifest's
   * `connection.branches(config)`.
   */
  _targetBranches?: TargetBranch[]
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

  collapsed: z.boolean().optional(),

  // Loop context
  isInLoop: z.boolean().optional(),
  loopId: z.string().optional(),
  isInIteration: z.boolean().optional(),
  iterationId: z.string().optional(),

  // NOTE: the `_`-prefixed runtime/derived keys declared on `NodeRuntimeState`
  // are DELIBERATELY absent from this schema. It validates PERSISTED config,
  // and derived keys are stripped before every save — so declaring them here
  // taught `describe_node_type` to advertise 17 phantom writable fields on
  // most of the catalog, and taught `validateNodeConfigs` to report issues no
  // caller could ever fix. Zod strips unknown keys, so canvas data carrying
  // them still parses. See `catalog/derived-keys.ts`.
})
