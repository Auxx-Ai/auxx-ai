// apps/web/src/components/editor/kb-article/block-drag-plugin.ts

import type { Slice } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const PLUGIN_KEY = new PluginKey('blockDrag')

function getBlockEl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  const gutter = target.closest<HTMLElement>('[data-block-drag-handle]')
  if (!gutter) return null
  return gutter.closest<HTMLElement>('[data-block]')
}

function blockPos(view: EditorView, blockEl: HTMLElement): number | null {
  const pos = view.posAtDOM(blockEl, 0)
  if (pos == null || pos < 0) return null
  const $pos = view.state.doc.resolve(pos)
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth)
    if (node.type.name === 'block') return $pos.before(depth)
  }
  return null
}

function serializeForClipboard(view: EditorView, slice: Slice): { dom: HTMLElement; text: string } {
  type ViewWithSerialize = EditorView & {
    serializeForClipboard?: (s: Slice) => { dom: HTMLElement; text: string }
  }
  const v = view as ViewWithSerialize
  if (typeof v.serializeForClipboard === 'function') {
    return v.serializeForClipboard(slice)
  }
  // Older PM (pre-2024) exposed __serializeForClipboard at the module level.
  // Drag still works via view.dragging — we just can't seed dataTransfer.
  const dom = document.createElement('div')
  return { dom, text: '' }
}

export function blockDragPlugin() {
  return new Plugin({
    key: PLUGIN_KEY,
    props: {
      handleDOMEvents: {
        dragstart(view, event) {
          const blockEl = getBlockEl(event.target)
          if (!blockEl || !event.dataTransfer) return false

          const pos = blockPos(view, blockEl)
          if (pos == null) return false

          // Build the slice from the block at `pos` without dispatching a
          // selection change — re-rendering mid-dragstart kills the native
          // drag in some browsers.
          const selection = NodeSelection.create(view.state.doc, pos)
          const slice = selection.content()
          const { dom, text } = serializeForClipboard(view, slice)
          event.dataTransfer.clearData()
          event.dataTransfer.setData('text/html', dom.innerHTML)
          event.dataTransfer.setData('text/plain', text)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setDragImage(blockEl, 0, 0)

          // Tell PM exactly which slice to move on drop. PM has shifted the
          // dragging field between view.dragging and view.input.dragging
          // across releases, so set both.
          const dragging = { slice, move: true }
          const v = view as unknown as {
            dragging?: typeof dragging
            input?: { dragging?: typeof dragging }
          }
          v.dragging = dragging
          if (v.input) v.input.dragging = dragging

          document.body.classList.add('is-block-dragging')
          // Return true: skip PM's own dragstart handler so it does not
          // overwrite the dragging slice we just primed (it would otherwise
          // recompute from the document selection — which we did already set,
          // but the explicit dragging assignment is what survives across
          // versions).
          return true
        },

        dragend() {
          document.body.classList.remove('is-block-dragging')
          return false
        },

        drop() {
          document.body.classList.remove('is-block-dragging')
          return false
        },

        drag(_view, event) {
          const SCROLL_THRESHOLD = 80
          if (event.clientY < SCROLL_THRESHOLD) {
            window.scrollBy({ top: -30, behavior: 'smooth' })
          } else if (window.innerHeight - event.clientY < SCROLL_THRESHOLD) {
            window.scrollBy({ top: 30, behavior: 'smooth' })
          }
          return false
        },
      },
    },
  })
}
