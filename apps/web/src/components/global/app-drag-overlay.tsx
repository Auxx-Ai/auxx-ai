// apps/web/src/components/global/app-drag-overlay.tsx

'use client'

import { type Active, DragOverlay, useDndContext } from '@dnd-kit/core'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BacklogRowGhost } from '~/components/dispatch/ui/sidebar/backlog-group'
import { FavoriteDragOverlay } from '~/components/favorites/ui/favorite-drag-overlay'
import MailThreadItemDragOverlay from '~/components/mail/mail-thread-item-drag-overlay'

/**
 * Type-switched ghost renderer shared by every `DndContext` on the page (plans/dispatch/
 * 16-dnd-unification.md Phase 2). Pure function so it can be threaded through
 * `CalendarDndProvider`'s `renderForeignOverlay` slot (dispatch calendar mode already owns its
 * own `DragOverlay` and can't mount a second `AppDragOverlay` inside the same context) as well as
 * called directly by `AppDragOverlay` below for contexts that don't need a foreign-item slot.
 */
export function renderAppDragGhost(active: Active): ReactNode {
  const data = active.data.current as
    | {
        type?: string
        draggedThreadIds?: string[]
        favoriteId?: string
        item?: Parameters<typeof BacklogRowGhost>[0]['item']
      }
    | undefined
  if (!data) return null

  switch (data.type) {
    case 'thread':
      return <MailThreadItemDragOverlay items={data.draggedThreadIds ?? []} isDragging />
    case 'favorite':
      return data.favoriteId ? <FavoriteDragOverlay favoriteId={data.favoriteId} /> : null
    case 'backlog-visit':
    case 'planner-backlog':
    case 'planner-stop':
      return data.item ? <BacklogRowGhost item={data.item} /> : null
    default:
      return null
  }
}

/**
 * Portaled `DragOverlay` — the cursor-following ghost for whichever item is being dragged.
 * Extracted from `dashboard.tsx`'s inline block so every `DndContext` on `/app/dispatch` (the
 * app-level Dashboard context, and map mode's `PlannerDndProvider`) renders an identical ghost.
 * Calendar mode can't mount a second instance inside its own context (a `DragOverlay` only shows
 * drags from its own `DndContext`) — it threads `renderAppDragGhost` through
 * `CalendarDndProvider`'s `renderForeignOverlay` slot instead.
 *
 * Reads the active drag straight from dnd-kit's own context (`useDndContext`) rather than taking
 * a prop, so mounting it is a single `<AppDragOverlay />` inside the owning `DndContext` — no
 * wiring required.
 */
export function AppDragOverlay() {
  const { active } = useDndContext()
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setPortalContainer(document.body)
  }, [])

  if (!portalContainer) return null

  return createPortal(
    <DragOverlay
      dropAnimation={null}
      adjustScale={false}
      modifiers={[snapCenterToCursor]}
      style={{ width: 'auto' }}
      className='w-auto'>
      {active ? renderAppDragGhost(active) : null}
    </DragOverlay>,
    portalContainer
  )
}
