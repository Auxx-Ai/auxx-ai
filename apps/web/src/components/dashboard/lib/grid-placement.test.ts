// apps/web/src/components/dashboard/lib/grid-placement.test.ts

import type { GridPosition } from '@auxx/lib/dashboards/client'
import { describe, expect, it } from 'vitest'
import { findNextFreePosition } from './grid-placement'

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
    // Left half of the top rows taken, right half free — a 6-wide fits at col 6.
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
