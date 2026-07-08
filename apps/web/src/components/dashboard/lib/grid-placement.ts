// apps/web/src/components/dashboard/lib/grid-placement.ts
//
// Auto-placement for the add-widget flow (plan 07): given the tab's occupied
// cells and a new widget's span, find the top-most / left-most free rectangle on
// the 12-col grid. Pure + deterministic so it's unit-testable and identical on
// server and client.

import { DASHBOARD_GRID_COLUMNS, type GridPosition } from '@auxx/lib/dashboards/client'

/**
 * First-fit placement on the 12-col grid. Scans rows top-down and columns
 * left-right over a per-row occupancy view of the existing widgets; the first
 * position where the `span` rectangle fits without overlap wins. Falls back to
 * appending at the bottom (below everything) when nothing fits within the
 * scanned window — the grid grows vertically without bound, so this always
 * succeeds.
 *
 * `span.w` is clamped to the grid width. Rows are unbounded; the scan ceiling is
 * derived from the current content height plus the new widget, which is always
 * enough to expose a free row.
 */
export function findNextFreePosition(
  widgets: GridPosition[],
  span: { w: number; h: number }
): GridPosition {
  const columns = DASHBOARD_GRID_COLUMNS
  const w = Math.min(Math.max(1, span.w), columns)
  const h = Math.max(1, span.h)

  // Bottom of the tallest widget — the scan needs to reach at least here + h so
  // the append-at-bottom fallback is always reachable.
  const contentBottom = widgets.reduce((max, p) => Math.max(max, p.row + p.rowSpan), 0)
  const maxRow = contentBottom + h

  const occupied = (col: number, row: number): boolean =>
    widgets.some(
      (p) =>
        col < p.column + p.columnSpan &&
        col + w > p.column &&
        row < p.row + p.rowSpan &&
        row + h > p.row
    )

  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col + w <= columns; col++) {
      if (!occupied(col, row)) {
        return { column: col, row, columnSpan: w, rowSpan: h }
      }
    }
  }

  // Unreachable given maxRow, but keep the total-fallback explicit.
  return { column: 0, row: contentBottom, columnSpan: w, rowSpan: h }
}

/**
 * Place a widget of `span` at a clicked grid cell (`at.x` = column, `at.y` =
 * row). The column is clamped so the widget stays fully on the 12-col grid;
 * the row is honoured as-is (the grid's vertical compactor settles any overlap
 * on the next layout pass). Used by the empty-cell "click to add" overlay.
 */
export function placeAt(
  at: { x: number; y: number },
  span: { w: number; h: number }
): GridPosition {
  const columns = DASHBOARD_GRID_COLUMNS
  const w = Math.min(Math.max(1, span.w), columns)
  const h = Math.max(1, span.h)
  const column = Math.min(Math.max(0, at.x), columns - w)
  const row = Math.max(0, at.y)
  return { column, row, columnSpan: w, rowSpan: h }
}
