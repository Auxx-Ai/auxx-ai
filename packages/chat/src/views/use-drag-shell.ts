// packages/chat/src/views/use-drag-shell.ts
//
// Pointer-drag controller for the floating chat shell. While `enabled`, a
// pointerdown on `headerEl` (anywhere that's not a button / link / form
// control / `[data-no-drag]`) starts a drag — subsequent pointermove events
// update the position via `onPositionChange`, clamped to the viewport.
// Uses Pointer Events + `setPointerCapture` so the same path handles mouse,
// touch, and pen across both shadow and light DOM.

import { useEffect, useRef } from 'preact/hooks'

interface Position {
  x: number
  y: number
}

interface UseDragShellArgs {
  enabled: boolean
  shellEl: HTMLElement | null
  headerEl: HTMLElement | null
  position: Position | null
  onPositionChange: (next: Position) => void
}

const EDGE_GAP = 8

function clampToViewport(pos: Position, width: number, height: number): Position {
  const maxX = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP)
  const maxY = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP)
  return {
    x: Math.min(Math.max(EDGE_GAP, pos.x), maxX),
    y: Math.min(Math.max(EDGE_GAP, pos.y), maxY),
  }
}

function isInteractiveTarget(target: EventTarget | null, header: HTMLElement): boolean {
  let node: Node | null = target instanceof Node ? target : null
  while (node && node !== header) {
    if (node instanceof HTMLElement) {
      if (node.dataset.noDrag !== undefined) return true
      const tag = node.tagName
      if (
        tag === 'BUTTON' ||
        tag === 'A' ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'LABEL'
      ) {
        return true
      }
      if (node.getAttribute('role') === 'button') return true
    }
    node = node.parentNode
  }
  return false
}

export function useDragShell({
  enabled,
  shellEl,
  headerEl,
  position,
  onPositionChange,
}: UseDragShellArgs): void {
  const positionRef = useRef<Position | null>(position)
  const callbackRef = useRef(onPositionChange)

  useEffect(() => {
    positionRef.current = position
  }, [position])

  useEffect(() => {
    callbackRef.current = onPositionChange
  }, [onPositionChange])

  useEffect(() => {
    if (!enabled || !headerEl || !shellEl) return

    let dragging = false
    let pointerId = -1
    let startX = 0
    let startY = 0
    let startPosX = 0
    let startPosY = 0
    let width = 0
    let height = 0

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (isInteractiveTarget(e.target, headerEl)) return
      const current = positionRef.current
      if (!current) return
      const rect = shellEl.getBoundingClientRect()
      width = rect.width
      height = rect.height
      startX = e.clientX
      startY = e.clientY
      startPosX = current.x
      startPosY = current.y
      pointerId = e.pointerId
      dragging = true
      headerEl.classList.add('is-dragging')
      try {
        headerEl.setPointerCapture(pointerId)
      } catch {
        /* ignore */
      }
      e.preventDefault()
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return
      const next = clampToViewport(
        { x: startPosX + (e.clientX - startX), y: startPosY + (e.clientY - startY) },
        width,
        height
      )
      callbackRef.current(next)
    }

    const endDrag = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return
      dragging = false
      headerEl.classList.remove('is-dragging')
      try {
        headerEl.releasePointerCapture(pointerId)
      } catch {
        /* ignore */
      }
    }

    const onResize = () => {
      const current = positionRef.current
      if (!current) return
      const rect = shellEl.getBoundingClientRect()
      callbackRef.current(clampToViewport(current, rect.width, rect.height))
    }

    headerEl.classList.add('auxx-chat-drag-handle')
    headerEl.addEventListener('pointerdown', onPointerDown)
    headerEl.addEventListener('pointermove', onPointerMove)
    headerEl.addEventListener('pointerup', endDrag)
    headerEl.addEventListener('pointercancel', endDrag)
    window.addEventListener('resize', onResize)

    return () => {
      headerEl.removeEventListener('pointerdown', onPointerDown)
      headerEl.removeEventListener('pointermove', onPointerMove)
      headerEl.removeEventListener('pointerup', endDrag)
      headerEl.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('resize', onResize)
      headerEl.classList.remove('is-dragging')
      headerEl.classList.remove('auxx-chat-drag-handle')
    }
  }, [enabled, shellEl, headerEl])
}

export { clampToViewport }
