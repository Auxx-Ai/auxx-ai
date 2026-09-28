// apps/web/src/components/global/app-drag-overlay.tsx

'use client'

import {
  type Active,
  DragOverlay,
  type DropAnimation,
  defaultDropAnimationSideEffects,
  useDndContext,
} from '@dnd-kit/core'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BacklogRowGhost } from '~/components/dispatch/ui/sidebar/backlog-group'
import { SidebarDragOverlay } from '~/components/global/sidebar/tree/sidebar-drag-overlay'
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
        kind?: 'GROUP' | 'FOLDER' | 'ITEM'
        label?: string
        item?: Parameters<typeof BacklogRowGhost>[0]['item']
      }
    | undefined
  if (!data) return null

  switch (data.type) {
    case 'thread':
      return <MailThreadItemDragOverlay items={data.draggedThreadIds ?? []} isDragging />
    case 'sidebar-node':
      return <SidebarDragOverlay kind={data.kind ?? 'ITEM'} label={data.label ?? ''} />
    case 'backlog-visit':
    case 'planner-backlog':
    case 'planner-stop':
      return data.item ? <BacklogRowGhost item={data.item} /> : null
    default:
      return null
  }
}

/** Settles a dropped sidebar ghost into its slot with a slight overshoot (after Define). */
const SIDEBAR_DROP_ANIMATION: DropAnimation = {
  duration: 350,
  easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }),
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
  // The drop animation runs after `active` clears, so remember what was being dragged.
  const lastSidebarDrag = useRef(false)
  if (active) lastSidebarDrag.current = active.data.current?.type === 'sidebar-node'
  const isSidebarDrag = lastSidebarDrag.current

  useEffect(() => {
    setPortalContainer(document.body)
  }, [])

  // While a drag is in flight, flag the body so the global `body.dnd-dragging` rule pins the
  // cursor to a plain arrow (no text I-beam / per-element grab cursor bleeding through).
  useEffect(() => {
    if (!active) return
    document.body.classList.add('dnd-dragging')
    return () => document.body.classList.remove('dnd-dragging')
  }, [active])

  if (!portalContainer) return null

  return createPortal(
    <DragOverlay
      dropAnimation={isSidebarDrag ? SIDEBAR_DROP_ANIMATION : null}
      adjustScale={false}
      // Sidebar ghosts stay where they were grabbed so their tilt pivots on the grab point.
      modifiers={isSidebarDrag ? undefined : [snapCenterToCursor]}
      style={{ width: 'auto' }}
      className='w-auto'>
      {active ? renderAppDragGhost(active) : null}
    </DragOverlay>,
    portalContainer
  )
}
