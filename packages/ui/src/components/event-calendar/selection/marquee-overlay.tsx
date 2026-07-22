// packages/ui/src/components/event-calendar/selection/marquee-overlay.tsx

'use client'

import { useEffect, useState } from 'react'
import type { CalendarSelectionEngine } from './calendar-selection-context'

interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

/** Pixel distance a pointer must travel past `pointerdown` before a marquee gesture begins —
 * below this the gesture resolves as a plain click (§3.2's "plain click empty space" row). */
const MarqueeThresholdPx = 4

/** Elements a marquee must never start on — chips (`data-event-id`, or any `<button>`, since
 * every chip renders as one), the vertical-grid hour-zoom handles, and any other interactive
 * control. Landmines whose class-based selector would be fragile (timeline zoom/rail strips,
 * resize handles) opt out via `data-marquee-ignore` instead. */
const MarqueeIgnoreSelector =
  '[data-marquee-ignore], [data-event-id], [data-hour-zoom-handle], button, a, input, textarea, select, [role="button"]'

interface MarqueeOverlayProps {
  /** The view container `EventCalendar` already scopes its zoom/pan gestures to — the marquee's
   * pointerdown delegates from the same root so it composes with those gestures for free. */
  containerRef: React.RefObject<HTMLElement | null>
  engine: CalendarSelectionEngine
}

/**
 * Pointerdown-and-drag rectangle select over empty grid space (§3.2). A fixed-position overlay —
 * chip rects come from `getBoundingClientRect`, already in viewport space, so no scroll-offset
 * bookkeeping is needed. The hit-test runs at most once per animation frame while dragging.
 */
export function MarqueeOverlay({ containerRef, engine }: MarqueeOverlayProps) {
  const [rect, setRect] = useState<MarqueeRect | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `engine` is a stable per-mount identity (see useCalendarSelectionEngine)
  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    let active = false
    let startX = 0
    let startY = 0
    let unionBase = new Set<string>()
    let raf = 0
    let latest: { x: number; y: number } | null = null

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

    const flush = () => {
      raf = 0
      if (!active || !latest) return
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

    const onMove = (e: PointerEvent) => {
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < MarqueeThresholdPx) return
        active = true
        // Base to union hits into — the pre-drag selection when cmd/ctrl is held at drag start,
        // otherwise a marquee replaces the selection outright.
        unionBase = e.metaKey || e.ctrlKey ? new Set(engine.getSelectedIds()) : new Set<string>()
      }
      latest = { x: e.clientX, y: e.clientY }
      scheduleFlush()
    }

    const endGesture = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      // The commit already happened progressively (each `flush` calls `emitSelection`) — release
      // just ends the visual rectangle and, if a gesture actually occurred, arms the swallow so
      // the browser's post-release synthetic click doesn't also fire a slot-create/deselect.
      if (active) engine.markMarqueeReleased()
      active = false
      setRect(null)
    }
    const onUp = () => endGesture()

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const target = e.target
      if (target instanceof HTMLElement && target.closest(MarqueeIgnoreSelector)) return
      startX = e.clientX
      startY = e.clientY
      active = false
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

    root.addEventListener('pointerdown', onDown)
    return () => {
      root.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [containerRef])

  if (!rect) return null

  return (
    <div
      className='pointer-events-none fixed z-40 rounded-sm border border-primary bg-primary/10'
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    />
  )
}
