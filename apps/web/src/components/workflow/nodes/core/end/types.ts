// apps/web/src/components/workflow/nodes/core/end/types.ts

import type { CatalogEndNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/end`). EndNodeData narrows `type`
// to the web NodeType enum, same as BaseNodeData does over its lib
// counterpart.

/**
 * Node data structure for the End node with minimal configuration
 */
export interface EndNodeData extends CatalogEndNodeData {
  type: NodeType
}

/**
 * Full End node type for React Flow
 */
export type EndNode = SpecificNode<'end', EndNodeData>
