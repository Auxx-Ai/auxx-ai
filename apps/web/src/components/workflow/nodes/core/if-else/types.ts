// apps/web/src/components/workflow/nodes/core/if-else/types.ts

import type { Operator } from '@auxx/lib/conditions/client'
import type { Node as FlowNode } from '@xyflow/react'
import type { TargetBranch } from '~/components/workflow/types'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'
import { BaseType, type UnifiedVariable } from '~/components/workflow/types/variable-types'
import type { TiptapJSON } from '~/components/workflow/ui/input-editor'

export type Node = FlowNode
export type ValueSelector = string[]
export type ComparisonOperator = Operator

/**
 * Logical operators for combining conditions
 */
export enum LogicalOperator {
  AND = 'and',
  OR = 'or',
}

// Extended condition interface for if-else nodes
export interface IfElseCondition extends Omit<NodeCondition, 'varType' | 'value'> {
  key?: string
  file_var?: any
  conditions?: IfElseCondition[]
  varType?: BaseType
  value?: string | number | boolean | string[] | TiptapJSON
  // Modern variable reference
  variableId?: string
}

// Re-export from store types for backward compatibility
export type IfElseCase = NodeCase

/**
 * Node data for if-else nodes (flattened structure)
 */
export interface IfElseNodeData extends BaseNodeData {
  // Base fields
  title: string
  desc?: string
  // If-else specific fields
  cases: NodeCase[]
  _targetBranches?: TargetBranch[]
}

/**
 * Full If-Else node type for React Flow
 */
export type IfElseNode = SpecificNode<'if-else', IfElseNodeData>

/**
 * Execution result for if-else nodes
 */
export interface IfElseExecutionResult {
  outputs: { matched_case: string | null; branch: string }
  [key: string]: any
}

/**
 * Condition for if-else nodes
 * Uses Operator from lib for type safety
 */
export interface NodeCondition {
  id: string
  variableId: string
  comparison_operator?: Operator
  value?: string | number | boolean | any[] | Record<string, any>
}

/**
 * Case definition for if-else nodes
 */
export interface NodeCase {
  id: string
  case_id: string
  logical_operator: 'and' | 'or'
  conditions: NodeCondition[]
}

// Re-export for convenience
export type { UnifiedVariable }
export { BaseType }
