// packages/ui/src/components/event-calendar/selection/empty-space-drag.tsx

'use client'

import { addMinutes } from 'date-fns'
import { useEffect, useRef, useState } from 'react'

import type { SlotCreateIntent } from '../types'
import type { CalendarSelectionEngine } from './calendar-selection-context'
import { CreateGhostOverlay, type GhostRect, type TransientGhost } from './create-ghost-overlay'

/** Pixel distance a pointer must travel past `pointerdown` before an empty-space drag begins —
 * below this the gesture resolves as a plain click (a no-op now that create is double-click). */
const ActivationThresholdPx = 4

/** Elements an empty-space drag must never start on — chips (`data-event-id`, or any `<button>`,
 * since every chip renders as one), the vertical-grid hour-zoom handles, and other interactive
 * controls. Landmines whose class-based selector would be fragile (timeline zoom/rail strips,
 * resize handles) opt out via `data-marquee-ignore` instead. */
const IgnoreSelector =
  '[data-marquee-ignore], [data-event-id], [data-hour-zoom-handle], button, a, input, textarea, select, [role="button"]'

const QuarterMinutes = 15

interface EmptySpaceDragLayerProps {
  /** The view container `EventCalendar` already scopes its zoom/pan gestures to — the drag's
   * pointerdown delegates from the same root so it composes with those gestures for free. */
  containerRef: React.RefObject<HTMLElement | null>
  engine: CalendarSelectionEngine
  /** Wired → cmd/ctrl+drag on a time-view cell paints a create range and emits this on release;
   * `undefined` (no create handler / month) degrades cmd+drag to a plain replace-marquee. */
  onDragCreate?: (intent: SlotCreateIntent) => void
  /** Controlled create ghost (plan 44 decision C) — the range echoed back while a create popover
   * is open; rendered as a persistent translucent block over the slot. */
  pendingCreateSlot?: { start: Date; end: Date; resourceId?: string } | null
}

interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

/** Parse a quarter-hour cell's `data-slot-*` attributes into an absolute slot start Date. */
function slotStartFromCell(cell: HTMLElement): Date | null {
  const dateStr = cell.dataset.slotDate
  const timeStr = cell.dataset.slotTime
  if (!dateStr || timeStr === undefined) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const frac = Number(timeStr)
  if ([y, m, d, frac].some((n) => n === undefined || !Number.isFinite(n))) return null
  const hours = Math.floor(frac)
  const minutes = Math.round((frac - hours) * 60)
  return new Date(y as number, (m as number) - 1, d as number, hours, minutes, 0, 0)
}

/**
 * The single empty-space drag router (plan 44 §3.3) — one delegated pointerdown on the view
 * container that, at the 4px activation crossing, routes on the modifiers held AT ACTIVATION:
 *
 * - cmd/ctrl + a time-view cell (`data-slot-time`) + a wired `onDragCreate` → **drag-create**: a
 *   15-min-snapped range painted geometrically from the start cell (one quarter-cell = 15 min, so
 *   the pointer can drift across columns or leave the grid), with a live ghost + `TimeRangePill`;
 * - shift → **union-marquee** (base = current selection);
 * - otherwise → **replace-marquee** (base = ∅).
 *
 * A fixed-position overlay — chip rects come from `getBoundingClientRect`, already viewport-space,
 * so no scroll-offset bookkeeping. The hit-test / range paint runs at most once per animation frame.
 */
