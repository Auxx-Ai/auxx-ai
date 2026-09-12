// apps/web/src/components/returns/hooks/use-salvage-tree.ts
'use client'

// Local (never persisted) state for the salvage tree: which rows are open, and
// which are still fetching their children.
//
// 🛑 Expansion is LOCAL and lazy, per plans/money/tasks/54-returns.md §6.6:
// "Do not explode the whole BOM into `return_part_line` rows when the return
// line is created." Depth 20 times two lifts is an unbounded row count for a
// checklist the warehouse may only open two levels of. A node's children are
// asked for on FIRST expand and cached by the caller from then on; every later
// open/close of that row is pure client state and costs nothing.
//
// Everything here is derived from the node tree the card is handed. The hook
// owns no copy of the data, so a refetch that changes quantities or statuses
// cannot go stale against it.

import type { SalvageNode } from '@auxx/lib/returns/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo, useState } from 'react'

/** A row can only be split when it has more than one unit to divide. */
export const MIN_SPLITTABLE_QUANTITY = 2

/**
 * How deep the indent is allowed to go, in levels.
 *
 * 🛑 `MAX_BOM_DEPTH` is 20 and `GridTreeRow`'s step is 1.5rem, so an uncapped
 * indent would push 30rem of padding into a first column that is ~8rem wide on
 * a drawer and narrower on a phone. Past this depth rows stop stepping in; the
 * connector line stops with them, so the two never disagree.
 */
export const MAX_INDENT_DEPTH = 6

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

export interface SalvageTreeState {
  /** Is this row showing its children? */
  isExpanded: (key: string) => boolean
  /** Is this row waiting on its children to be materialized? */
  isExpanding: (key: string) => boolean
  /** Open a closed row (fetching on first open) or close an open one. */
  toggle: (node: SalvageNode) => void
  /** Force a row closed — what a `good` does to the branch it just covered. */
  collapse: (key: string) => void
}

export interface UseSalvageTreeOptions {
  /**
   * Materialize a node's children. Called at most once per node: the resolved
   * children are expected back on the node tree, after which open/close is
   * local. A rejection leaves the row closed and raises an error toast.
   */
  onExpand: (node: SalvageNode) => void | Promise<void>
}

/** Expansion state for one salvage tree. */
export function useSalvageTree({ onExpand }: UseSalvageTreeOptions): SalvageTreeState {
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [expandingKeys, setExpandingKeys] = useState<ReadonlySet<string>>(() => new Set())

  const collapse = useCallback((key: string) => {
    setExpandedKeys((current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }, [])

  const toggle = useCallback(
    (node: SalvageNode) => {
      const { key } = node
      if (expandedKeys.has(key)) {
        collapse(key)
        return
      }
      // Already loaded (this session or a previous open) — nothing to fetch.
      if (node.children !== null) {
        setExpandedKeys((current) => new Set(current).add(key))
        return
      }
      if (expandingKeys.has(key)) return

      setExpandingKeys((current) => new Set(current).add(key))
      // `onExpand` may be sync; `Promise.resolve` makes both shapes take the
      // same path, so a synchronous caller still lands in the same cleanup.
      Promise.resolve(onExpand(node))
        .then(() => {
          setExpandedKeys((current) => new Set(current).add(key))
        })
        .catch((error: unknown) => {
          toastError({
            title: 'Error loading components',
            description:
              error instanceof Error ? error.message : `Could not load ${node.partName}.`,
          })
        })
        .finally(() => {
          setExpandingKeys((current) => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
        })
    },
    [collapse, expandedKeys, expandingKeys, onExpand]
  )

  return useMemo(
    () => ({
      isExpanded: (key: string) => expandedKeys.has(key),
      isExpanding: (key: string) => expandingKeys.has(key),
      toggle,
      collapse,
    }),
    [collapse, expandedKeys, expandingKeys, toggle]
  )
}
