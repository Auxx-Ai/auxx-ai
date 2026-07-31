// apps/web/src/components/editor/kb-article/table-helpers.ts
//
// PM transaction helpers for the `table` block. Mirrors `container-helpers.ts`
// for tabs/accordion. Helpers do NOT call `tr.scrollIntoView()` — the lesson
// from `addPanel` is that scrolling the doc to a newly-inserted node jumps
// the page when the table is far above the viewport.

import type { Node as PMNode } from '@tiptap/pm/model'
import {
  addColumn,
  addRow,
  removeColumn,
  removeRow,
  TableMap,
  type TableRect,
} from '@tiptap/pm/tables'
import type { Editor } from '@tiptap/react'

interface TableShape {
  table: PMNode
  tablePos: number
  tableStart: number
  map: TableMap
  rowCount: number
  colCount: number
}

function readTable(editor: Editor, tablePos: number): TableShape | null {
  const table = editor.state.doc.nodeAt(tablePos)
  if (!table || table.type.name !== 'table') return null
  const map = TableMap.get(table)
  return {
    table,
    tablePos,
    tableStart: tablePos + 1,
    map,
    rowCount: map.height,
    colCount: map.width,
  }
}

/**
 * A `TableRect` covering the whole table. prosemirror-tables' add/remove
 * row+column helpers destructure only `map` / `table` / `tableStart`, but their
 * parameter type is the same `TableRect` that `selectedRect()` returns, so the
 * cell bounds have to be supplied. Full-table bounds are the honest value —
 * these calls operate on the table, not on a selection within it.
 */
function wholeTableRect(shape: TableShape): TableRect {
  return {
    left: 0,
    top: 0,
    right: shape.colCount,
    bottom: shape.rowCount,
    map: shape.map,
    table: shape.table,
    tableStart: shape.tableStart,
  }
}

export function getRowCount(editor: Editor, tablePos: number): number {
  return readTable(editor, tablePos)?.rowCount ?? 0
}

export function getColumnCount(editor: Editor, tablePos: number): number {
  return readTable(editor, tablePos)?.colCount ?? 0
}

export function addRowAt(editor: Editor, tablePos: number, atIndex: number): void {
  const shape = readTable(editor, tablePos)
  if (!shape) return
  const clamped = Math.max(0, Math.min(atIndex, shape.rowCount))
  const tr = editor.state.tr
  addRow(tr, wholeTableRect(shape), clamped)
  editor.view.dispatch(tr)
}

export function addColumnAt(editor: Editor, tablePos: number, atIndex: number): void {
  const shape = readTable(editor, tablePos)
  if (!shape) return
  const clamped = Math.max(0, Math.min(atIndex, shape.colCount))
  const tr = editor.state.tr
  addColumn(tr, wholeTableRect(shape), clamped)
  editor.view.dispatch(tr)
}

export function removeRowAt(editor: Editor, tablePos: number, atIndex: number): void {
  const shape = readTable(editor, tablePos)
  if (!shape) return
  if (atIndex < 0 || atIndex >= shape.rowCount) return
  // If this is the last row, delete the whole table.
  if (shape.rowCount <= 1) {
    editor.view.dispatch(
      editor.state.tr.delete(shape.tablePos, shape.tablePos + shape.table.nodeSize)
    )
    return
  }
  const tr = editor.state.tr
  removeRow(tr, wholeTableRect(shape), atIndex)
  editor.view.dispatch(tr)
}

export function removeColumnAt(editor: Editor, tablePos: number, atIndex: number): void {
  const shape = readTable(editor, tablePos)
  if (!shape) return
  if (atIndex < 0 || atIndex >= shape.colCount) return
  // If this is the last column, delete the whole table.
  if (shape.colCount <= 1) {
    editor.view.dispatch(
      editor.state.tr.delete(shape.tablePos, shape.tablePos + shape.table.nodeSize)
    )
    return
  }
  const tr = editor.state.tr
  removeColumn(tr, wholeTableRect(shape), atIndex)
  editor.view.dispatch(tr)
}

/**
 * Reorder rows by rebuilding the table with rows reordered. Mirrors
 * `reorderPanels()` in `container-helpers.ts`. Cell types (`tableCell` /
 * `tableHeader`) are preserved per-row — dragging a header row carries the
 * header cells with it.
 *
 * Bails when any cell in the source row has rowspan > 1 (would split the
 * merged region). Single-row tables are unreorderable; that's a no-op.
 */
export function reorderRow(
  editor: Editor,
  tablePos: number,
  fromIndex: number,
  toIndex: number
): void {
  if (fromIndex === toIndex) return
  const shape = readTable(editor, tablePos)
  if (!shape) return
  if (fromIndex < 0 || fromIndex >= shape.rowCount) return
  if (toIndex < 0 || toIndex >= shape.rowCount) return

  // Bail on rowspan > 1 in source or target rows — would split a merge.
  if (rowHasSpan(shape.table, fromIndex) || rowHasSpan(shape.table, toIndex)) return

  const rows: PMNode[] = []
  shape.table.forEach((row) => rows.push(row))
  const [moved] = rows.splice(fromIndex, 1)
  if (!moved) return
  rows.splice(toIndex, 0, moved)
  const newTable = shape.table.type.create(shape.table.attrs, rows, shape.table.marks)
  editor.view.dispatch(
    editor.state.tr.replaceWith(shape.tablePos, shape.tablePos + shape.table.nodeSize, newTable)
  )
}