export function EmptySpaceDragLayer({
  containerRef,
  engine,
  onDragCreate,
  pendingCreateSlot,
}: EmptySpaceDragLayerProps) {
  const [rect, setRect] = useState<MarqueeRect | null>(null)
  const [ghost, setGhost] = useState<TransientGhost | null>(null)

  const onDragCreateRef = useRef(onDragCreate)
  onDragCreateRef.current = onDragCreate

  // biome-ignore lint/correctness/useExhaustiveDependencies: `engine` is a stable per-mount identity (see useCalendarSelectionEngine)
  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    type Mode = 'marquee' | 'create'
    let active = false
    let mode: Mode = 'marquee'
    let startX = 0
    let startY = 0
    let unionBase = new Set<string>()
    let raf = 0
    let latest: { x: number; y: number } | null = null
    // Drag-create geometry, captured once at activation from the start cell.
    let createStartCell: HTMLElement | null = null
    let createAxis: 'x' | 'y' = 'y'
    let createCellRect: DOMRect | null = null
    let createCellSize = 0
    let createPressTime: Date | null = null
    let createResourceId: string | undefined
    let createRange: { start: Date; end: Date } | null = null

    const computeRect = (x: number, y: number): MarqueeRect => ({
      left: Math.min(startX, x),
      top: Math.min(startY, y),
      width: Math.abs(x - startX),
      height: Math.abs(y - startY),
    })

    const hitTest = (r: MarqueeRect) => {
      const hits = new Set<string>()
      const right = r.left + r.width
      const bottom = r.top + r.height
      for (const [id, element] of engine.getChipRegistry()) {
        const chipRect = element.getBoundingClientRect()
        if (
          chipRect.left < right &&
          chipRect.right > r.left &&
          chipRect.top < bottom &&
          chipRect.bottom > r.top
        ) {
          hits.add(id)
        }
      }
      return hits
    }

    const paintCreate = (x: number, y: number) => {
      if (!createCellRect || !createPressTime) return
      const delta = createAxis === 'x' ? x - startX : y - startY
      const steps = Math.round(delta / createCellSize)
      const current = addMinutes(createPressTime, steps * QuarterMinutes)
      const start = current < createPressTime ? current : createPressTime
      const end = addMinutes(current > createPressTime ? current : createPressTime, QuarterMinutes)
      createRange = { start, end }

      const span = (Math.abs(steps) + 1) * createCellSize
      const before = Math.min(0, steps) * createCellSize
      const ghostRect: GhostRect =
        createAxis === 'x'
          ? {
              left: createCellRect.left + before,
              top: createCellRect.top,
              width: span,
              height: createCellRect.height,
            }
          : {
              left: createCellRect.left,
              top: createCellRect.top + before,
              width: createCellRect.width,
              height: span,
            }
      setGhost({ rect: ghostRect, start, end })
    }

    const flush = () => {
      raf = 0
      if (!active || !latest) return
      if (mode === 'create') {
        paintCreate(latest.x, latest.y)
        return
      }
      const r = computeRect(latest.x, latest.y)
      setRect(r)
      const hits = hitTest(r)
      const next = new Set(unionBase)
      for (const id of hits) next.add(id)
      engine.emitSelection(next)
    }

    const scheduleFlush = () => {
      if (raf) return
      raf = requestAnimationFrame(flush)
    }

    const activate = (e: PointerEvent) => {
      const wantsCreate =
        (e.metaKey || e.ctrlKey) && createStartCell !== null && Boolean(onDragCreateRef.current)
      if (wantsCreate && createStartCell) {
        mode = 'create'
        createAxis = createStartCell.dataset.slotAxis === 'x' ? 'x' : 'y'
        createCellRect = createStartCell.getBoundingClientRect()
        createCellSize = createAxis === 'x' ? createCellRect.width : createCellRect.height
        createPressTime = slotStartFromCell(createStartCell)
        createResourceId = createStartCell.dataset.slotResource || undefined
        // A cell with no parseable time can't drive geometry — degrade to a marquee.
        if (!createPressTime || createCellSize <= 0) mode = 'marquee'
      } else {
        mode = 'marquee'
      }
      if (mode === 'marquee') {
        unionBase = e.shiftKey ? new Set(engine.getSelectedIds()) : new Set<string>()
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < ActivationThresholdPx) return
        active = true
        activate(e)
      }
      latest = { x: e.clientX, y: e.clientY }
      scheduleFlush()
    }

    const reset = () => {
      active = false
      mode = 'marquee'
      createStartCell = null
      createCellRect = null
      createPressTime = null
      createRange = null
      setRect(null)
      setGhost(null)
    }

    const endGesture = (commit: boolean) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      if (active) {
        if (commit && mode === 'create' && createRange && latest) {
          onDragCreateRef.current?.({
            start: createRange.start,
            end: createRange.end,
            resourceId: createResourceId,
            anchor: { x: latest.x, y: latest.y },
            gesture: 'drag',
          })
        }
        // Swallow the post-release synthetic click so it can't also fire a deselect (marquee) or a
        // stray create — for BOTH modes, matching the marquee's original release behavior.
        engine.markMarqueeReleased()
      }
      reset()
    }
    const onUp = () => endGesture(true)
    const onCancel = () => endGesture(false)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endGesture(false)
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const target = e.target
      if (!(target instanceof HTMLElement) || target.closest(IgnoreSelector)) return
      startX = e.clientX
      startY = e.clientY
      active = false
      mode = 'marquee'
      createRange = null
      // The quarter-hour cell the press landed on (drag-create eligible only if it has a time).
      const cell = target.closest<HTMLElement>('[data-slot-time]')
      createStartCell = cell
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKeyDown)
    }

    root.addEventListener('pointerdown', onDown)
    return () => {
      root.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [containerRef])

  return (
    <>
      {rect && (
        <div
          className='pointer-events-none fixed z-40 rounded-sm border border-primary bg-primary/10'
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      )}
      <CreateGhostOverlay
        transient={ghost}
        pendingSlot={pendingCreateSlot ?? null}
        containerRef={containerRef}
      />
    </>
  )
}
