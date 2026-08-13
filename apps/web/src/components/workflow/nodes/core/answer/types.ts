// apps/web/src/components/workflow/nodes/core/answer/types.ts

import type { CatalogAnswerNodeData } from '@auxx/lib/workflow-engine/client'
import type { ExecutionResult, SpecificNode } from '../../../types'
import type { NodeType } from '../../../types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/answer`); AnswerNodeData narrows
// `type` to the web NodeType enum, same as BaseNodeData does over its lib
// counterpart.

/**
 * Node data for answer nodes with flattened structure
 */
export interface AnswerNodeData extends CatalogAnswerNodeData {
  type: NodeType
}

/**
 * Full Answer node type for React Flow
 */
export type AnswerNode = SpecificNode<'answer', AnswerNodeData>

/**
 * Execution result for answer nodes
 */
export interface AnswerExecutionResult extends ExecutionResult {
  outputs: {
    message_sent: boolean
    message_id?: string
    recipients?: string[]
  }
}
