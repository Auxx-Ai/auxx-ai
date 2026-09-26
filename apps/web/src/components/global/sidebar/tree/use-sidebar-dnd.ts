// apps/web/src/components/global/sidebar/tree/use-sidebar-dnd.ts
'use client'

import {
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  pointerWithin,
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { useCallback, useMemo, useRef } from 'react'
import { planSidebarPreviewDrop, previewSidebarDragOver } from './sidebar-drag-preview'
import type { SidebarNodeDragData, SidebarOverData } from './sidebar-drop-rules'
import { useSidebarNodesApi } from './sidebar-nodes-provider'
import { selectSidebarLayout } from './sidebar-nodes-store'
import { useSidebarMutations } from './use-sidebar-mutations'

/** Handlers for sidebar-node drags: cross-container preview, collision guard, commit and cancel. */
export function useSidebarDnd() {
  const { move } = useSidebarMutations()
  const store = useSidebarNodesApi()
  // Rows keep their pre-move rects until the next frame; colliding against them would bounce back.
  const recentlyMoved = useRef(false)

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => (recentlyMoved.current ? [{ id: args.active.id }] : pointerWithin(args)),
    []
  )

  const onDragOver = useCallback(
    ({ active, over, activatorEvent, delta }: DragOverEvent) => {
      if (!over || recentlyMoved.current) return
      const state = store.getState()
      const layout = selectSidebarLayout(state)
      const pointerY = (getEventCoordinates(activatorEvent)?.y ?? 0) + delta.y
      const next = previewSidebarDragOver(
        layout,
        active.data.current as SidebarNodeDragData,
        over.data.current as SidebarOverData,
        pointerY > over.rect.top + over.rect.height / 2
      )
      if (next === layout) return
      recentlyMoved.current = true
      state.setDragLayout(next)
      // One frame after React commits the preview, as in dnd-kit's MultipleContainers example.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          recentlyMoved.current = false
        })
      )
    },
    [store]
  )

  const onDragEnd = useCallback(
    ({ active, over }: Pick<DragEndEvent, 'active' | 'over'>) => {
      const state = store.getState()
      const preview = selectSidebarLayout(state)
      state.setDragLayout(null)
      const args = planSidebarPreviewDrop(
        selectSidebarLayout(store.getState()),
        preview,
        active.data.current as SidebarNodeDragData,
        over?.data.current as SidebarOverData | undefined
      )
      // `move` puts the same tree into pendingLayout synchronously, so nothing snaps back.
      if (args) void move(args)
    },
    [move, store]
  )

  const onDragCancel = useCallback(() => store.getState().setDragLayout(null), [store])

  return useMemo(
    () => ({ collisionDetection, onDragOver, onDragEnd, onDragCancel }),
    [collisionDetection, onDragOver, onDragEnd, onDragCancel]
  )
}
