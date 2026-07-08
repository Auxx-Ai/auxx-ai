// apps/web/src/components/dashboard/lib/legend-pages.test.ts

import { describe, expect, it } from 'vitest'
import { binIntoPages } from './legend-pages'

const PAGINATOR = 60
const GAP = 12

describe('binIntoPages', () => {
  it('returns a single page when everything fits (no paginator reserved)', () => {
    // 3 items of 40 + 2 gaps of 12 = 144 <= 200
    expect(binIntoPages([40, 40, 40], 200, PAGINATOR, GAP)).toEqual([[0, 1, 2]])
  })

  it('packs items across pages when they overflow, reserving paginator width', () => {
    // total = 100*4 + 3*12 = 436 > 300 → paginate; available = 300-60-12 = 228
    // page: 100 (+0) = 100, +12+100 = 212, +12+100 = 324 > 228 → break
    const pages = binIntoPages([100, 100, 100, 100], 300, PAGINATOR, GAP)
    expect(pages).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  it('places an over-wide item on its own page rather than splitting it', () => {
    // available = 200-60-12 = 128; item 1 (150) is wider than available
    const pages = binIntoPages([50, 150, 50], 200, PAGINATOR, GAP)
    expect(pages).toEqual([[0], [1], [2]])
  })

  it('returns [[]] for no items', () => {
    expect(binIntoPages([], 300, PAGINATOR, GAP)).toEqual([[]])
  })

  it('returns [[]] when width is not yet measured', () => {
    expect(binIntoPages([40, 40], 0, PAGINATOR, GAP)).toEqual([[]])
  })

  it('boundary: exact fit stays on one page', () => {
    // 2 items of 94 + 1 gap of 12 = 200 == 200
    expect(binIntoPages([94, 94], 200, PAGINATOR, GAP)).toEqual([[0, 1]])
  })
})
