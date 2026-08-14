// apps/web/src/components/workflow/nodes/core/find/types.ts

import type { CatalogFindNodeData } from '@auxx/lib/workflow-engine/client'
import type { ExecutionResult } from '~/components/workflow/types'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/find`); re-exported here so no web
// import churns. FindNodeData narrows `type` to the web NodeType enum, same
// as BaseNodeData does over its lib counterpart.
export { createFindNodeDefaultData, findNodeDataSchema } from '@auxx/lib/workflow-engine/client'

/**
 * Node data for find nodes (flattened structure)
 */
export interface FindNodeData extends CatalogFindNodeData {
  type: NodeType.FIND
}

/**
 * Full Find node type for React Flow
 */
export type FindNode = SpecificNode<'find', FindNodeData>

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean
  errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
}

/**
 * Execution result for find nodes
 */
export interface FindExecutionResult extends ExecutionResult {
  outputs: {
    [resourceKey: string]: any | any[] // Single resource for findOne, array for findMany
  }
}
