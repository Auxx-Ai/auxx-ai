// apps/web/src/hooks/use-lazy-tree.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useMemo, useState } from 'react'

/** The shape a lazy tree needs: `children` is `null` until the node has been loaded. */
export interface LazyTreeNode {
  key: string
  hasChildren: boolean
  children: readonly unknown[] | null
}

export interface LazyTreeState<Node extends LazyTreeNode> {
  /** Is this row showing its children? */
  isExpanded: (key: string) => boolean
  /** Is this row waiting on its children to load? */
  isExpanding: (key: string) => boolean
  /** Open a closed row (loading on first open) or close an open one. */
  toggle: (node: Node) => void
  /** Force a row closed. */
  collapse: (key: string) => void
}

export interface UseLazyTreeOptions<Node extends LazyTreeNode> {
  /** Load a node's children onto the caller's tree; called at most once per node, a rejection toasts. */
  onExpand?: (node: Node) => void | Promise<void>
  /** Keys open on mount; read once. */
  initialExpanded?: Iterable<string>
  /** Names the node in the error toast. */
  label?: (node: Node) => string
}

/** Local open/closed state over a tree whose children load on first expand. */
export function useLazyTree<Node extends LazyTreeNode>({
  onExpand,
  initialExpanded,
  label,
}: UseLazyTreeOptions<Node> = {}): LazyTreeState<Node> {
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () => new Set(initialExpanded)
  )
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
    (node: Node) => {
      const { key } = node
      if (expandedKeys.has(key)) {
        collapse(key)
        return
      }
      if (node.children !== null || !onExpand) {
        setExpandedKeys((current) => new Set(current).add(key))
        return
      }
      if (expandingKeys.has(key)) return

      setExpandingKeys((current) => new Set(current).add(key))
      // `Promise.resolve` gives a sync and an async `onExpand` the same cleanup path.
      Promise.resolve(onExpand(node))
        .then(() => {
          setExpandedKeys((current) => new Set(current).add(key))
        })
        .catch((error: unknown) => {
          toastError({
            title: 'Error loading components',
            description:
              error instanceof Error
                ? error.message
                : `Could not load ${label?.(node) ?? 'the components'}.`,
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
    [collapse, expandedKeys, expandingKeys, label, onExpand]
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
