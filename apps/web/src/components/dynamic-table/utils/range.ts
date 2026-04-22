// apps/web/src/components/dynamic-table/utils/range.ts
'use client'

import type { CellAddress, CellRange, RangeEndpoint } from '../types'

/** Inclusive bounds of a range in (row, col) index space */
export interface RangeBounds {
  top: number
  bottom: number
  left: number
  right: number
}

export function rangeBounds(range: CellRange): RangeBounds {
  return {
    top: Math.min(range.anchor.rowIndex, range.focus.rowIndex),
    bottom: Math.max(range.anchor.rowIndex, range.focus.rowIndex),
    left: Math.min(range.anchor.colIndex, range.focus.colIndex),
    right: Math.max(range.anchor.colIndex, range.focus.colIndex),
  }
}

export function rangeContains(range: CellRange, rowIndex: number, colIndex: number): boolean {
  const b = rangeBounds(range)
  return rowIndex >= b.top && rowIndex <= b.bottom && colIndex >= b.left && colIndex <= b.right
}

export function isSingleCell(range: CellRange | null): boolean {
  if (!range) return false
  return range.anchor.rowId === range.focus.rowId && range.anchor.columnId === range.focus.columnId
}

/** Build a 1×1 range from an endpoint */
export function singleRange(endpoint: RangeEndpoint): CellRange {
  return { anchor: endpoint, focus: endpoint }
}

/** Build an endpoint where indexes are unknown (caller must remap) */
export function endpointFromAddress(addr: CellAddress): RangeEndpoint {
  return { ...addr, rowIndex: -1, colIndex: -1 }
}

/**
 * Iterate cells row-major. Returns `{rowId, columnId}` pairs.
 * Caller provides the visible row/column id arrays so we can resolve indexes
 * back to ids without forcing the store to also know about every visible row.
 */
export function* rangeCells(
  range: CellRange,
  rowIds: string[],
  columnIds: string[]
): Generator<CellAddress> {
  const b = rangeBounds(range)
  for (let r = b.top; r <= b.bottom; r++) {
    const rowId = rowIds[r]
    if (!rowId) continue
    for (let c = b.left; c <= b.right; c++) {
      const columnId = columnIds[c]
      if (!columnId) continue
      yield { rowId, columnId }
    }
  }
}

/** Convenience: shape (rows × cols) of the range */
export function rangeShape(range: CellRange): { rows: number; cols: number } {
  const b = rangeBounds(range)
  return { rows: b.bottom - b.top + 1, cols: b.right - b.left + 1 }
}
