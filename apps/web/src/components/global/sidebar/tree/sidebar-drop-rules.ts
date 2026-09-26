// apps/web/src/components/global/sidebar/tree/sidebar-drop-rules.ts
// Pure drag-end routing for the sidebar tree: the Favorites router, extended with groups.

import { isFavoriteTargetType, type ResolvedSidebarLayout } from '@auxx/lib/sidebar-layout/client'
import type { Active } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'

export type SidebarNodeKind = 'GROUP' | 'FOLDER' | 'ITEM'

/** Sortable payload of a group section, folder or item row. */
export interface SidebarNodeDragData {
  type: 'sidebar-node'
  key: string
  kind: SidebarNodeKind
  /** Container key; null for groups. */
  parentKey: string | null
  /** Drag overlay label. */
  label: string
  /** Folders only: whether its rows are showing (a drag preview never moves into a closed one). */
  open?: boolean
}

/** Group header droppable: folders and items dropped here append to the group. */
export interface SidebarGroupTargetData {
  type: 'sidebar-group-target'
  groupKey: string
  open?: boolean
}

/** Folder droppable: items dropped here append to the folder. */
export interface SidebarFolderTargetData {
  type: 'sidebar-folder-target'
  folderKey: string
  open?: boolean
}

export type SidebarOverData = SidebarNodeDragData | SidebarGroupTargetData | SidebarFolderTargetData

export interface SidebarMoveArgs {
  nodeId: string
  parentId: string | null
  beforeId?: string
  afterId?: string
}

export function sidebarSortableId(key: string): string {
  return `sidebar-node-${key}`
}

/** Kind of the active drag when it is a sidebar node, else null. */
export function sidebarNodeDragKind(active: Active | null | undefined): SidebarNodeKind | null {
  const data = active?.data.current as Partial<SidebarNodeDragData> | undefined
  return data?.type === 'sidebar-node' ? (data.kind ?? null) : null
}

/** Whether an active drag belongs to the sidebar tree (drag-end router + spring-load peek). */
export function isSidebarNodeDrag(active: Active | null | undefined): boolean {
  return sidebarNodeDragKind(active) !== null
}

/** Whether a sortable node accepts `dragKind` as an over target. Groups only meet groups; folders never enter folders. */
export function sortableAcceptsDrag(
  node: { kind: SidebarNodeKind; inFolder?: boolean },
  dragKind: SidebarNodeKind | null
): boolean {
  if (!dragKind) return true
  // Sections only sort among groups; dropping into a group goes through its header target.
  if (node.kind === 'GROUP') return dragKind === 'GROUP'
  if (dragKind === 'GROUP') return false
  if (node.kind === 'FOLDER') return true
  return dragKind === 'ITEM' || !node.inFolder
}

/** What the Favorites rule reads; both the resolved layout and the render tree fit it. */
interface FavoritesRuleTree {
  groups: {
    key: string
    systemKey: string | null
    children: {
      kind: string
      key: string
      targetType?: string
      children?: { key: string; targetType: string }[]
    }[]
  }[]
}

/**
 * Whether node `nodeKey` may sit in container `parentKey`: the Favorites group and its folders
 * hold only favorite targets (a folder only if every child is one). Unknown nodes pass.
 */
export function sidebarParentAccepts(
  tree: FavoritesRuleTree,
  parentKey: string | null,
  nodeKey: string
): boolean {
  const favorites = tree.groups.find((g) => g.systemKey === 'favorites')
  if (!favorites || parentKey === null) return true
  const intoFavorites =
    favorites.key === parentKey ||
    favorites.children.some((c) => c.kind === 'FOLDER' && c.key === parentKey)
  if (!intoFavorites) return true
  for (const g of tree.groups) {
    for (const c of g.children) {
      if (c.key === nodeKey) {
        return c.kind === 'FOLDER'
          ? (c.children ?? []).every((i) => isFavoriteTargetType(i.targetType))
          : isFavoriteTargetType(c.targetType)
      }
      const inner = c.children?.find((i) => i.key === nodeKey)
      if (inner) return isFavoriteTargetType(inner.targetType)
    }
  }
  return true
}

/** Keys of a container: null = the group list, else a group's or folder's children. */
function childKeysOf(layout: ResolvedSidebarLayout, parentKey: string | null): string[] | null {
  if (parentKey === null) return layout.groups.map((g) => g.key)
  for (const g of layout.groups) {
    if (g.key === parentKey) return g.children.map((c) => c.key)
    for (const c of g.children) {
      if (c.kind === 'FOLDER' && c.key === parentKey) return c.children.map((i) => i.key)
    }
  }
  return null
}

/** Append into a container; no anchors means "end" on the server and in the optimistic splice. */
function into(active: SidebarNodeDragData, parentKey: string): SidebarMoveArgs | null {
  if (active.parentKey === parentKey) return null
  return { nodeId: active.key, parentId: parentKey }
}

/** Take the over row's slot: arrayMove within a parent, insert-at-over-index across parents. */
function toSlot(
  active: SidebarNodeDragData,
  over: SidebarNodeDragData,
  layout: ResolvedSidebarLayout
): SidebarMoveArgs | null {
  const siblings = childKeysOf(layout, over.parentKey)
  const overIndex = siblings?.indexOf(over.key) ?? -1
  if (!siblings || overIndex === -1) return null

  let order: string[]
  if (over.parentKey === active.parentKey) {
    const oldIndex = siblings.indexOf(active.key)
    if (oldIndex === -1 || oldIndex === overIndex) return null
    order = arrayMove(siblings, oldIndex, overIndex)
  } else {
    order = [...siblings]
    order.splice(overIndex, 0, active.key)
  }

  const at = order.indexOf(active.key)
  const args: SidebarMoveArgs = { nodeId: active.key, parentId: over.parentKey }
  if (order[at - 1]) args.beforeId = order[at - 1]
  if (order[at + 1]) args.afterId = order[at + 1]
  return args
}

/** The `sidebar.move` input for a drop, or null when it is rejected or changes nothing. */
export function planSidebarDrop(
  active: SidebarNodeDragData,
  over: SidebarOverData | undefined,
  layout: ResolvedSidebarLayout
): SidebarMoveArgs | null {
  const args = planDrop(active, over, layout)
  return args && sidebarParentAccepts(layout, args.parentId, active.key) ? args : null
}

function planDrop(
  active: SidebarNodeDragData,
  over: SidebarOverData | undefined,
  layout: ResolvedSidebarLayout
): SidebarMoveArgs | null {
  if (!over) return null

  if (over.type === 'sidebar-folder-target') {
    return active.kind === 'ITEM' ? into(active, over.folderKey) : null
  }
  if (over.type === 'sidebar-group-target') {
    return active.kind === 'GROUP' ? null : into(active, over.groupKey)
  }
  if (over.type !== 'sidebar-node' || over.key === active.key) return null

  if (active.kind === 'GROUP') return over.kind === 'GROUP' ? toSlot(active, over, layout) : null
  // Over a group section outside any row (its header area or a gap): append to that group.
  if (over.kind === 'GROUP') return into(active, over.key)
  if (over.kind === 'FOLDER' && active.kind === 'ITEM') return into(active, over.key)
  if (active.kind === 'FOLDER' && !layout.groups.some((g) => g.key === over.parentKey)) return null
  return toSlot(active, over, layout)
}
