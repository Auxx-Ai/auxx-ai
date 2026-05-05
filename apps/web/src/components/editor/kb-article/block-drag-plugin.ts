// apps/web/src/components/editor/kb-article/block-drag-plugin.ts

import type { Slice } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'

const PLUGIN_KEY = new PluginKey('blockDrag')

/**
 * Top-level draggable nodes. Containers (`tabs`, `accordion`) and `block`
 * sit directly under the doc; the article-level drag handle grabs the
 * outermost match. New container/format nodes (e.g. `table`) join with
 * one entry.
 */
const DRAGGABLE_NODE_TYPES = new Set<string>(['block', 'tabs', 'accordion'])

interface DraggingState {
  sourcePos: number
  nodeSize: number
  slice: Slice
}

function getBlockEl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  const gutter = target.closest<HTMLElement>('[data-block-drag-handle]')
  if (!gutter) return null
  // Article-level drag handles live on `[data-block]`. In-container
  // (panel) drag handles use a different attribute and are handled by
  // their own dnd-kit instance — bail out so we don't grab the panel
  // through this plugin.
  if (gutter.getAttribute('data-block-drag-handle') === 'panel') return null
  // Match either a flat block or a container element. Containers render
  // their own outer wrapper with `data-tabs` / `data-accordion`.
  return gutter.closest<HTMLElement>('[data-block], [data-tabs], [data-accordion]')
}

function blockPos(view: EditorView, blockEl: HTMLElement): number | null {
  const pos = view.posAtDOM(blockEl, 0)
  if (pos == null || pos < 0) return null
  const $pos = view.state.doc.resolve(pos)
  // Walk up to the OUTERMOST draggable so clicking the gutter next to a
  // tabs/accordion container grabs the whole container, not the active
  // panel's first paragraph.
  let outermost: { pos: number } | null = null
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth)
    if (DRAGGABLE_NODE_TYPES.has(node.type.name)) {
      outermost = { pos: $pos.before(depth) }
    }
  }
  return outermost ? outermost.pos : null
}

