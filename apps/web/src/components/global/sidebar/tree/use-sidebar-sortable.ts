// apps/web/src/components/global/sidebar/tree/use-sidebar-sortable.ts
'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createContext, useContext } from 'react'
import { useDndState } from '~/app/context/dnd-state-context'
import { parentKeyIn } from './sidebar-drag-preview'
import {
  type SidebarNodeDragData,
  sidebarNodeDragKind,
  sidebarParentAccepts,
  sidebarSortableId,
  sortableAcceptsDrag,
} from './sidebar-drop-rules'
import { useSidebarNodes } from './sidebar-nodes-provider'
import { selectSidebarLayout } from './sidebar-nodes-store'

/** True inside a collapsed group/folder: clipped rows keep their rects, so they must not catch drops. */
export const SidebarCollapsedContext = createContext(false)

/** The active sidebar drag kind (null when nothing, or something else, is dragging). */
export function useSidebarDragKind() {
  return sidebarNodeDragKind(useDndState().activeDndItem)
}

/** Whether the active folder/item drag may drop into container `key`: not already there, and allowed. */
export function useSidebarCanDropInto(key: string): boolean {
  const data = useDndState().activeDndItem?.data.current as Partial<SidebarNodeDragData> | undefined
  const activeKey = data?.type === 'sidebar-node' && data.kind !== 'GROUP' ? data.key : undefined
  // Read from the store, not the drag data: a drag preview may already have moved the node.
  return useSidebarNodes((s) => {
    if (!activeKey) return false
    const layout = selectSidebarLayout(s)
    return parentKeyIn(layout, activeKey) !== key && sidebarParentAccepts(layout, key, activeKey)
  })
}

/** Whole-node `useSortable` for a sidebar group, folder or item, plus its transform style. */
export function useSidebarSortable(
  data: Omit<SidebarNodeDragData, 'type'> & { inFolder?: boolean },
  disabled = false
) {
  const dragKind = useSidebarDragKind()
  const collapsed = useContext(SidebarCollapsedContext)
  const { inFolder, ...payload } = data
  const sortable = useSortable({
    id: sidebarSortableId(data.key),
    data: { type: 'sidebar-node', ...payload } satisfies SidebarNodeDragData,
    disabled: {
      draggable: disabled,
      droppable: collapsed || !sortableAcceptsDrag({ kind: data.kind, inFolder }, dragKind),
    },
  })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }
  return { ...sortable, style, dragKind }
}
