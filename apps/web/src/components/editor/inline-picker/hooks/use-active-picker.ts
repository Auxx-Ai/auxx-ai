// apps/web/src/components/editor/inline-picker/hooks/use-active-picker.ts

'use client'

import type { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { REFERENCE_PICKER_NODE, type ReferenceTab } from '../nodes/reference-picker-node'

const ZWSP_RE = /​/g

export interface ActivePickerState {
  /** Document position of the picker chip's opening token. */
  pos: number
  /** Current tab attribute on the chip. */
  tab: ReferenceTab
  /** Plain-text content inside the chip's search hole. */
  query: string
  /** Bounding rect of the chip DOM, used to anchor the popover. */
  clientRect: DOMRect | null
  /** Stable id that changes whenever the chip's pos/tab/query changes. */
  signature: string
}

function readActivePicker(editor: Editor): ActivePickerState | null {
  let found: { pos: number; node: import('@tiptap/pm/model').Node } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === REFERENCE_PICKER_NODE) {
      found = { pos, node }
      return false
    }
    return undefined
  })
  if (!found) return null
  const { pos, node } = found as { pos: number; node: import('@tiptap/pm/model').Node }
  const tab = (node.attrs.tab ?? 'people') as ReferenceTab
  // Strip the seed ZWSP (used to give PM a real DOM text node to anchor
  // beforeinput on) from the user-visible query.
  const query = node.textContent.replace(ZWSP_RE, '')
  const dom = editor.view.nodeDOM(pos)
  const rect =
    dom instanceof HTMLElement
      ? dom.getBoundingClientRect()
      : dom instanceof Element
        ? dom.getBoundingClientRect()
        : null
  return {
    pos,
    tab,
    query,
    clientRect: rect,
    signature: `${pos}:${tab}:${query}`,
  }
}

/**
 * Reactive view of the active reference-picker chip (at most one per doc).
 *
 * Returns `null` when no chip is open. Subscribes to editor transactions so
 * React renders whenever the chip's tab attribute or query content changes.
 *
 * NOTE: also subscribes to `update` (TipTap fires this when doc content
 * changes, including text-only inserts inside an inline `text*` node — the
 * `transaction` event alone proved unreliable for chip query updates in
 * practice).
 */
export function useActivePicker(editor: Editor | null): ActivePickerState | null {
  const [state, setState] = useState<ActivePickerState | null>(null)

  useEffect(() => {
    if (!editor) {
      setState(null)
      return
    }
    const update = () => {
      const next = readActivePicker(editor)
      setState((prev) => {
        if (!prev && !next) return prev
        if (!prev || !next) return next
        if (prev.signature === next.signature) return prev
        return next
      })
    }
    update()
    editor.on('transaction', update)
    editor.on('selectionUpdate', update)
    editor.on('update', update)
    return () => {
      editor.off('transaction', update)
      editor.off('selectionUpdate', update)
      editor.off('update', update)
    }
  }, [editor])

  return state
}
