// packages/ui/src/components/event-calendar/hooks/use-event-resize.ts

'use client'

import { addMinutes, differenceInMinutes } from 'date-fns'
import { useCallback, useRef, useState } from 'react'

import { MinEventDurationMinutes, SnapMinutes } from '../constants'
import type { EventCalendarItem } from '../types'

interface UseEventResizeOptions<T extends EventCalendarItem> {
  event: T
  /** Pixels per hour (`WeekCellsHeight`) — used to translate pointer delta into minutes. */
  cellHeight: number
  onResize?: (event: T, newEnd: Date) => void
}

export interface UseEventResizeResult {
  isResizing: boolean
  /** Live preview height (px) while dragging the handle — falls back to the chip's own height when idle. */
  previewHeight: number | null
  resizeHandleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void
  }
}

/**
 * Bottom-edge resize handle for week/day/resource event chips.
 *
 * Deliberately NOT routed through dnd-kit — resize needs its own vertical-only
 * drag rooted at the chip's bottom edge, and layering a second dnd-kit
 * draggable on top of `DraggableEvent`'s existing move-drag is more fragile
 * than a plain pointer-capture handler scoped to the handle element. The
 * handle calls `e.stopPropagation()` on pointerdown so it never bubbles into
 * the parent chip's drag-move listeners.
 */
export function useEventResize<T extends EventCalendarItem>({
  event,
  cellHeight,
  onResize,
}: UseEventResizeOptions<T>): UseEventResizeResult {
  const [isResizing, setIsResizing] = useState(false)
  const [previewHeight, setPreviewHeight] = useState<number | null>(null)
  const startRef = useRef<{ pointerY: number; startHeight: number } | null>(null)

  const pixelsPerMinute = cellHeight / 60
  const minHeight = MinEventDurationMinutes * pixelsPerMinute

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const duration = differenceInMinutes(new Date(event.end), new Date(event.start))
      const startHeight = duration * pixelsPerMinute
      startRef.current = { pointerY: e.clientY, startHeight }
      setIsResizing(true)
      setPreviewHeight(startHeight)
    },
    [event.start, event.end, pixelsPerMinute]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return
      e.stopPropagation()
      const deltaY = e.clientY - startRef.current.pointerY
      const rawHeight = startRef.current.startHeight + deltaY
      setPreviewHeight(Math.max(minHeight, rawHeight))
    },
    [minHeight]
  )

  const finishResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return
      e.stopPropagation()
      const deltaY = e.clientY - startRef.current.pointerY
      const deltaMinutes = deltaY / pixelsPerMinute
      const duration = differenceInMinutes(new Date(event.end), new Date(event.start))

      let newDuration = Math.round((duration + deltaMinutes) / SnapMinutes) * SnapMinutes
      newDuration = Math.max(MinEventDurationMinutes, newDuration)

      startRef.current = null
      setIsResizing(false)
      setPreviewHeight(null)

      if (newDuration !== duration) {
        onResize?.(event, addMinutes(new Date(event.start), newDuration))
      }
    },
    [event, pixelsPerMinute, onResize]
  )

  const cancelResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    e.stopPropagation()
    startRef.current = null
    setIsResizing(false)
    setPreviewHeight(null)
  }, [])

  return {
    isResizing,
    previewHeight,
    resizeHandleProps: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishResize,
      onPointerCancel: cancelResize,
    },
  }
}
