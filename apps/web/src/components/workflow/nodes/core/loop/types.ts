// apps/web/src/components/workflow/nodes/core/loop/types.ts

import type { CatalogLoopNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/loop`).

/**
 * Node data for loop nodes (flattened structure)
 */
export interface LoopNodeData extends CatalogLoopNodeData {
  type: NodeType
}

/**
 * Full Loop node type for React Flow
 */
export type LoopNode = SpecificNode<'loop', LoopNodeData>

export interface LoopContext {
  loopNodeId: string
  currentIteration: number
  totalIterations: number
  currentItem: any
  iteratorName?: string // @deprecated - always 'item' now
  iteratorType?: string // Type of the items being iterated
  accumulatedResults: any[]
  depth?: number // Nesting depth: 1 for top-level, 2 for nested, etc.
}

export interface LoopProgress {
  currentIteration: number
  totalIterations: number
  startTime: number
  status: 'running' | 'completed' | 'failed' | 'stopped'
}