/**
 * Reorder columns by rebuilding every row with cells reshuffled. Bails on
 * any colspan > 1 cell (the merge anchor would silently shift).
 */
export function reorderColumn(
  editor: Editor,
  tablePos: number,
  fromIndex: number,
  toIndex: number
): void {
  if (fromIndex === toIndex) return
  const shape = readTable(editor, tablePos)
  if (!shape) return
  if (fromIndex < 0 || fromIndex >= shape.colCount) return
  if (toIndex < 0 || toIndex >= shape.colCount) return

  if (anyCellSpansMultipleColumns(shape.table)) return

  const newRows: PMNode[] = []
  shape.table.forEach((row) => {
    const cells: PMNode[] = []
    row.forEach((cell) => cells.push(cell))
    if (cells.length !== shape.colCount) {
      // Mixed colspan would have been caught above; if we got here, just keep
      // the row unchanged and bail the whole transaction below.
      newRows.push(row)
      return
    }
    const [movedCell] = cells.splice(fromIndex, 1)
    if (!movedCell) {
      newRows.push(row)
      return
    }
    cells.splice(toIndex, 0, movedCell)
    newRows.push(row.type.create(row.attrs, cells, row.marks))
  })
  const newTable = shape.table.type.create(shape.table.attrs, newRows, shape.table.marks)
  editor.view.dispatch(
    editor.state.tr.replaceWith(shape.tablePos, shape.tablePos + shape.table.nodeSize, newTable)
  )
}

function rowHasSpan(table: PMNode, rowIndex: number): boolean {
  const row = table.maybeChild(rowIndex)
  if (!row) return false
  let found = false
  row.forEach((cell) => {
    const attrs = cell.attrs as { rowspan?: number; colspan?: number }
    if ((attrs.rowspan ?? 1) > 1 || (attrs.colspan ?? 1) > 1) found = true
  })
  return found
}

function anyCellSpansMultipleColumns(table: PMNode): boolean {
  let found = false
  table.forEach((row) => {
    row.forEach((cell) => {
      const attrs = cell.attrs as { colspan?: number }
      if ((attrs.colspan ?? 1) > 1) found = true
    })
  })
  return found
}

/**
 * Toggle the first row between `tableHeader` cells and `tableCell` cells.
 * Used by the header-row toolbar toggle.
 */
export function toggleHeaderRow(editor: Editor, tablePos: number): void {
  const shape = readTable(editor, tablePos)
  if (!shape) return
  const firstRow = shape.table.firstChild
  if (!firstRow) return
  const cellType = editor.schema.nodes.tableCell
  const headerType = editor.schema.nodes.tableHeader
  if (!cellType || !headerType) return

  const allHeader = isAllHeader(firstRow)
  const targetType = allHeader ? cellType : headerType
  const newCells: PMNode[] = []
  firstRow.forEach((cell) => {
    newCells.push(targetType.create(cell.attrs, cell.content, cell.marks))
  })
  const newRow = firstRow.type.create(firstRow.attrs, newCells, firstRow.marks)
  const rows: PMNode[] = []
  shape.table.forEach((row, _, i) => {
    rows.push(i === 0 ? newRow : row)
  })
  const newTable = shape.table.type.create(shape.table.attrs, rows, shape.table.marks)
  editor.view.dispatch(
    editor.state.tr.replaceWith(shape.tablePos, shape.tablePos + shape.table.nodeSize, newTable)
  )
}

export function isFirstRowHeader(editor: Editor, tablePos: number): boolean {
  const shape = readTable(editor, tablePos)
  if (!shape) return false
  const firstRow = shape.table.firstChild
  if (!firstRow) return false
  return isAllHeader(firstRow)
}

function isAllHeader(row: PMNode): boolean {
  let allHeader = true
  let any = false
  row.forEach((cell) => {
    any = true
    if (cell.type.name !== 'tableHeader') allHeader = false
  })
  return any && allHeader
}

/**
 * Resolve the table's position from a starting point inside a cell. Used
 * when block-drag-plugin clicks the table's outer gutter and we want to
 * select the whole table.
 */
export function resolveTablePosFromCellPos(editor: Editor, posInsideTable: number): number | null {
  try {
    const $pos = editor.state.doc.resolve(posInsideTable)
    for (let depth = $pos.depth; depth >= 0; depth--) {
      if ($pos.node(depth).type.name === 'table') return $pos.before(depth)
    }
    return null
  } catch {
    return null
  }
}
