// apps/web/src/components/returns/hooks/use-salvage-tree.ts
'use client'

// Children load on first expand, never up front (plans/money/tasks/54-returns.md §6.6).

import type { SalvageNode } from '@auxx/lib/returns/client'
import { type LazyTreeState, useLazyTree } from '~/hooks/use-lazy-tree'

/** A row can only be split when it has more than one unit to divide. */
export const MIN_SPLITTABLE_QUANTITY = 2

/** True when this row has units to divide and is not already covered from above. */
export function canSplitNode(node: SalvageNode): boolean {
  return node.quantity >= MIN_SPLITTABLE_QUANTITY
}

/**
 * Descendants of this node that a person has already ruled on.
 *
 * Best effort by construction: only LOADED children are in memory, so a row
 * sitting behind an unexpanded branch cannot be counted. It is used to warn
 * before a `good` supersedes work, never to decide anything.
 */
export function decidedDescendantCount(node: SalvageNode): number {
  let count = 0
  for (const child of node.children ?? []) {
    if (child.materialized && child.status !== 'undecided') count += 1
    count += decidedDescendantCount(child)
  }
  return count
}

export type SalvageTreeState = LazyTreeState<SalvageNode>

export interface UseSalvageTreeOptions {
  /**
   * Materialize a node's children. Called at most once per node: the resolved
   * children are expected back on the node tree, after which open/close is
   * local. A rejection leaves the row closed and raises an error toast.
   */
  onExpand: (node: SalvageNode) => void | Promise<void>
}

const salvageLabel = (node: SalvageNode) => node.partName

/** Expansion state for one salvage tree. */
export function useSalvageTree({ onExpand }: UseSalvageTreeOptions): SalvageTreeState {
  return useLazyTree({ onExpand, label: salvageLabel })
}
