// apps/web/src/components/workflow/types/core.ts

import type { Operator } from '@auxx/lib/conditions/client'
import type { WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import type { Viewport } from '@xyflow/react'
import type { Edge } from './node-base'
import type { BaseType } from './unified-types'

// Re-export base types from node-base.ts to maintain backwards compatibility
// Legacy alias for backwards compatibility
export type {
  BaseNodeConfig,
  BaseNodeData,
  CommonNodeType,
  WorkflowNode,
  WorkflowNode as FlowNode,
} from './node-base'
export { isCommonNode, isNodeOfType, isWorkflowNode } from './node-base'

/**
 * Variable selector type for referencing workflow variables
 */
export type VariableSelector = string[]

/**
 * Comparison operators for conditions
 * Now derived from Operator for consistency
 */
export type ComparisonOperator = Operator

export type BranchType = 'default' | 'fail'
export type TargetBranch = { id: string; name: string; type: BranchType }

export type EnvVarType = 'string' | 'number' | 'boolean' | 'array' | 'secret'
export type EnvVar = {
  id: string
  name: string
  value: string | number | boolean | Array<string>
  type: EnvVarType
}

export type InputVariable = {
  type: BaseType
  value: string | number | boolean | Array<string>
  nodeId: string
  variableId: string
  lastUpdated: number // Timestamp of the last update
}

export type FetchWorkflowResponse = {
  id: string
  name: string
  description?: string
  enabled: boolean
  version: number
  triggerType: WorkflowTriggerType
  graph: { nodes: Node[]; edges: Edge[]; viewport: Viewport }
  envVars: EnvVar[]
  variables: InputVariable[]
  organizationId: string
  createdAt: string
  updatedAt: string
  createdBy: { id: string; name: string; email: string }
  workflowId: string
  workflowAppId: string
  isPublic: boolean
  isUniversal: boolean
}
