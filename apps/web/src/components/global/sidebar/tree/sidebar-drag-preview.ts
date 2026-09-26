// apps/web/src/components/global/sidebar/tree/sidebar-drag-preview.ts
// Cross-container drag preview (dnd-kit's multiple-containers pattern) and the drop it commits.

import type { ResolvedSidebarLayout } from '@auxx/lib/sidebar-layout/client'
import {
  planSidebarDrop,
  type SidebarMoveArgs,
  type SidebarNodeDragData,
  type SidebarOverData,
  sidebarParentAccepts,
} from './sidebar-drop-rules'
import { moveInLayout } from './splice-layout'

interface Slot {
  parentKey: string | null
  siblings: string[]
  index: number
}

/** Where a node sits: its container key (null for groups), that container's keys and its index. */
function slotOf(layout: ResolvedSidebarLayout, key: string): Slot | null {
  const lists: [string | null, { key: string }[]][] = [[null, layout.groups]]
  for (const g of layout.groups) {
    lists.push([g.key, g.children])
    for (const c of g.children) if (c.kind === 'FOLDER') lists.push([c.key, c.children])
  }
  for (const [parentKey, list] of lists) {
    const index = list.findIndex((n) => n.key === key)
    if (index !== -1) return { parentKey, siblings: list.map((n) => n.key), index }
  }
  return null
}

/** Container key of a node (null for groups), or undefined when it is not in the layout. */
export function parentKeyIn(layout: ResolvedSidebarLayout, key: string): string | null | undefined {
  const slot = slotOf(layout, key)
  return slot ? slot.parentKey : undefined
}

/**
 * The preview layout while `active` hovers `over`, or `layout` itself when nothing moves. Only
 * container changes move; sorting inside the current container stays on dnd-kit's transforms.
 */
export function previewSidebarDragOver(
  layout: ResolvedSidebarLayout,
  active: Pick<SidebarNodeDragData, 'key' | 'kind'>,
  over: SidebarOverData | undefined,
  below: boolean
): ResolvedSidebarLayout {
  if (!over || active.kind === 'GROUP') return layout
  const parent = parentKeyIn(layout, active.key)
  if (parent === undefined) return layout
  const moveTo = (args: Omit<SidebarMoveArgs, 'nodeId'>) =>
    args.parentId === parent || !sidebarParentAccepts(layout, args.parentId, active.key)
      ? layout
      : moveInLayout(layout, { nodeId: active.key, ...args })

  if (over.type === 'sidebar-folder-target') {
    return active.kind === 'ITEM' && over.open ? moveTo({ parentId: over.folderKey }) : layout
  }
  if (over.type === 'sidebar-group-target') {
    if (!over.open) return layout
    const first = layout.groups.find((g) => g.key === over.groupKey)?.children[0]?.key
    return moveTo({ parentId: over.groupKey, afterId: first })
  }
  if (over.key === active.key || over.kind === 'GROUP') return layout
  if (over.kind === 'FOLDER' && active.kind === 'ITEM') {
    return over.open ? moveTo({ parentId: over.key }) : layout
  }
  const overParent = parentKeyIn(layout, over.key)
  if (overParent == null) return layout
  // moveInLayout rejects a folder landing in a folder.
  return moveTo(
    below
      ? { parentId: overParent, beforeId: over.key }
      : { parentId: overParent, afterId: over.key }
  )
}

/**
 * The `sidebar.move` input for dropping `active` over `over` on top of the drag `preview`,
 * relative to `base` (the layout without the preview); null when the node ends where it started.
 */
export function planSidebarPreviewDrop(
  base: ResolvedSidebarLayout,
  preview: ResolvedSidebarLayout,
  active: SidebarNodeDragData,
  over: SidebarOverData | undefined
): SidebarMoveArgs | null {
  const parentKey = parentKeyIn(preview, active.key)
  if (parentKey === undefined) return null
  const drop = planSidebarDrop({ ...active, parentKey }, over, preview)
  const from = slotOf(base, active.key)
  const to = slotOf(drop ? moveInLayout(preview, drop) : preview, active.key)
  if (!from || !to || (from.parentKey === to.parentKey && from.index === to.index)) return null

  const args: SidebarMoveArgs = { nodeId: active.key, parentId: to.parentKey }
  // Last in its container: no anchors, which the server and the optimistic splice read as "end".
  const next = to.siblings[to.index + 1]
  if (next) {
    args.afterId = next
    if (to.index > 0) args.beforeId = to.siblings[to.index - 1]
  }
  return args
}