export function blockDragPlugin() {
  const instanceId = Math.random().toString(36).slice(2, 7)
  const tag = `[blockDrag #${instanceId}]`
  console.log(`${tag} plugin instance created`)

  return new Plugin({
    key: PLUGIN_KEY,
    view(editorView) {
      let dragging: DraggingState | null = null
      const dom = editorView.dom

      const onDragStart = (event: DragEvent) => {
        console.log(`${tag} dragstart on view.dom`, event.target)
        const blockEl = getBlockEl(event.target)
        if (!blockEl || !event.dataTransfer) {
          console.log(`${tag} dragstart bailed: no blockEl or dataTransfer`)
          return
        }

        const pos = blockPos(editorView, blockEl)
        if (pos == null) {
          console.log(`${tag} dragstart bailed: no pos`)
          return
        }

        const node = editorView.state.doc.nodeAt(pos)
        if (!node) {
          console.log(`${tag} dragstart bailed: no node at pos`, pos)
          return
        }

        const slice = NodeSelection.create(editorView.state.doc, pos).content()
        dragging = { sourcePos: pos, nodeSize: node.nodeSize, slice }
        console.log(`${tag} dragging set`, {
          sourcePos: pos,
          nodeSize: node.nodeSize,
          sliceSize: slice.size,
        })

        event.dataTransfer.clearData()
        event.dataTransfer.setData('text/plain', node.textContent ?? '')
        event.dataTransfer.effectAllowed = 'move'

        // Use a cloned offscreen copy as the drag image. The browser
        // snapshots the element passed to setDragImage *before* the drop
        // begins, but using the live wrapper directly causes two problems
        // for wide containers (tabs/accordion):
        //   1. Anchoring the cursor at its grab offset within a 700px+ wide
        //      element makes the preview extend far to one side.
        //   2. The browser sometimes captures a stale layout if the
        //      wrapper has just been re-rendered.
        // A narrower offscreen clone removed on the next tick avoids both.
        const clone = blockEl.cloneNode(true) as HTMLElement
        clone.style.position = 'absolute'
        clone.style.top = '-10000px'
        clone.style.left = '-10000px'
        clone.style.width = `${Math.min(blockEl.offsetWidth, 480)}px`
        clone.style.maxWidth = '480px'
        clone.style.maxHeight = '160px'
        clone.style.overflow = 'hidden'
        clone.style.opacity = '0.92'
        clone.style.background = 'var(--color-background, white)'
        clone.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
        clone.style.borderRadius = '6px'
        clone.style.pointerEvents = 'none'
        document.body.appendChild(clone)
        event.dataTransfer.setDragImage(clone, 16, 16)
        // Defer removal until after the browser snapshots.
        setTimeout(() => clone.remove(), 0)

        document.body.classList.add('is-block-dragging')
        // Block PM's own dragstart so it doesn't also seed view.dragging,
        // which would cause its drop handler to insert a duplicate.
        event.stopImmediatePropagation()
      }

      const onDragOver = (event: DragEvent) => {
        if (!dragging) return
        // Required for the browser to fire `drop`. Must run on every dragover.
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      }

      const onDrop = (event: DragEvent) => {
        console.log(`${tag} drop on view.dom`, {
          hasDragging: !!dragging,
          clientX: event.clientX,
          clientY: event.clientY,
        })
        document.body.classList.remove('is-block-dragging')

        if (!dragging) return
        const current = dragging
        dragging = null

        event.preventDefault()
        // stopImmediatePropagation prevents PM's drop listener (attached to the
        // same element) from also running and inserting a second copy.
        event.stopImmediatePropagation()

        const coords = editorView.posAtCoords({ left: event.clientX, top: event.clientY })
        console.log(`${tag} posAtCoords`, coords)
        if (!coords) return

        const target = dropPoint(editorView.state.doc, coords.pos, current.slice)
        console.log(`${tag} dropPoint`, { target, sourcePos: current.sourcePos })
        if (target == null) return

        if (target >= current.sourcePos && target <= current.sourcePos + current.nodeSize) {
          console.log(`${tag} no-op: drop inside source range`)
          return
        }

        const tr = editorView.state.tr
        tr.delete(current.sourcePos, current.sourcePos + current.nodeSize)
        const mappedTarget = tr.mapping.map(target)
        console.log(`${tag} dispatching`, {
          deleteFrom: current.sourcePos,
          deleteTo: current.sourcePos + current.nodeSize,
          mappedTarget,
          sliceContentSize: current.slice.content.size,
        })
        tr.insert(mappedTarget, current.slice.content)
        editorView.dispatch(tr.scrollIntoView())
      }

      const onDragEnd = () => {
        console.log(`${tag} dragend on view.dom`, { stillDragging: !!dragging })
        dragging = null
        document.body.classList.remove('is-block-dragging')
      }

      const onDrag = (event: DragEvent) => {
        const SCROLL_THRESHOLD = 80
        if (event.clientY < SCROLL_THRESHOLD) {
          window.scrollBy({ top: -30, behavior: 'smooth' })
        } else if (window.innerHeight - event.clientY < SCROLL_THRESHOLD) {
          window.scrollBy({ top: 30, behavior: 'smooth' })
        }
      }

      // Capture phase so our listeners fire before PM's bubble-phase ones,
      // letting stopImmediatePropagation block PM from running on the same
      // element.
      dom.addEventListener('dragstart', onDragStart, true)
      dom.addEventListener('dragover', onDragOver, true)
      dom.addEventListener('drop', onDrop, true)
      dom.addEventListener('dragend', onDragEnd, true)
      dom.addEventListener('drag', onDrag, true)

      return {
        destroy() {
          dom.removeEventListener('dragstart', onDragStart, true)
          dom.removeEventListener('dragover', onDragOver, true)
          dom.removeEventListener('drop', onDrop, true)
          dom.removeEventListener('dragend', onDragEnd, true)
          dom.removeEventListener('drag', onDrag, true)
        },
      }
    },
  })
}
