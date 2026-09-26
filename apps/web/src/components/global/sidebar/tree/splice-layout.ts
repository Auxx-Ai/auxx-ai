// apps/web/src/components/global/sidebar/tree/splice-layout.ts
// Optimistic edits of a resolved layout; the server response replaces them.

import {
  homeGroupFor,
  type ResolvedSidebarFolder,
  type ResolvedSidebarGroup,
  type ResolvedSidebarItem,
  type ResolvedSidebarLayout,
} from '@auxx/lib/sidebar-layout/client'
import type { SidebarMoveArgs } from './sidebar-drop-rules'

type Child = ResolvedSidebarFolder | ResolvedSidebarItem
type AnyNode = ResolvedSidebarGroup | Child

function clone(layout: ResolvedSidebarLayout): ResolvedSidebarLayout {
  return {
    ...layout,
    groups: layout.groups.map((g) => ({
      ...g,
      children: g.children.map((c) =>
        c.kind === 'FOLDER' ? { ...c, children: [...c.children] } : c
      ),
    })),
  }
}

/** Every container list in the layout: the group list itself, each group's and each folder's children. */
function containers(layout: ResolvedSidebarLayout): { key: string | null; list: AnyNode[] }[] {
  const out: { key: string | null; list: AnyNode[] }[] = [{ key: null, list: layout.groups }]
  for (const g of layout.groups) {
    out.push({ key: g.key, list: g.children })
    for (const c of g.children) if (c.kind === 'FOLDER') out.push({ key: c.key, list: c.children })
  }
  return out
}

function insert(list: AnyNode[], node: AnyNode, beforeId?: string, afterId?: string) {
  const anchorAbove = beforeId ? list.findIndex((n) => n.key === beforeId) : -1
  if (anchorAbove !== -1) return void list.splice(anchorAbove + 1, 0, node)
  const anchorBelow = afterId ? list.findIndex((n) => n.key === afterId) : -1
  if (anchorBelow !== -1) return void list.splice(anchorBelow, 0, node)
  list.push(node)
}

/** Move a node the way `sidebar.move` will; returns the input unchanged when the move is invalid. */
export function moveInLayout(
  layout: ResolvedSidebarLayout,
  args: SidebarMoveArgs
): ResolvedSidebarLayout {
  const next = clone(layout)
  const all = containers(next)
  const source = all.find((c) => c.list.some((n) => n.key === args.nodeId))
  const target = all.find((c) => c.key === args.parentId)
  if (!source || !target) return layout
  const node = source.list.find((n) => n.key === args.nodeId)!
  const targetIsFolder = target.key !== null && !next.groups.some((g) => g.key === target.key)
  if ((node.kind === 'GROUP') !== (target.key === null)) return layout
  if (node.kind === 'FOLDER' && targetIsFolder) return layout
  source.list.splice(source.list.indexOf(node), 1)
  insert(target.list, node, args.beforeId, args.afterId)
  return next
}

function patchNode(
  layout: ResolvedSidebarLayout,
  key: string,
  patch: (node: AnyNode) => AnyNode
): ResolvedSidebarLayout {
  const next = clone(layout)
  for (const c of containers(next)) {
    const idx = c.list.findIndex((n) => n.key === key)
    if (idx !== -1) {
      c.list[idx] = patch(c.list[idx]!)
      return next
    }
  }
  return layout
}

export function setHiddenInLayout(
  layout: ResolvedSidebarLayout,
  key: string,
  isHidden: boolean
): ResolvedSidebarLayout {
  return patchNode(layout, key, (n) => ({ ...n, isHidden }))
}

export function renameInLayout(
  layout: ResolvedSidebarLayout,
  key: string,
  title: string
): ResolvedSidebarLayout {
  return patchNode(layout, key, (n) => (n.kind === 'ITEM' ? n : { ...n, title }))
}

/** Delete like the server: folder items go to the folder's group, a group's items to their home group. */
export function removeFromLayout(
  layout: ResolvedSidebarLayout,
  key: string
): ResolvedSidebarLayout {
  const next = clone(layout)
  const group = next.groups.find((g) => g.key === key)
  if (group) {
    next.groups.splice(next.groups.indexOf(group), 1)
    const items = group.children.flatMap((c) => (c.kind === 'FOLDER' ? c.children : [c]))
    for (const item of items) {
      next.groups.find((g) => g.systemKey === homeGroupFor(item.targetType))?.children.push(item)
    }
    return next
  }
  for (const g of next.groups) {
    const idx = g.children.findIndex((c) => c.key === key)
    if (idx !== -1) {
      const [removed] = g.children.splice(idx, 1)
      if (removed?.kind === 'FOLDER') g.children.push(...removed.children)
      return next
    }
    for (const c of g.children) {
      if (c.kind !== 'FOLDER') continue
      const i = c.children.findIndex((it) => it.key === key)
      if (i !== -1) {
        c.children.splice(i, 1)
        return next
      }
    }
  }
  return layout
}

/** Insert a placeholder group; its temporary key is swapped for the real row when the server answers. */
export function addGroupInLayout(
  layout: ResolvedSidebarLayout,
  key: string,
  title: string,
  position: { beforeId?: string; afterId?: string }
): ResolvedSidebarLayout {
  const next = clone(layout)
  const group: ResolvedSidebarGroup = {
    kind: 'GROUP',
    key,
    nodeId: null,
    systemKey: null,
    title,
    isHidden: false,
    children: [],
  }
  insert(next.groups, group, position.beforeId, position.afterId)
  return next
}

/** Insert a placeholder folder into a group, like {@link addGroupInLayout}. */
export function addFolderInLayout(
  layout: ResolvedSidebarLayout,
  parentKey: string,
  key: string,
  title: string,
  position: { beforeId?: string; afterId?: string }
): ResolvedSidebarLayout {
  const next = clone(layout)
  const group = next.groups.find((g) => g.key === parentKey)
  if (!group) return layout
  const folder: ResolvedSidebarFolder = {
    kind: 'FOLDER',
    key,
    nodeId: null,
    title,
    isHidden: false,
    children: [],
  }
  insert(group.children, folder, position.beforeId, position.afterId)
  return next
}
