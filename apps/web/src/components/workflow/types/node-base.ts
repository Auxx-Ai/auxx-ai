// apps/web/src/components/workflow/types/node-base.ts

import type {
  Node as ReactFlowNode,
  Edge as ReactFlowEdge,
  XYPosition,
  Position,
} from '@xyflow/react'
import type { NodeType } from './node-types'
import { z } from 'zod'
import { NodeRunningStatus } from '@auxx/lib/workflow-engine/types'

// Re-export for convenience
export { NodeRunningStatus }

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
 * Base configuration that all node configs must extend
 * @deprecated This interface is being phased out as configs are flattened into node data
 */
export interface BaseNodeConfig {
  title: string
  description?: string
}

/**
 * Connection tracking metadata
 * Properties from ui/node-handle/types.ts
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
 * Base data structure for all workflow nodes
 * Consolidates properties from multiple locations
 */
export interface BaseNodeData extends NodeRuntimeState, NodeLoopContext {
  // Core properties
  id: string
  type: NodeType
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
 * Edge data structure
 * Moved from edges/custom-edge/types.ts
 */
export interface EdgeData {
  // Node type information
  sourceType?: string
  targetType?: string

  // Loop context
  isInIteration?: boolean
  isInLoop?: boolean
  isLoopBackEdge?: boolean
  loopId?: string

  // UI state
  _hovering?: boolean
  _connectedNodeIsHovering?: boolean
  _connectedNodeIsSelected?: boolean
  _isBundled?: boolean

  // Execution state
  _waitingRun?: boolean
  _sourceRunningStatus?: NodeRunningStatus
  _targetRunningStatus?: NodeRunningStatus

  // Allow additional properties for React Flow compatibility
  [key: string]: any
}

/**
 * Common node type that combines React Flow properties with our data
 * Based on actual React Flow node structure
 */
export type CommonNodeType<TData extends BaseNodeData = BaseNodeData> = {
  id: string
  selected?: boolean
  isConnectable?: boolean
  parentId?: string
  type?: string // Node type as string
  width?: number
  height?: number
  position: XYPosition
  positionAbsolute?: XYPosition
  positionAbsoluteX?: number
  positionAbsoluteY?: number
  sourcePosition?: Position
  targetPosition?: Position
  zIndex?: number
  selectable?: boolean
  draggable?: boolean
  deletable?: boolean
  dragging?: boolean
  data: TData
}

/**
 * Common edge type
 * Moved from edges/custom-edge/types.ts
 */
export type Edge = ReactFlowEdge<EdgeData>

/**
 * Type alias for better clarity
 */
export type FlowNode = CommonNodeType<BaseNodeData>
export type FlowEdge = Edge

/**
 * Selected node helper type
 */
export type SelectedNode = Pick<FlowNode, 'id' | 'data'>

/**
 * Node component props
 */
export type NodeProps<T extends BaseNodeData = BaseNodeData> = { id: string; data: T }

/**
 * Full node type for React Flow (legacy - use FlowNode instead)
 * @deprecated Use FlowNode for new implementations
 */
export type WorkflowNode = ReactFlowNode<BaseNodeData>

/**
 * Type guard to check if a node is a workflow node
 */
export function isWorkflowNode(node: ReactFlowNode): node is WorkflowNode {
  return node && typeof node.data === 'object' && 'type' in node.data
}

/**
 * Type guard for specific node type
 */
export function isNodeOfType(node: ReactFlowNode, nodeType: NodeType): node is WorkflowNode {
  return isWorkflowNode(node) && node.data.type === nodeType
}

/**
 * Type guard for CommonNodeType
 */
export function isCommonNode(node: any): node is CommonNodeType {
  return (
    node &&
    typeof node === 'object' &&
    'id' in node &&
    'data' in node &&
    typeof node.data === 'object' &&
    'type' in node.data
  )
}

/**
 * Helper type to create specific node types with proper type inference
 * This allows hovering to show the full expanded type
 */
export type SpecificNode<TType extends string, TData extends BaseNodeData> = {
  [K in keyof CommonNodeType<TData>]: K extends 'type'
    ? TType
    : K extends 'data'
      ? TData & { id: string; _inParallelHovering?: boolean }
      : CommonNodeType<TData>[K]
}

/**
 * Zod schema for base node data
 * This schema includes all common fields that every node should have
 */
export const baseNodeDataSchema = z.object({
  // Core properties
  id: z.string(),
  type: z.string() as z.ZodType<NodeType>,
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
