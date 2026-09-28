// apps/web/src/hooks/use-drag-tilt.ts
'use client'

import { useDndContext, useDndMonitor } from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { useReducedMotion } from 'motion/react'
import { useRef, useState } from 'react'

const TILT_DEG = 2

/**
 * Motion props for a drag ghost: tilts with the last vertical move, pivoting on the grab point
 * (after Define). Call from inside the ghost, within the drag's `DndContext`.
 */
export function useDragTilt() {
  // activeNodeRect is the source row; active.rect.current.initial measures the overlay itself.
  const { activatorEvent, activeNodeRect } = useDndContext()
  const reduceMotion = useReducedMotion()
  const [direction, setDirection] = useState<'up' | 'down' | null>(null)
  const lastY = useRef(0)
  // The context clears on drop while the ghost is still flying home; keep the last frame.
  const frame = useRef<{ origin: string; width: number; grabbedRight: boolean } | null>(null)

  useDndMonitor({
    onDragMove({ delta }) {
      // A dead zone of 1px keeps the tilt until the pointer actually reverses.
      const step = delta.y - lastY.current
      if (step < -1) setDirection('up')
      else if (step > 1) setDirection('down')
      lastY.current = delta.y
    },
    // Straighten while the drop animation carries the ghost into its slot.
    onDragEnd: () => setDirection(null),
    onDragCancel: () => setDirection(null),
  })

  // Pixels, not %: a group/folder's rect spans its children, but the ghost is only the header row.
  const point = activatorEvent ? getEventCoordinates(activatorEvent) : null
  if (activeNodeRect && point) {
    frame.current = {
      origin: `${point.x - activeNodeRect.left}px ${point.y - activeNodeRect.top}px`,
      width: activeNodeRect.width,
      grabbedRight: point.x - activeNodeRect.left > activeNodeRect.width / 2,
    }
  }
  // The free end trails the pointer, so a right-hand grab swings the other way.
  const sign = (direction === 'down' ? -1 : 1) * (frame.current?.grabbedRight ? -1 : 1)
  const rotate = reduceMotion || !direction ? 0 : sign * TILT_DEG
  return {
    // Source-row width keeps the grab point on the ghost; the overlay must not be cursor-snapped.
    style: { transformOrigin: frame.current?.origin ?? 'center', width: frame.current?.width },
    animate: { rotate },
    transition: { type: 'spring', bounce: 0, duration: 0.15 },
  } as const
}
