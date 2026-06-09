// apps/web/src/components/editor/bubble-menu/use-bubble-menu-state.ts
'use client'

import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'

export interface BubbleMenuRange {
  from: number
  to: number
}

export interface BubbleMenuState {
  open: boolean
  rect: DOMRect | null
  range: BubbleMenuRange
}

interface UseBubbleMenuStateOptions {
  editor: Editor | null
  shouldShow?: (ctx: { editor: Editor; from: number; to: number }) => boolean
  /** When `true`, the menu stays mounted even if the selection collapses or
   *  the editor loses focus — used while a nested popover (color picker, turn
   *  into menu) is open and steals focus from the editor. */
  forceOpen?: boolean
  /** Returns the bubble popover content element. Used to keep the menu open
   *  when focus lives inside it (e.g. focus returned to a bubble button after a
   *  sub-popover closed) and to ignore clicks landing on it. */
  getMenuEl?: () => HTMLElement | null
}

let emptyRect: DOMRect | null = null
function getEmptyRect(): DOMRect {
  if (!emptyRect) emptyRect = new DOMRect()
  return emptyRect
}

function computeSelectionRect(editor: Editor): DOMRect | null {
  const domSel = typeof window !== 'undefined' ? window.getSelection() : null
  if (domSel && domSel.rangeCount > 0 && !domSel.isCollapsed) {
    const r = domSel.getRangeAt(0).getBoundingClientRect()
    if (r.width > 0 || r.height > 0) return r
  }
  // Fallback to PM coords — covers cases where the DOM selection is empty
  // (e.g. the editor was just programmatically updated).
  try {
    const { from, to } = editor.state.selection
    if (from === to) return null
    const start = editor.view.coordsAtPos(from)
    const end = editor.view.coordsAtPos(to)
    const left = Math.min(start.left, end.left)
    const top = Math.min(start.top, end.top)
    const right = Math.max(start.right, end.right)
    const bottom = Math.max(start.bottom, end.bottom)
    return new DOMRect(left, top, right - left, bottom - top)
  } catch {
    return null
  }
}

function defaultShouldShow(ctx: { editor: Editor; from: number; to: number }): boolean {
  const { editor, from, to } = ctx
  if (from === to) return false
  if (!editor.isEditable) return false
  // Hide entirely inside a codeBlock — Tiptap's `isActive('block', { blockType })`
  // checks the wrapping `block` node's attrs.
  if (editor.isActive('block', { blockType: 'codeBlock' })) return false
  return true
}

export function useBubbleMenuState({
  editor,
  shouldShow = defaultShouldShow,
  forceOpen = false,
  getMenuEl,
}: UseBubbleMenuStateOptions): BubbleMenuState {
  const [state, setState] = useState<BubbleMenuState>({
    open: false,
    rect: null,
    range: { from: 0, to: 0 },
  })

  // Read latest values inside the effect's listeners without re-subscribing.
  const forceOpenRef = useRef(forceOpen)
  forceOpenRef.current = forceOpen
  const getMenuElRef = useRef(getMenuEl)
  getMenuElRef.current = getMenuEl

  useEffect(() => {
    if (!editor) return

    let rafId: number | null = null

    // The bubble follows the text selection, which ProseMirror keeps intact on
    // blur — so selection alone can't tell us the user clicked away. Keep it
    // open only while focus is in the editor, a sub-popover is open, or focus
    // returned to the bubble itself.
    const hasFocus = () => {
      if (editor.isFocused || forceOpenRef.current) return true
      const active = typeof document !== 'undefined' ? document.activeElement : null
      return !!(active && getMenuElRef.current?.()?.contains(active))
    }

    const compute = () => {
      rafId = null
      if (editor.isDestroyed) return
      const { from, to } = editor.state.selection
      const ok = hasFocus() && shouldShow({ editor, from, to })
      if (!ok) {
        setState((prev) => (prev.open ? { ...prev, open: false } : prev))
        return
      }
      const rect = computeSelectionRect(editor)
      if (!rect) {
        setState((prev) => (prev.open ? { ...prev, open: false } : prev))
        return
      }
      setState({ open: true, rect, range: { from, to } })
    }

    const schedule = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(compute)
    }

    // Close on a click outside the editor and outside any popover (the bubble
    // itself or a sub-popover). Needed because when the editor is already
    // blurred — e.g. focus sits on a bubble button after a sub-popover closed —
    // clicking away fires no editor `blur`, so `compute` would never run.
    const onPointerDown = (e: PointerEvent) => {
      if (editor.isDestroyed) return
      const target = e.target as Element | null
      if (!target) return
      if (editor.view.dom.contains(target)) return
      if (getMenuElRef.current?.()?.contains(target)) return
      // Radix portals popovers to <body>; ignore clicks inside any of them.
      if (target.closest('[data-radix-popper-content-wrapper]')) return
      setState((prev) => (prev.open ? { ...prev, open: false } : prev))
    }

    editor.on('selectionUpdate', schedule)
    editor.on('transaction', schedule)
    editor.on('blur', schedule)
    editor.on('focus', schedule)

    // Reposition on viewport changes too.
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    document.addEventListener('pointerdown', onPointerDown, true)

    schedule()

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      editor.off('selectionUpdate', schedule)
      editor.off('transaction', schedule)
      editor.off('blur', schedule)
      editor.off('focus', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [editor, shouldShow])

  if (forceOpen && state.rect) {
    return { ...state, open: true }
  }
  // Avoid returning a null rect downstream — keeps Radix happy when the menu
  // is transitioning closed.
  return state.rect ? state : { ...state, rect: getEmptyRect() }
}
