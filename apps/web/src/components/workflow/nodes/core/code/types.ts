// apps/web/src/components/workflow/nodes/core/code/types.ts

import type { CatalogCodeNodeData } from '@auxx/lib/workflow-engine/client'
import type { ExecutionResult, SpecificNode } from '../../../types'
import type { NodeType } from '../../../types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/code`); re-exported here so no web
// import churns. CodeNodeData narrows `type` to the web NodeType enum, same
// as BaseNodeData does over its lib counterpart.
export type {
  CodeNodeInput,
  CodeNodeOutput,
  CodeOutput,
  CodeVariable,
} from '@auxx/lib/workflow-engine/client'

/**
 * Node data for code nodes (flattened structure)
 */
export interface CodeNodeData extends CatalogCodeNodeData {
  type: NodeType
}

/**
 * Full Code node type for React Flow
 */
export type CodeNode = SpecificNode<'code', CodeNodeData>

/**
 * Input data for code execution
 */
export interface CodeInput {
  data: any
}

/**
 * Execution result for code nodes
 */
export interface CodeExecutionResult extends ExecutionResult {
  outputs: { result: any; logs: string[] }
}
