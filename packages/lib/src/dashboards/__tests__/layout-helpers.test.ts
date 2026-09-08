// packages/lib/src/dashboards/__tests__/layout-helpers.test.ts
//
// The grid-placement maths and the new-widget defaults. Moved here (from
// `apps/web/src/components/dashboard/lib/grid-placement.test.ts`) with the
// functions themselves, so the one definition the browser store and the
// server-side Kopilot builder share also has one test.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WIDGET_SIZE,
  type GridPosition,
  MIN_WIDGET_SIZE,
  WIDGET_KIND_LABELS,
  WIDGET_KINDS,
} from '../client'
import {
  defaultWidgetConfiguration,
  defaultWidgetSpan,
  defaultWidgetTitle,
  findNextFreePosition,
  minWidgetSpan,
  placeAt,
} from '../layout-ops'

const pos = (column: number, row: number, columnSpan: number, rowSpan: number): GridPosition => ({
  column,
  row,
  columnSpan,
  rowSpan,
})

describe('findNextFreePosition', () => {
  it('places the first widget at the origin', () => {
    expect(findNextFreePosition([], { w: 6, h: 4 })).toEqual(pos(0, 0, 6, 4))
  })

  it('places to the right when the top-left is free', () => {
    // A 6-wide widget at the origin leaves cols 6..11 open on row 0.
    expect(findNextFreePosition([pos(0, 0, 6, 4)], { w: 6, h: 4 })).toEqual(pos(6, 0, 6, 4))
  })

  it('wraps to the next free row when the current row is full', () => {
    const widgets = [pos(0, 0, 6, 4), pos(6, 0, 6, 4)] // row 0 fully occupied (rows 0-3)
    expect(findNextFreePosition(widgets, { w: 6, h: 4 })).toEqual(pos(0, 4, 6, 4))
  })

  it('fills a gap in a fragmented grid before appending', () => {
    // Left half of the top rows taken, right half free: a 6-wide fits at col 6.
    const widgets = [pos(0, 0, 6, 2)]
    expect(findNextFreePosition(widgets, { w: 6, h: 2 })).toEqual(pos(6, 0, 6, 2))
  })

  it('finds a narrow slot a wide widget would skip', () => {
    // cols 0-8 occupied on rows 0-1, leaving a 3-wide slot at col 9.
    const widgets = [pos(0, 0, 9, 2)]
    expect(findNextFreePosition(widgets, { w: 3, h: 2 })).toEqual(pos(9, 0, 3, 2))
    // A 4-wide can't fit at col 9 (would overflow 12), so it drops to row 2.
    expect(findNextFreePosition(widgets, { w: 4, h: 2 })).toEqual(pos(0, 2, 4, 2))
  })

  it('appends a full-width widget below existing content', () => {
    const widgets = [pos(0, 0, 6, 3), pos(6, 0, 6, 5)]
    // Full width can only start once past the tallest column (row 5).
    expect(findNextFreePosition(widgets, { w: 12, h: 4 })).toEqual(pos(0, 5, 12, 4))
  })

  it('clamps an oversized span to the grid width', () => {
    expect(findNextFreePosition([], { w: 20, h: 2 })).toEqual(pos(0, 0, 12, 2))
  })
})

describe('placeAt', () => {
  it('honours the chosen cell', () => {
    expect(placeAt({ x: 3, y: 2 }, { w: 4, h: 3 })).toEqual(pos(3, 2, 4, 3))
  })

  it('clamps the column so the widget stays fully on the grid', () => {
    expect(placeAt({ x: 11, y: 0 }, { w: 6, h: 2 })).toEqual(pos(6, 0, 6, 2))
  })

  it('clamps negative coordinates and an oversized span', () => {
    expect(placeAt({ x: -4, y: -2 }, { w: 99, h: 0 })).toEqual(pos(0, 0, 12, 1))
  })

  it('honours the row as-is (the grid compactor settles overlap)', () => {
    expect(placeAt({ x: 0, y: 40 }, { w: 2, h: 2 })).toEqual(pos(0, 40, 2, 2))
  })
})

describe('span projections', () => {
  it.each(WIDGET_KINDS)('%s projects the layout-doc size constants', (kind) => {
    expect(defaultWidgetSpan(kind)).toEqual({
      w: DEFAULT_WIDGET_SIZE[kind].columnSpan,
      h: DEFAULT_WIDGET_SIZE[kind].rowSpan,
    })
    expect(minWidgetSpan(kind)).toEqual({
      w: MIN_WIDGET_SIZE[kind].columnSpan,
      h: MIN_WIDGET_SIZE[kind].rowSpan,
    })
  })
})

describe('defaultWidgetTitle', () => {
  it.each(WIDGET_KINDS)('%s titles from the kind label', (kind) => {
    expect(defaultWidgetTitle(kind)).toBe(WIDGET_KIND_LABELS[kind])
  })
})

describe('defaultWidgetConfiguration', () => {
  it('gives richText and iframe complete, persistable configs', () => {
    expect(defaultWidgetConfiguration('richText')).toEqual({ kind: 'richText', content: null })
    expect(defaultWidgetConfiguration('iframe')).toEqual({ kind: 'iframe', url: null })
  })

  it.each([
    'barChart',
    'lineChart',
    'pieChart',
    'kpi',
    'gauge',
    'recordList',
  ] as const)('%s is an UNCONFIGURED SHELL with no source', (kind) => {
    const config = defaultWidgetConfiguration(kind) as { source?: unknown }
    expect(config.source).toBeUndefined()
  })

  it('prefills source from the dashboard entity def when one is given', () => {
    const config = defaultWidgetConfiguration('barChart', 'def-1') as { source?: unknown }
    expect(config.source).toEqual({ kind: 'entity', entityDefinitionId: 'def-1' })
  })

  it('treats a null entity def as no entity def', () => {
    const config = defaultWidgetConfiguration('kpi', null) as { source?: unknown }
    expect(config.source).toBeUndefined()
  })

  it('defaults the metric to a record count and recordList columns to empty', () => {
    expect(defaultWidgetConfiguration('kpi')).toMatchObject({ metric: { op: 'count' } })
    expect(defaultWidgetConfiguration('recordList')).toMatchObject({ columns: [] })
  })
})
