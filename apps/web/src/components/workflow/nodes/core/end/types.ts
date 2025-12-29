// apps/web/src/components/workflow/nodes/core/end/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types'

/**
 * Node data structure for the End node with minimal configuration
 */
export interface EndNodeData extends BaseNodeData {
  /** Optional message to display when workflow ends */
  message?: string
  /** Optional status to set when workflow ends */
  status?: 'success' | 'error'
}

/**
 * Full End node type for React Flow
 */
export type EndNode = SpecificNode<'end', EndNodeData>
