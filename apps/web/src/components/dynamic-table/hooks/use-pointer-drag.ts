// apps/web/src/components/dynamic-table/hooks/use-pointer-drag.ts
'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Shared pointer-drag primitive: document-level pointermove/up listeners +
 * RAF auto-scroll loop when the pointer nears the scroll container's edges +
 * body cursor/user-select lock while a drag is active.
 *
 * Consumers (range-drag, fill-drag) pass their own onMove/onEnd callbacks.
 */

const AUTOSCROLL_EDGE = 30 // px
const AUTOSCROLL_MAX_SPEED = 18 // px/frame

export interface PointerDragBeginOptions {
  pointerId: number
  pointerX: number
  pointerY: number
  /** Fires on every pointermove and after each auto-scroll tick that moved the viewport. */
  onMove: (x: number, y: number) => void
  /** Fires on pointerup/pointercancel. */
  onEnd: () => void
  /** Fires on Escape keydown during the drag. */
  onEscape?: () => void
  /** Body cursor to lock during the drag (default: 'cell'). */
  cursor?: string
}

interface UsePointerDragOptions {
  enabled: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

interface DragState {
  active: boolean
  pointerId: number | null
  rafId: number | null
  lastX: number
  lastY: number
  onMove: ((x: number, y: number) => void) | null
  onEnd: (() => void) | null
  onEscape: (() => void) | null
  cursor: string
}

/**
 * Returns `begin(options)` — call from a pointerdown handler to start a drag.
 * All document-level plumbing (listeners, RAF, body lock) is owned by this hook.
 */
export function usePointerDrag({ enabled, scrollContainerRef }: UsePointerDragOptions) {
  const stateRef = useRef<DragState>({
    active: false,
    pointerId: null,
    rafId: null,
    lastX: 0,
    lastY: 0,
    onMove: null,
    onEnd: null,
    onEscape: null,
    cursor: 'cell',
  })

  const stopAutoscroll = useCallback(() => {
    const s = stateRef.current
    if (s.rafId !== null) {
      cancelAnimationFrame(s.rafId)
      s.rafId = null
    }
  }, [])

  const setBodyDragLock = useCallback((on: boolean, cursor: string) => {
    if (typeof document === 'undefined') return
    document.body.style.userSelect = on ? 'none' : ''
    document.body.style.cursor = on ? cursor : ''
  }, [])

  const endDrag = useCallback(() => {
    const s = stateRef.current
    if (!s.active) return
    s.active = false
    s.pointerId = null
    stopAutoscroll()
    setBodyDragLock(false, s.cursor)
    const onEnd = s.onEnd
    s.onMove = null
    s.onEnd = null
    s.onEscape = null
    onEnd?.()
  }, [stopAutoscroll, setBodyDragLock])

  const tickAutoscroll = useCallback(() => {
    const s = stateRef.current
    if (!s.active) return
    const container = scrollContainerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const { lastX, lastY } = s

    let dy = 0
    let dx = 0
    if (lastY < rect.top + AUTOSCROLL_EDGE) {
      const dist = Math.max(0, lastY - rect.top)
      dy = -Math.max(
        1,
        Math.round(((AUTOSCROLL_EDGE - dist) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED)
      )
    } else if (lastY > rect.bottom - AUTOSCROLL_EDGE) {
      const dist = Math.max(0, rect.bottom - lastY)
      dy = Math.max(
        1,
        Math.round(((AUTOSCROLL_EDGE - dist) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED)
      )
    }
    if (lastX < rect.left + AUTOSCROLL_EDGE) {
      const dist = Math.max(0, lastX - rect.left)
      dx = -Math.max(
        1,
        Math.round(((AUTOSCROLL_EDGE - dist) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED)
      )
    } else if (lastX > rect.right - AUTOSCROLL_EDGE) {
      const dist = Math.max(0, rect.right - lastX)
      dx = Math.max(
        1,
        Math.round(((AUTOSCROLL_EDGE - dist) / AUTOSCROLL_EDGE) * AUTOSCROLL_MAX_SPEED)
      )
    }

    if (dy !== 0 || dx !== 0) {
      container.scrollTop += dy
      container.scrollLeft += dx
      // The element under the pointer may have changed after scroll.
      s.onMove?.(lastX, lastY)
    }

    s.rafId = requestAnimationFrame(tickAutoscroll)
  }, [scrollContainerRef])

  const startAutoscroll = useCallback(() => {
    const s = stateRef.current
    if (s.rafId !== null) return
    s.rafId = requestAnimationFrame(tickAutoscroll)
  }, [tickAutoscroll])

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const s = stateRef.current
    if (!s.active) return
    if (s.pointerId !== null && e.pointerId !== s.pointerId) return
    s.lastX = e.clientX
    s.lastY = e.clientY
    s.onMove?.(e.clientX, e.clientY)
  }, [])

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      const s = stateRef.current
      if (!s.active) return
      if (s.pointerId !== null && e.pointerId !== s.pointerId) return
      endDrag()
    },
    [endDrag]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const s = stateRef.current
      if (!s.active) return
      if (e.key === 'Escape') {
        e.preventDefault()
        const onEscape = s.onEscape
        // Run onEscape first so consumers can clear their state, then end the drag.
        onEscape?.()
        endDrag()
      }
    },
    [endDrag]
  )

  useEffect(() => {
    if (!enabled) return
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerUp)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointercancel', handlePointerUp)
      document.removeEventListener('keydown', handleKeyDown)
      stopAutoscroll()
    }
  }, [enabled, handlePointerMove, handlePointerUp, handleKeyDown, stopAutoscroll])

  const begin = useCallback(
    (opts: PointerDragBeginOptions) => {
      const s = stateRef.current
      // If a previous drag never cleanly ended, reset first.
      if (s.active) endDrag()

      s.active = true
      s.pointerId = opts.pointerId
      s.lastX = opts.pointerX
      s.lastY = opts.pointerY
      s.onMove = opts.onMove
      s.onEnd = opts.onEnd
      s.onEscape = opts.onEscape ?? null
      s.cursor = opts.cursor ?? 'cell'
      setBodyDragLock(true, s.cursor)
      startAutoscroll()
    },
    [endDrag, startAutoscroll, setBodyDragLock]
  )

  // Safety: if component unmounts mid-drag, restore body styles.
  useEffect(() => {
    return () => {
      if (stateRef.current.active) setBodyDragLock(false, stateRef.current.cursor)
    }
  }, [setBodyDragLock])

  return { begin }
}
