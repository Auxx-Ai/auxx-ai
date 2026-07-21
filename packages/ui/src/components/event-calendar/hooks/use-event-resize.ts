// packages/ui/src/components/event-calendar/hooks/use-event-resize.ts

'use client'

import { addMinutes, differenceInMinutes } from 'date-fns'
import { useCallback, useRef, useState } from 'react'

import { MinEventDurationMinutes, SnapMinutes } from '../constants'
import type { EventCalendarItem } from '../types'

/**
 * Which edge of the chip the active resize gesture is dragging. `'start'` is the top edge on a
 * vertical (`axis: 'y'`) chip or the left edge on a horizontal (`axis: 'x'`) chip; `'end'` is the
 * bottom/right edge respectively.
 */
export type ResizeEdge = 'start' | 'end'

interface UseEventResizeOptions<T extends EventCalendarItem> {
  event: T
  /**
   * Pixels per hour along the resize axis — used to translate pointer delta into minutes.
   * `WeekCellsHeight` for `axis: 'y'`, `TimelineHourWidth` for `axis: 'x'`.
   */
  cellSize: number
  /** Which pointer axis drives the resize — `'y'` reads `clientY` (default), `'x'` reads `clientX`. */
  axis?: 'x' | 'y'
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
  /** Live preview chip size (px) along the resize axis while dragging a handle — falls back to the chip's own size when idle. */
  previewSize: number | null
  /**
   * Live preview offset (px) along the resize axis while dragging the START handle — shifts the
   * chip's start edge (negative = toward the origin) so the END edge stays visually fixed while
   * the chip grows/shrinks. Always 0 while dragging the end handle (its start edge never moves).
   */
  previewOffset: number
  /** Returns the pointer handlers for one edge; the handler captures that edge on pointerdown. */
  getResizeHandleProps: (edge: ResizeEdge) => ResizeHandleProps
}

/**
 * Two-edge resize handles for timed event chips: the start handle drags the start time, the end
 * handle drags the end time — in both cases the OPPOSITE edge stays visually fixed. `axis`
 * selects the pointer/orientation: `'y'` (default) for week/day/resource's vertical chips,
 * `'x'` for the horizontal timeline's chips. The date math (15-min snap, min-duration clamp) is
 * identical on both axes.
 *
 * Deliberately NOT routed through dnd-kit — resize needs its own single-axis drag rooted at a
 * chip edge, and layering a second dnd-kit draggable on top of `DraggableEvent`'s existing
 * move-drag is more fragile than a plain pointer-capture handler scoped to the handle element.
 * The handle calls `e.stopPropagation()` on pointerdown so it never bubbles into the parent
 * chip's drag-move listeners.
 */
export function useEventResize<T extends EventCalendarItem>({
  event,
  cellSize,
  axis = 'y',
  onResize,
}: UseEventResizeOptions<T>): UseEventResizeResult {
  const [isResizing, setIsResizing] = useState(false)
  const [previewSize, setPreviewSize] = useState<number | null>(null)
  const [previewOffset, setPreviewOffset] = useState(0)
  const startRef = useRef<{ pointerPos: number; startSize: number; edge: ResizeEdge } | null>(null)

  const pixelsPerMinute = cellSize / 60
  const minSize = MinEventDurationMinutes * pixelsPerMinute

  const readPointerPos = useCallback(
    (e: { clientX: number; clientY: number }) => (axis === 'x' ? e.clientX : e.clientY),
    [axis]
  )

  const handlePointerDown = useCallback(
    (edge: ResizeEdge, e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const duration = differenceInMinutes(new Date(event.end), new Date(event.start))
      const startSize = duration * pixelsPerMinute
      startRef.current = { pointerPos: readPointerPos(e), startSize, edge }
      setIsResizing(true)
      setPreviewSize(startSize)
      setPreviewOffset(0)
    },
    [event.start, event.end, pixelsPerMinute, readPointerPos]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return
      e.stopPropagation()
      const { pointerPos, startSize, edge } = startRef.current
      const delta = readPointerPos(e) - pointerPos
      if (edge === 'end') {
        setPreviewSize(Math.max(minSize, startSize + delta))
        setPreviewOffset(0)
      } else {
        // Start edge: growing the chip means its start moves toward the origin (negative
        // offset), the end edge stays put.
        const nextSize = Math.max(minSize, startSize - delta)
        setPreviewSize(nextSize)
        setPreviewOffset(startSize - nextSize)
      }
    },
    [minSize, readPointerPos]
  )

  const finishResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return
      e.stopPropagation()
      const { pointerPos, edge } = startRef.current
      const delta = readPointerPos(e) - pointerPos
      const deltaMinutes = delta / pixelsPerMinute
      const start = new Date(event.start)
      const end = new Date(event.end)
      const duration = differenceInMinutes(end, start)

      startRef.current = null
      setIsResizing(false)
      setPreviewSize(null)
      setPreviewOffset(0)

      if (edge === 'end') {
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
    [event, pixelsPerMinute, onResize, readPointerPos]
  )

  const cancelResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    e.stopPropagation()
    startRef.current = null
    setIsResizing(false)
    setPreviewSize(null)
    setPreviewOffset(0)
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
    previewSize,
    previewOffset,
    getResizeHandleProps,
  }
}
