// apps/web/src/components/dashboard/lib/grid-convert.test.ts

import type { GridPosition, LayoutWidget, WidgetKind } from '@auxx/lib/dashboards/client'
import type { LayoutItem } from 'react-grid-layout'
import { describe, expect, it } from 'vitest'
import { WIDGET_GRID_SIZE } from './grid-constants'
import { applyLayoutToWidgets, layoutToGridPosition, tabToLayouts } from './grid-convert'

function widget(id: string, gridPosition: GridPosition, type: WidgetKind = 'kpi'): LayoutWidget {
  return { id, title: id, type, gridPosition, configuration: { kind: 'richText', content: null } }
}

const pos = (column: number, row: number, columnSpan: number, rowSpan: number): GridPosition => ({
  column,
  row,
  columnSpan,
  rowSpan,
})

describe('tabToLayouts', () => {
  it('maps gridPosition 1:1 onto the desktop layout with per-kind min sizes', () => {
    const w = widget('a', pos(3, 2, 6, 4), 'barChart')
    const { desktop } = tabToLayouts([w])
    expect(desktop).toEqual([
      {
        i: 'a',
        x: 3,
        y: 2,
        w: 6,
        h: 4,
        minW: WIDGET_GRID_SIZE.barChart.min.w,
        minH: WIDGET_GRID_SIZE.barChart.min.h,
      },
    ])
  })

  it('stacks the mobile layout in reading order (row then column), not array order', () => {
    // Authored out of visual order: array is [bottom-left, top-right, top-left].
    const widgets = [
      widget('bottomLeft', pos(0, 5, 6, 2)),
      widget('topRight', pos(6, 0, 6, 3)),
      widget('topLeft', pos(0, 0, 6, 2)),
    ]
    const { mobile } = tabToLayouts(widgets)

    // Reading order: topLeft (row 0 col 0), topRight (row 0 col 6), bottomLeft (row 5).
    expect(mobile.map((l) => l.i)).toEqual(['topLeft', 'topRight', 'bottomLeft'])
    // Single column, stacked with each widget's own height, no gaps.
    expect(mobile).toEqual([
      { i: 'topLeft', x: 0, y: 0, w: 1, h: 2, minW: 1, minH: WIDGET_GRID_SIZE.kpi.min.h },
      { i: 'topRight', x: 0, y: 2, w: 1, h: 3, minW: 1, minH: WIDGET_GRID_SIZE.kpi.min.h },
      { i: 'bottomLeft', x: 0, y: 5, w: 1, h: 2, minW: 1, minH: WIDGET_GRID_SIZE.kpi.min.h },
    ])
  })

  it('returns empty arrays for an empty tab', () => {
    expect(tabToLayouts([])).toEqual({ desktop: [], mobile: [] })
  })
})

describe('layoutToGridPosition', () => {
  it('maps a Layout back to a GridPosition', () => {
    const layout: LayoutItem = { i: 'x', x: 4, y: 1, w: 3, h: 2 }
    expect(layoutToGridPosition(layout)).toEqual(pos(4, 1, 3, 2))
  })
})

describe('applyLayoutToWidgets', () => {
  const widgets = [widget('a', pos(0, 0, 3, 2)), widget('b', pos(3, 0, 3, 2))]

  it('returns only widgets whose position changed', () => {
    const layout: LayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 3, h: 2 }, // unchanged
      { i: 'b', x: 6, y: 1, w: 4, h: 3 }, // moved + resized
    ]
    expect(applyLayoutToWidgets(widgets, layout)).toEqual([
      { id: 'b', gridPosition: pos(6, 1, 4, 3) },
    ])
  })

  it('returns [] when nothing moved (RGL mount / no-op drag)', () => {
    const layout: LayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 3, h: 2 },
      { i: 'b', x: 3, y: 0, w: 3, h: 2 },
    ]
    expect(applyLayoutToWidgets(widgets, layout)).toEqual([])
  })

  it('ignores layout entries with no matching widget', () => {
    const layout: LayoutItem[] = [{ i: 'ghost', x: 9, y: 9, w: 1, h: 1 }]
    expect(applyLayoutToWidgets(widgets, layout)).toEqual([])
  })
})
