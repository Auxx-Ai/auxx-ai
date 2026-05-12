// apps/web/src/components/editor/bubble-menu/use-bubble-menu-state.ts
'use client'

import type { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'

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
}

const EMPTY_RECT = new DOMRect()

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
}: UseBubbleMenuStateOptions): BubbleMenuState {
  const [state, setState] = useState<BubbleMenuState>({
    open: false,
    rect: null,
    range: { from: 0, to: 0 },
  })

  useEffect(() => {
    if (!editor) return

    let rafId: number | null = null

    const compute = () => {
      rafId = null
      if (editor.isDestroyed) return
      const { from, to } = editor.state.selection
      const ok = shouldShow({ editor, from, to })
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

    editor.on('selectionUpdate', schedule)
    editor.on('transaction', schedule)
    editor.on('blur', schedule)
    editor.on('focus', schedule)

    // Reposition on viewport changes too.
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)

    schedule()

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      editor.off('selectionUpdate', schedule)
      editor.off('transaction', schedule)
      editor.off('blur', schedule)
      editor.off('focus', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [editor, shouldShow])

  if (forceOpen && state.rect) {
    return { ...state, open: true }
  }
  // Avoid returning a null rect downstream — keeps Radix happy when the menu
  // is transitioning closed.
  return state.rect ? state : { ...state, rect: EMPTY_RECT }
}
