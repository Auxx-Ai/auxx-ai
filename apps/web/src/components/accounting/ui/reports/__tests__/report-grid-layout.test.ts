// apps/web/src/components/accounting/ui/reports/__tests__/report-grid-layout.test.ts

import { describe, expect, it } from 'vitest'
import { layoutReportRows, type ReportGridRow, visibleRange } from '../report-grid-layout'

function row(overrides: Partial<ReportGridRow> & Pick<ReportGridRow, 'id'>): ReportGridRow {
  return { label: overrides.id, depth: 0, kind: 'line', values: [], ...overrides }
}

const rows: ReportGridRow[] = [
  row({
    id: 'assets',
    kind: 'section',
    children: [
      row({ id: 'cash', depth: 1 }),
      row({ id: 'bank', depth: 1 }),
      row({ id: 'assets:total', depth: 1, kind: 'subtotal' }),
    ],
  }),
  row({ id: 'total', kind: 'total' }),
]

describe('layoutReportRows', () => {
  it('leaves a closed section as one row, top-level rows 2px apart', () => {
    const layout = layoutReportRows(rows, () => false)
    expect(layout.items.map((item) => item.row.id)).toEqual(['assets', 'total'])
    // total: 2px root gap + 2px margin + 32px line + 2px border
    expect(layout.items[1]?.offset).toBe(32)
    expect(layout.total).toBe(32 + 2 + 2 + 34)
  })

  it('places an open section`s children flush under it, a subtotal with its margin and border', () => {
    const layout = layoutReportRows(rows, (r) => r.id === 'assets')
    expect(layout.items.map((item) => [item.row.id, item.offset, item.height])).toEqual([
      ['assets', 0, 32],
      ['cash', 32, 32],
      ['bank', 64, 32],
      ['assets:total', 96, 35],
      ['total', 131, 38],
    ])
    expect(layout.items[1]?.depth).toBe(1)
    expect(layout.offsetById.get('bank')).toBe(64)
  })

  it('floors a child`s depth one below its parent', () => {
    const layout = layoutReportRows(
      [row({ id: 'p', depth: 2, children: [row({ id: 'c', depth: 0 })] })],
      () => true
    )
    expect(layout.items[1]?.depth).toBe(3)
  })
})

describe('visibleRange', () => {
  it('returns the rows overlapping a window', () => {
    const layout = layoutReportRows(rows, () => true)
    expect(visibleRange(layout.items, 40, 90)).toEqual([1, 3])
    expect(visibleRange(layout.items, 0, 1)).toEqual([0, 1])
    expect(visibleRange(layout.items, 500, 600)).toEqual([5, 5])
  })
})
