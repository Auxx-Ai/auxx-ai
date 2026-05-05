// apps/web/src/components/editor/kb-article/panel-drag-state.ts
//
// Coordinates native HTML5 drag-and-drop for accordion panels. dnd-kit
// can't be used because Tiptap renders each child node-view (panel) in
// an independent React root, so a `SortableContext` in the parent
// would never reach the `useSortable()` calls in the children.
//
// Strategy:
//   - the source panel's drag handle starts a native drag and calls
//     `startPanelDrag()`, which attaches *document-level* dragover/drop
//     listeners and adds `body.is-panel-dragging` (used by CSS to hide
//     ProseMirror's drop cursor extension).
//   - the document listeners use **Y-only collision** against each item
//     in the source accordion's DOM, so the user can drag straight up /
//     down from a handle that visually sits outside the accordion's
//     bordered box.
//   - the drop state (`{ panelId, edge }`) is exposed to subscribers so
//     each panel-node-view can render a blue insertion indicator.

import type { Editor } from '@tiptap/react'
import { getPanelIndex, reorderPanels } from './container-helpers'

interface PanelDragState {
  panelId: string
  containerPos: number
  fromIndex: number
  editor: Editor
  accordionEl: HTMLElement
}

export interface PanelDropState {
  panelId: string
  edge: 'top' | 'bottom'
}

let drag: PanelDragState | null = null
let drop: PanelDropState | null = null
let cleanup: (() => void) | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function getPanelDrag(): PanelDragState | null {
  return drag
}

export function getPanelDrop(): PanelDropState | null {
  return drop
}

export function subscribePanelDrag(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function startPanelDrag(state: PanelDragState): void {
  drag = state
  drop = null
  if (typeof document !== 'undefined') {
    document.body.classList.add('is-panel-dragging')
  }
  attachListeners()
  notify()
}

export function endPanelDrag(): void {
  drag = null
  drop = null
  if (typeof document !== 'undefined') {
    document.body.classList.remove('is-panel-dragging')
  }
  detachListeners()
  notify()
}

function setDrop(next: PanelDropState | null): void {
  if (next?.panelId === drop?.panelId && next?.edge === drop?.edge && !!next === !!drop) {
    return
  }
  drop = next
  notify()
}

interface ItemEntry {
  id: string
  rect: DOMRect
}

function collectItems(accordionEl: HTMLElement): ItemEntry[] {
  // Direct children only (don't pick up items from a nested accordion if
  // someone ever allows that).
  const items = accordionEl.querySelectorAll<HTMLElement>('[data-accordion-item][data-panel-id]')
  const out: ItemEntry[] = []
  for (const el of items) {
    const id = el.getAttribute('data-panel-id')
    if (!id) continue
    out.push({ id, rect: el.getBoundingClientRect() })
  }
  return out
}

function attachListeners(): void {
  detachListeners()

  const onDragOver = (e: DragEvent) => {
    if (!drag) return
    // preventDefault is required for `drop` to fire. We accept drops
    // anywhere on the page during a panel drag — out-of-accordion drops
    // are no-ops in onDrop.
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'

    const items = collectItems(drag.accordionEl)
    if (items.length === 0) {
      setDrop(null)
      return
    }

    const y = e.clientY
    let hover: ItemEntry | null = null

    // Y-only collision against each item.
    for (const item of items) {
      if (y >= item.rect.top && y <= item.rect.bottom) {
        hover = item
        break
      }
    }

    // Above the first / below the last — clamp to the nearest end so
    // dragging past the edges still shows a sensible indicator.
    if (!hover) {
      const first = items[0]
      const last = items[items.length - 1]
      if (y < first.rect.top) hover = first
      else if (y > last.rect.bottom) hover = last
    }

    if (!hover || hover.id === drag.panelId) {
      setDrop(null)
      return
    }

    const isAfter = y > hover.rect.top + hover.rect.height / 2
    setDrop({ panelId: hover.id, edge: isAfter ? 'bottom' : 'top' })
  }

  const onDrop = (e: DragEvent) => {
    if (!drag) return
    e.preventDefault()
    e.stopPropagation()

    const currentDrag = drag
    const currentDrop = drop

    if (!currentDrop) {
      console.log('[panel-drag] drop with no target — bail')
      endPanelDrag()
      return
    }

    const overIndex = getPanelIndex(
      currentDrag.editor,
      currentDrag.containerPos,
      currentDrop.panelId
    )
    if (overIndex < 0) {
      console.log('[panel-drag] drop bailed: target panel not found in container', {
        targetId: currentDrop.panelId,
        containerPos: currentDrag.containerPos,
      })
      endPanelDrag()
      return
    }

    let toIndex: number
    if (currentDrag.fromIndex < overIndex) {
      // Source removed before target → target shifts down by 1.
      toIndex = currentDrop.edge === 'bottom' ? overIndex : overIndex - 1
    } else {
      // Source after target → target index unchanged.
      toIndex = currentDrop.edge === 'bottom' ? overIndex + 1 : overIndex
    }

    console.log('[panel-drag] drop reorder', {
      from: currentDrag.fromIndex,
      overIndex,
      edge: currentDrop.edge,
      toIndex,
    })

    if (toIndex !== currentDrag.fromIndex) {
      reorderPanels(currentDrag.editor, currentDrag.containerPos, currentDrag.fromIndex, toIndex)
    }
    endPanelDrag()
  }

  const onDragEnd = () => {
    if (drag) {
      console.log('[panel-drag] dragend cleanup')
      endPanelDrag()
    }
  }

  // Capture phase so we run before any per-element handlers and before
  // ProseMirror's own drop handling.
  document.addEventListener('dragover', onDragOver, true)
  document.addEventListener('drop', onDrop, true)
  document.addEventListener('dragend', onDragEnd, true)

  cleanup = () => {
    document.removeEventListener('dragover', onDragOver, true)
    document.removeEventListener('drop', onDrop, true)
    document.removeEventListener('dragend', onDragEnd, true)
  }
}

function detachListeners(): void {
  if (cleanup) {
    cleanup()
    cleanup = null
  }
}
