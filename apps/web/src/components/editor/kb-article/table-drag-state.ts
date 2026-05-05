// apps/web/src/components/editor/kb-article/table-drag-state.ts
//
// Coordinates native HTML5 drag-and-drop for table row + column reorder.
// Mirrors `panel-drag-state.ts` for tabs/accordion. Document-level
// capture-phase listeners pick up cursor movement during a drag and
// expose `{ kind, index, edge }` to the table NodeView so it can render
// the blue insertion indicator.
//
// The single-module-for-both-axes design works because a drag is either
// a row drag or a column drag — never both.

import type { Editor } from '@tiptap/react'
import { reorderColumn, reorderRow } from './table-helpers'

export type TableDragKind = 'row' | 'column'

interface TableDragState {
  kind: TableDragKind
  index: number
  tablePos: number
  editor: Editor
  tableEl: HTMLElement
}

export interface TableDropState {
  kind: TableDragKind
  index: number
  edge: 'before' | 'after'
}

let drag: TableDragState | null = null
let drop: TableDropState | null = null
let cleanup: (() => void) | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function getTableDrag(): TableDragState | null {
  return drag
}

export function getTableDrop(): TableDropState | null {
  return drop
}

export function subscribeTableDrag(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function startTableDrag(state: TableDragState): void {
  drag = state
  drop = null
  if (typeof document !== 'undefined') {
    document.body.classList.add('is-table-dragging')
  }
  attachListeners()
  notify()
}

export function endTableDrag(): void {
  drag = null
  drop = null
  if (typeof document !== 'undefined') {
    document.body.classList.remove('is-table-dragging')
  }
  detachListeners()
  notify()
}

function setDrop(next: TableDropState | null): void {
  if (
    next?.kind === drop?.kind &&
    next?.index === drop?.index &&
    next?.edge === drop?.edge &&
    !!next === !!drop
  ) {
    return
  }
  drop = next
  notify()
}

interface RowEntry {
  index: number
  rect: DOMRect
}

// Walk the table's tbody → trs directly. PM's `tableCell.renderHTML` /
// `tableHeader.renderHTML` re-render cells without preserving externally-
// set data attributes, so `[data-row]` / `[data-row-index]` queries return
// 0 elements after any doc mutation. Sibling-index of `<tr>` inside
// `<tbody>` IS the row index — robust regardless of attribute survival.
function collectRows(tableEl: HTMLElement): RowEntry[] {
  const tbody = tableEl.querySelector<HTMLElement>(':scope > tbody')
  if (!tbody) return []
  const rows = Array.from(tbody.querySelectorAll<HTMLElement>(':scope > tr'))
  return rows.map((el, index) => ({ index, rect: el.getBoundingClientRect() }))
}

interface ColEntry {
  index: number
  rect: DOMRect
}

// Use the first row's cells; their sibling-index inside the row IS the
// column index. Same rationale as collectRows — `data-col-index` doesn't
// survive PM's renderHTML pass.
function collectColumns(tableEl: HTMLElement): ColEntry[] {
  const firstRow = tableEl.querySelector<HTMLElement>(':scope > tbody > tr')
  if (!firstRow) return []
  const cells = Array.from(firstRow.querySelectorAll<HTMLElement>(':scope > th, :scope > td'))
  return cells.map((el, index) => ({ index, rect: el.getBoundingClientRect() }))
}

function attachListeners(): void {
  detachListeners()

  // Compute rows/cols once at drag start. They don't move during a drag —
  // dragover fires hundreds of times for a single drag, so caching avoids
  // re-running querySelectorAll on each event.
  const cachedRows = drag?.kind === 'row' ? collectRows(drag.tableEl) : []
  const cachedCols = drag?.kind === 'column' ? collectColumns(drag.tableEl) : []

  const onDragOver = (e: DragEvent) => {
    if (!drag) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'

    if (drag.kind === 'row') {
      const rows = cachedRows
      if (rows.length === 0) return setDrop(null)
      const y = e.clientY
      let hover: RowEntry | null = null
      for (const row of rows) {
        if (y >= row.rect.top && y <= row.rect.bottom) {
          hover = row
          break
        }
      }
      if (!hover) {
        const first = rows[0]
        const last = rows[rows.length - 1]
        if (y < first.rect.top) hover = first
        else if (y > last.rect.bottom) hover = last
      }
      if (!hover || hover.index === drag.index) return setDrop(null)
      const isAfter = y > hover.rect.top + hover.rect.height / 2
      setDrop({ kind: 'row', index: hover.index, edge: isAfter ? 'after' : 'before' })
      return
    }

    // Column drag — X-only collision against first-row cells.
    const cols = cachedCols
    if (cols.length === 0) return setDrop(null)
    const x = e.clientX
    let hover: ColEntry | null = null
    for (const col of cols) {
      if (x >= col.rect.left && x <= col.rect.right) {
        hover = col
        break
      }
    }
    if (!hover) {
      const first = cols[0]
      const last = cols[cols.length - 1]
      if (x < first.rect.left) hover = first
      else if (x > last.rect.right) hover = last
    }
    if (!hover || hover.index === drag.index) return setDrop(null)
    const isAfter = x > hover.rect.left + hover.rect.width / 2
    setDrop({ kind: 'column', index: hover.index, edge: isAfter ? 'after' : 'before' })
  }

  const onDrop = (e: DragEvent) => {
    if (!drag) return
    e.preventDefault()
    e.stopPropagation()

    const currentDrag = drag
    const currentDrop = drop

    if (!currentDrop) {
      endTableDrag()
      return
    }

    const fromIndex = currentDrag.index
    const overIndex = currentDrop.index
    let toIndex: number
    if (fromIndex < overIndex) {
      toIndex = currentDrop.edge === 'after' ? overIndex : overIndex - 1
    } else {
      toIndex = currentDrop.edge === 'after' ? overIndex + 1 : overIndex
    }

    if (toIndex !== fromIndex) {
      if (currentDrag.kind === 'row') {
        reorderRow(currentDrag.editor, currentDrag.tablePos, fromIndex, toIndex)
      } else {
        reorderColumn(currentDrag.editor, currentDrag.tablePos, fromIndex, toIndex)
      }
    }
    endTableDrag()
  }

  const onDragEnd = () => {
    if (drag) endTableDrag()
  }

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
