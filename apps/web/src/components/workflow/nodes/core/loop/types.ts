// apps/web/src/components/workflow/nodes/core/loop/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Node data for loop nodes (flattened structure)
 */
export interface LoopNodeData extends BaseNodeData {
  itemsSource: string // variable path to array like "{{customers}}"
  iteratorName?: string // @deprecated - always 'item' now, kept for backwards compatibility
  maxIterations: number // safety limit
  accumulateResults: boolean
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
