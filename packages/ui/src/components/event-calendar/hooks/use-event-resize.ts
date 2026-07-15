// packages/ui/src/components/event-calendar/hooks/use-event-resize.ts

'use client'

import { addMinutes, differenceInMinutes } from 'date-fns'
import { useCallback, useRef, useState } from 'react'

import { MinEventDurationMinutes, SnapMinutes } from '../constants'
import type { EventCalendarItem } from '../types'

/** Which edge of the chip the active resize gesture is dragging. */
export type ResizeEdge = 'top' | 'bottom'

interface UseEventResizeOptions<T extends EventCalendarItem> {
  event: T
  /** Pixels per hour (`WeekCellsHeight`) — used to translate pointer delta into minutes. */
  cellHeight: number
  onResize?: (event: T, newStart: Date, newEnd: Date) => void
}

interface ResizeHandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void
}

export interface UseEventResizeResult {
  isResizing: boolean
  /** Live preview height (px) while dragging a handle — falls back to the chip's own height when idle. */
  previewHeight: number | null
  /**
   * Live preview vertical offset (px) while dragging the TOP handle — the chip's top edge moves
   * up/down (negative = up) so the bottom edge stays visually fixed. Always 0 for the bottom handle.
   */
  previewOffsetY: number
  /** Returns the pointer handlers for one edge; the handler captures that edge on pointerdown. */
  getResizeHandleProps: (edge: ResizeEdge) => ResizeHandleProps
}

/**
 * Two-edge resize handles for week/day/resource event chips: the top handle drags the start
 * time, the bottom handle drags the end time — in both cases the OPPOSITE edge stays visually
 * fixed.
 *
 * Deliberately NOT routed through dnd-kit — resize needs its own vertical-only drag rooted at a
 * chip edge, and layering a second dnd-kit draggable on top of `DraggableEvent`'s existing
 * move-drag is more fragile than a plain pointer-capture handler scoped to the handle element.
 * The handle calls `e.stopPropagation()` on pointerdown so it never bubbles into the parent
 * chip's drag-move listeners.
 */
export function useEventResize<T extends EventCalendarItem>({
  event,
  cellHeight,
  onResize,
}: UseEventResizeOptions<T>): UseEventResizeResult {
  const [isResizing, setIsResizing] = useState(false)
  const [previewHeight, setPreviewHeight] = useState<number | null>(null)
  const [previewOffsetY, setPreviewOffsetY] = useState(0)
  const startRef = useRef<{ pointerY: number; startHeight: number; edge: ResizeEdge } | null>(null)

  const pixelsPerMinute = cellHeight / 60
  const minHeight = MinEventDurationMinutes * pixelsPerMinute

  const handlePointerDown = useCallback(
    (edge: ResizeEdge, e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const duration = differenceInMinutes(new Date(event.end), new Date(event.start))
      const startHeight = duration * pixelsPerMinute
      startRef.current = { pointerY: e.clientY, startHeight, edge }
      setIsResizing(true)
      setPreviewHeight(startHeight)
      setPreviewOffsetY(0)
    },
    [event.start, event.end, pixelsPerMinute]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return
      e.stopPropagation()
      const { pointerY, startHeight, edge } = startRef.current
      const deltaY = e.clientY - pointerY
      if (edge === 'bottom') {
        setPreviewHeight(Math.max(minHeight, startHeight + deltaY))
        setPreviewOffsetY(0)
      } else {
        // Top edge: growing the chip means its top moves up (negative offset), bottom stays put.
        const nextHeight = Math.max(minHeight, startHeight - deltaY)
        setPreviewHeight(nextHeight)
        setPreviewOffsetY(startHeight - nextHeight)
      }
    },
    [minHeight]
  )

  const finishResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return
      e.stopPropagation()
      const { pointerY, edge } = startRef.current
      const deltaY = e.clientY - pointerY
      const deltaMinutes = deltaY / pixelsPerMinute
      const start = new Date(event.start)
      const end = new Date(event.end)
      const duration = differenceInMinutes(end, start)

      startRef.current = null
      setIsResizing(false)
      setPreviewHeight(null)
      setPreviewOffsetY(0)

      if (edge === 'bottom') {
        const newDuration = Math.max(
          MinEventDurationMinutes,
          Math.round((duration + deltaMinutes) / SnapMinutes) * SnapMinutes
        )
        if (newDuration !== duration) {
          onResize?.(event, start, addMinutes(start, newDuration))
        }
      } else {
        const snappedDelta = Math.round(deltaMinutes / SnapMinutes) * SnapMinutes
        // Clamp so the remaining duration never drops below the minimum: newStart can be no
        // later than `end - MinEventDurationMinutes`.
        const maxStart = addMinutes(end, -MinEventDurationMinutes)
        let newStart = addMinutes(start, snappedDelta)
        if (newStart > maxStart) newStart = maxStart
        if (newStart.getTime() !== start.getTime()) {
          onResize?.(event, newStart, end)
        }
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
    setPreviewOffsetY(0)
  }, [])

  const getResizeHandleProps = useCallback(
    (edge: ResizeEdge): ResizeHandleProps => ({
      onPointerDown: (e) => handlePointerDown(edge, e),
      onPointerMove: handlePointerMove,
      onPointerUp: finishResize,
      onPointerCancel: cancelResize,
    }),
    [handlePointerDown, handlePointerMove, finishResize, cancelResize]
  )

  return {
    isResizing,
    previewHeight,
    previewOffsetY,
    getResizeHandleProps,
  }
}
