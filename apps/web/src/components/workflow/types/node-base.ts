// apps/web/src/components/workflow/types/node-base.ts

import type { CatalogBaseNodeData } from '@auxx/lib/workflow-engine/client'
import { NodeRunningStatus } from '@auxx/lib/workflow-engine/client'
import type {
  CoordinateExtent,
  Position,
  Edge as ReactFlowEdge,
  Node as ReactFlowNode,
  XYPosition,
} from '@xyflow/react'
import type { NodeType } from './node-types'

// Re-export for convenience
export { NodeRunningStatus }

// The pure half of this module (base data shape, its zod schema, the error
// and runtime-state types) moved to lib with the node catalog
// (`@auxx/lib/workflow-engine/catalog/node-base`); re-exported here so no web
// import churns. This file keeps the React Flow node/edge types and a
// `BaseNodeData` that narrows `type` to the web `NodeType` enum.
export {
  baseNodeDataSchema,
  ErrorHandleType,
  type NodeConnectionMetadata,
  type NodeLoopContext,
  type NodeRuntimeState,
  type WorkflowRetryConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Base configuration that all node configs must extend
 * @deprecated This interface is being phased out as configs are flattened into node data
 */
export interface BaseNodeConfig {
  title: string
  description?: string
}

/**
 * Base data structure for all workflow nodes.
 * The field set lives in lib (`CatalogBaseNodeData`); this narrows `type`
 * from `string` to the web `NodeType` enum.
 */
export interface BaseNodeData extends CatalogBaseNodeData {
  type: NodeType
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
  /**
   * React Flow's node extent. Loop children are pinned to their parent with
   * `'parent'` — see `node-factory.ts`. `null` is carried to stay assignable
   * from React Flow's own `Node`, which permits it.
   */
  extent?: 'parent' | CoordinateExtent | null
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
 * Props a workflow node component actually receives.
 *
 * React Flow only ever mounts `standard` and `note` (see `FLOW_NODE_TYPES` in
 * nodes/shared/base/custom-node.tsx). `StandardNode` looks the real component up
 * in the registry and renders it with exactly these three props — so a node
 * component never sees React Flow's own `NodeProps` (no `position`, no
 * `dragging`, no `zIndex`, and `data` is typed, not `Record<string, unknown>`).
 *
 * Node components should be declared `NodeProps<XNodeData>`, NOT the node-object
 * type `SpecificNode<'x', XNodeData>`.
 */
export type NodeProps<T extends BaseNodeData = BaseNodeData> = {
  id: string
  data: T
  selected?: boolean
}

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
