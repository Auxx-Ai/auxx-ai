// apps/web/src/components/dashboard/lib/grid-convert.ts
//
// Bridge between our versioned layout doc (`LayoutWidget.gridPosition`, in
// `@auxx/lib/dashboards/client`) and react-grid-layout's `Layout[]`. Two
// directions: `tabToLayouts` builds the desktop + derived mobile layouts for the
// grid; `applyLayoutToWidgets` folds a drag/resize commit back into gridPosition,
// emitting only the widgets whose position actually changed (store no-op guard).

import type { GridPosition, LayoutWidget } from '@auxx/lib/dashboards/client'
import type { Layout, LayoutItem } from 'react-grid-layout'
import { WIDGET_GRID_SIZE } from './grid-constants'

/** Per-breakpoint react-grid-layout arrays. Keys match `GRID_BREAKPOINTS`. */
export type TabLayouts = { desktop: LayoutItem[]; mobile: LayoutItem[] }

/**
 * Project a tab's widgets into react-grid-layout arrays for both breakpoints.
 *
 * - **desktop**: 1:1 with the stored `gridPosition` (`x=column`, `y=row`,
 *   `w=columnSpan`, `h=rowSpan`), `minW`/`minH` from the per-kind size table.
 * - **mobile**: single column, each widget keeps its `rowSpan` but is restacked
 *   in *reading order* — sorted by row then column, NOT array order — so the
 *   phone view matches what the eye scans on desktop.
 */
export function tabToLayouts(widgets: LayoutWidget[]): TabLayouts {
  const desktop: LayoutItem[] = widgets.map((widget) => {
    const min = WIDGET_GRID_SIZE[widget.type].min
    return {
      i: widget.id,
      x: widget.gridPosition.column,
      y: widget.gridPosition.row,
      w: widget.gridPosition.columnSpan,
      h: widget.gridPosition.rowSpan,
      minW: min.w,
      minH: min.h,
    }
  })

  const readingOrder = [...widgets].sort((a, b) => {
    if (a.gridPosition.row !== b.gridPosition.row) {
      return a.gridPosition.row - b.gridPosition.row
    }
    return a.gridPosition.column - b.gridPosition.column
  })

  let mobileY = 0
  const mobile: LayoutItem[] = readingOrder.map((widget) => {
    const h = widget.gridPosition.rowSpan
    const layout: LayoutItem = {
      i: widget.id,
      x: 0,
      y: mobileY,
      w: 1,
      h,
      minW: 1,
      minH: WIDGET_GRID_SIZE[widget.type].min.h,
    }
    mobileY += h
    return layout
  })

  return { desktop, mobile }
}

/** react-grid-layout `LayoutItem` → stored `GridPosition`. */
export function layoutToGridPosition(layout: LayoutItem): GridPosition {
  return { column: layout.x, row: layout.y, columnSpan: layout.w, rowSpan: layout.h }
}

/**
 * Fold a react-grid-layout commit back onto widgets, returning ONLY the widgets
 * whose position actually moved. The store applies these as a single patch and
 * skips the write when the array is empty — RGL fires `onLayoutChange` on mount
 * and for no-op drags, so this diff is what keeps those from dirtying the draft.
 */
export function applyLayoutToWidgets(
  widgets: LayoutWidget[],
  layout: Layout
): Array<{ id: string; gridPosition: GridPosition }> {
  const byId = new Map(layout.map((l) => [l.i, l]))
  const changes: Array<{ id: string; gridPosition: GridPosition }> = []

  for (const widget of widgets) {
    const next = byId.get(widget.id)
    if (!next) continue
    const pos = widget.gridPosition
    if (
      next.x === pos.column &&
      next.y === pos.row &&
      next.w === pos.columnSpan &&
      next.h === pos.rowSpan
    ) {
      continue
    }
    changes.push({ id: widget.id, gridPosition: layoutToGridPosition(next) })
  }

  return changes
}
