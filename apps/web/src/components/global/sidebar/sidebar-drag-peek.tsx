// apps/web/src/components/global/sidebar/sidebar-drag-peek.tsx
'use client'

import { useSidebar } from '@auxx/ui/components/sidebar'
import { useDndMonitor } from '@dnd-kit/core'
import { useCallback, useEffect, useRef } from 'react'
import { isSidebarFavoriteDrag } from '~/components/favorites/drag-eligibility'

/** Distance from the left screen edge (px) that arms the spring-load timer. */
const EDGE_THRESHOLD = 48
/** Hover-at-edge dwell (ms) before the collapsed sidebar springs open for a drop. */
const SPRING_DELAY = 250
/** Grace period (ms) after a drop so a successful landing is visible before the overlay closes. */
const CLOSE_DELAY = 300

/**
 * Headless drag-to-peek spring-loader. Mounted inside the app-shell `DndContext` (and under the
 * `SidebarProvider`), it watches for sidebar-eligible drags (favorites) and, while the sidebar
 * is collapsed, floats the peek overlay open once the pointer dwells at the left screen edge —
 * so the favorites droppables (kept mounted even when collapsed) can receive the drop. The
 * sidebar stays collapsed throughout; the overlay slides away shortly after the drag ends.
 */
export function SidebarDragPeek() {
  const { state, setPeek, setHoldPeek } = useSidebar()

  const stateRef = useRef(state)
  stateRef.current = state

  const eligibleRef = useRef(false)
  const sprungRef = useRef(false)
  const pointerXRef = useRef(Number.POSITIVE_INFINITY)
  const springTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trackPointer = useCallback((e: PointerEvent) => {
    pointerXRef.current = e.clientX
  }, [])

  const cancelSpring = useCallback(() => {
    if (springTimer.current) clearTimeout(springTimer.current)
    springTimer.current = null
  }, [])

  const endDrag = useCallback(() => {
    document.removeEventListener('pointermove', trackPointer)
    cancelSpring()
    eligibleRef.current = false
    pointerXRef.current = Number.POSITIVE_INFINITY
    if (sprungRef.current) {
      sprungRef.current = false
      setHoldPeek(false)
      // Let a successful drop land visibly before the overlay slides away.
      if (closeTimer.current) clearTimeout(closeTimer.current)
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null
        setPeek(false)
      }, CLOSE_DELAY)
    }
  }, [trackPointer, cancelSpring, setHoldPeek, setPeek])

  useDndMonitor({
    onDragStart(event) {
      eligibleRef.current = isSidebarFavoriteDrag(event.active)
      sprungRef.current = false
      if (eligibleRef.current) {
        document.addEventListener('pointermove', trackPointer)
      }
    },
    onDragMove() {
      if (!eligibleRef.current || sprungRef.current) return
      if (stateRef.current !== 'collapsed') {
        cancelSpring()
        return
      }
      if (pointerXRef.current <= EDGE_THRESHOLD) {
        if (!springTimer.current) {
          springTimer.current = setTimeout(() => {
            springTimer.current = null
            sprungRef.current = true
            setPeek(true)
            setHoldPeek(true)
          }, SPRING_DELAY)
        }
      } else {
        cancelSpring()
      }
    },
    onDragEnd: endDrag,
    onDragCancel: endDrag,
  })

  // Safety net: drop the document listener + timers if we unmount mid-drag.
  useEffect(() => {
    return () => {
      document.removeEventListener('pointermove', trackPointer)
      if (springTimer.current) clearTimeout(springTimer.current)
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [trackPointer])

  return null
}
