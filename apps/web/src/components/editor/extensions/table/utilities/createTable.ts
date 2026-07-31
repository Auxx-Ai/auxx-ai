import type { Fragment, Node as ProsemirrorNode, Schema } from '@tiptap/pm/model'

import { createCell } from './createCell'
import { getTableNodeTypes } from './getTableNodeTypes'

export function createTable(
  schema: Schema,
  rowsCount: number,
  colsCount: number,
  withHeaderRow: boolean,
  cellContent?: Fragment | ProsemirrorNode | Array<ProsemirrorNode>
): ProsemirrorNode {
  const types = getTableNodeTypes(schema)
  // A schema without these roles can't represent a table at all — fail with the
  // missing role names rather than letting `undefined.createChecked` throw a
  // bare "cannot read properties of undefined" further down.
  const { table: tableType, row: rowType, cell: cellType } = types
  if (!tableType || !rowType || !cellType) {
    const missing = (['table', 'row', 'cell'] as const).filter((role) => !types[role])
    throw new Error(`createTable: schema is missing table node role(s): ${missing.join(', ')}`)
  }

  const headerCells: ProsemirrorNode[] = []
  const cells: ProsemirrorNode[] = []
  const headerCellType = types.header_cell

  for (let index = 0; index < colsCount; index += 1) {
    const cell = createCell(cellType, cellContent)

    if (cell) {
      cells.push(cell)
    }

    if (withHeaderRow && headerCellType) {
      const headerCell = createCell(headerCellType, cellContent)

      if (headerCell) {
        headerCells.push(headerCell)
      }
    }
  }

  const rows: ProsemirrorNode[] = []

  for (let index = 0; index < rowsCount; index += 1) {
    rows.push(rowType.createChecked(null, withHeaderRow && index === 0 ? headerCells : cells))
  }

  return tableType.createChecked(null, rows)
}
