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
export interface IfElseCondition extends Omit<NodeCondition, 'value'> {
  file_var?: any
  conditions?: IfElseCondition[]
  value?: string | number | boolean | string[] | TiptapJSON
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
  /** Variable this condition reads. Empty until the user picks one. */
  variableId?: string
  comparison_operator?: Operator
  value?: string | number | boolean | any[] | Record<string, any>
  /** Whether the right-hand value is a literal rather than a variable reference */
  isConstant?: boolean
  /** Sub-key inside a structured variable (e.g. an address part) */
  key?: string
  /** Declared value type — drives which value editor is rendered */
  varType?: BaseType
  /** How this condition joins the previous one inside its case */
  logical_operator?: 'and' | 'or'
}

/**
 * Case definition for if-else nodes
 */
export interface NodeCase {
  id: string
  case_id: string
  logical_operator: 'and' | 'or'
  conditions: IfElseCondition[]
}

// Re-export for convenience
export type { UnifiedVariable }
export { BaseType }
