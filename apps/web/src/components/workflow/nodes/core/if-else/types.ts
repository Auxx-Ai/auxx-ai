// apps/web/src/components/workflow/nodes/core/if-else/types.ts

import type { Operator } from '@auxx/lib/conditions/client'
import type {
  CatalogIfElseNodeData,
  NodeCondition as CatalogNodeCondition,
} from '@auxx/lib/workflow-engine/client'
import type { Node as FlowNode } from '@xyflow/react'
import type { TargetBranch } from '~/components/workflow/types'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'
import { BaseType, type UnifiedVariable } from '~/components/workflow/types/variable-types'
import type { TiptapJSON } from '~/components/workflow/ui/input-editor'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/if-else`). This file keeps the
// web-only narrowings: `TiptapJSON` in condition values (lib types them as
// `Record<string, any>`, which Tiptap docs satisfy structurally) and the
// NodeType narrowing on the node data.
export type { NodeCondition } from '@auxx/lib/workflow-engine/client'

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
export interface IfElseCondition extends Omit<CatalogNodeCondition, 'value' | 'varType'> {
  file_var?: any
  conditions?: IfElseCondition[]
  value?: string | number | boolean | string[] | TiptapJSON
  /** Declared value type — drives which value editor is rendered */
  varType?: BaseType
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

// Re-export from store types for backward compatibility
export type IfElseCase = NodeCase

/**
 * Node data for if-else nodes (flattened structure)
 */
export interface IfElseNodeData extends CatalogIfElseNodeData {
  type: NodeType
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

// Re-export for convenience
export type { UnifiedVariable }
export { BaseType }
