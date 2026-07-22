// packages/ui/src/components/event-calendar/selection/create-ghost-overlay.tsx

'use client'

import { format } from 'date-fns'
import { useEffect, useState } from 'react'

import { TimeRangePill } from '../time-range-pill'

/** A fixed-position (viewport-space) rectangle — the ghost block's on-screen geometry. */
export interface GhostRect {
  left: number
  top: number
  width: number
  height: number
}

/** The live drag-create ghost — a rect plus the painted range for the readout pill. */
export interface TransientGhost {
  rect: GhostRect
  start: Date
  end: Date
}

interface CreateGhostOverlayProps {
  /** Set while a cmd+drag-create is in flight — takes precedence and renders the `TimeRangePill`. */
  transient: TransientGhost | null
  /** Set while a create popover is open (plan 44 decision C) — resolved from the slot's data
   * attributes so the ghost persists under the popover. Month view (no `data-slot-time`) resolves
   * to nothing and renders no ghost. */
  pendingSlot: { start: Date; end: Date; resourceId?: string } | null
  /** The view container the pending slot's cell is resolved within (and re-resolved on scroll). */
  containerRef: React.RefObject<HTMLElement | null>
}

const QuarterMs = 15 * 60 * 1000

/** Resolve a pending slot's on-screen rect from the rendered quarter-hour cell's data attributes. */
function resolvePendingRect(
  root: HTMLElement,
  pending: { start: Date; end: Date; resourceId?: string }
): GhostRect | null {
  const dateStr = format(pending.start, 'yyyy-MM-dd')
  const frac = pending.start.getHours() + pending.start.getMinutes() / 60
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(`[data-slot-date="${dateStr}"][data-slot-time="${frac}"]`)
  )
  const cell = pending.resourceId
    ? candidates.find((el) => el.getAttribute('data-slot-resource') === pending.resourceId)
    : candidates[0]
  if (!cell) return null

  const rect = cell.getBoundingClientRect()
  const axis = cell.dataset.slotAxis === 'x' ? 'x' : 'y'
  const cellSize = axis === 'x' ? rect.width : rect.height
  const quarters = Math.max(
    1,
    Math.round((pending.end.getTime() - pending.start.getTime()) / QuarterMs)
  )

  return axis === 'x'
    ? { left: rect.left, top: rect.top, width: quarters * cellSize, height: rect.height }
    : { left: rect.left, top: rect.top, width: rect.width, height: quarters * cellSize }
}

const GhostClass =
  'pointer-events-none fixed z-40 rounded-md border border-primary bg-primary/20 shadow-sm'

/**
 * The "event being born" block (plan 44 decision C) — a primary-tinted translucent rect, distinct
 * from the marquee's thin outline. Two modes over one rect pipeline: the transient drag-create
 * ghost (with a live `TimeRangePill`), and the pending ghost that persists while a create popover
 * is open, re-resolving against the DOM on scroll/resize so it tracks the slot it was born at.
 */
export function CreateGhostOverlay({
  transient,
  pendingSlot,
  containerRef,
}: CreateGhostOverlayProps) {
  const [pendingRect, setPendingRect] = useState<GhostRect | null>(null)

  // Resolve (and keep tracking) the pending slot's cell — skipped entirely while a transient drag
  // ghost is showing, since that one owns the screen. rAF-throttled against scroll/resize so a
  // popover-open ghost follows its slot as the grid scrolls, and vanishes when it scrolls away.
  useEffect(() => {
    if (transient || !pendingSlot) {
      setPendingRect(null)
      return
    }
    const root = containerRef.current
    if (!root) return

    let raf = 0
    const update = () => {
      raf = 0
      setPendingRect(resolvePendingRect(root, pendingSlot))
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [transient, pendingSlot, containerRef])

  if (transient) {
    const { rect, start, end } = transient
    return (
      <>
        <div
          className={GhostClass}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
        <div
          className='pointer-events-none fixed z-40'
          style={{ left: rect.left + 4, top: rect.top - 22 }}>
          <TimeRangePill start={start} end={end} />
        </div>
      </>
    )
  }

  if (pendingRect) {
    return (
      <div
        className={GhostClass}
        style={{
          left: pendingRect.left,
          top: pendingRect.top,
          width: pendingRect.width,
          height: pendingRect.height,
        }}
      />
    )
  }

  return null
}
