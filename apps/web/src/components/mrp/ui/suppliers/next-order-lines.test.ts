// apps/web/src/components/mrp/ui/suppliers/next-order-lines.test.ts

import { describe, expect, it } from 'vitest'
import {
  adjustQuantity,
  clampPercent,
  draftItems,
  excludedIds,
  movesOrderEarlier,
  movesOrderTo,
  seasonFactor,
  toggleExcluded,
} from './next-order-lines'

describe('ticks', () => {
  it('unticking excludes a part and ticking brings it back', () => {
    const once = toggleExcluded(new Set(), 'motor')
    expect([...once]).toEqual(['motor'])
    expect([...toggleExcluded(once, 'motor')]).toEqual([])
  })

  it('the excluded ids are one query key whatever the click order', () => {
    expect(excludedIds(new Set(['b', 'a']))).toEqual(excludedIds(new Set(['a', 'b'])))
  })
})

describe('adjustQuantity', () => {
  it('leaves the line alone at 0 %', () => {
    expect(adjustQuantity(360, 18, 0)).toEqual({ quantity: 360, purchaseUnits: 18 })
  })

  it('rounds up to whole packs at the line pack size', () => {
    // 360 in 18 packs of 20; +10 % is 396 → 20 packs → 400.
    expect(adjustQuantity(360, 18, 10)).toEqual({ quantity: 400, purchaseUnits: 20 })
  })

  it('an exact multiple does not gain a pack on float noise', () => {
    expect(adjustQuantity(100, 5, 20)).toEqual({ quantity: 120, purchaseUnits: 6 })
  })

  it('rounds eaches up without a pack size', () => {
    expect(adjustQuantity(15, null, 10)).toEqual({ quantity: 17, purchaseUnits: null })
  })

  it('never goes below one pack and keeps null as null', () => {
    expect(adjustQuantity(20, 1, -50)).toEqual({ quantity: 20, purchaseUnits: 1 })
    expect(adjustQuantity(null, null, 10)).toBeNull()
  })
})

describe('clampPercent', () => {
  it('bounds and rounds the typed value', () => {
    expect(clampPercent(12.4)).toBe(12)
    expect(clampPercent(1000)).toBe(200)
    expect(clampPercent(-90)).toBe(-50)
    expect(clampPercent(Number.NaN)).toBe(0)
  })
})

describe('moving the order', () => {
  it('a past order-by moves the order to the run day', () => {
    expect(movesOrderTo('2026-09-04', '2026-09-24')).toBe('2026-09-24')
    expect(movesOrderTo('2026-10-11', '2026-09-24')).toBe('2026-10-11')
  })

  it('only an order-by before the rhythm moves it earlier', () => {
    expect(movesOrderEarlier('2026-10-11', '2026-10-17')).toBe(true)
    expect(movesOrderEarlier('2026-10-20', '2026-10-17')).toBe(false)
    expect(movesOrderEarlier('2026-10-11', null)).toBe(false)
  })
})

describe('seasonFactor', () => {
  it('weights each month by its days in the window', () => {
    const index = Array.from({ length: 12 }, (_, month) => (month === 0 ? 2 : 1))
    // Dec 22 – Jan 10: 10 days of December at 1, 9 of January at 2.
    expect(seasonFactor(index, '2026-12-22', '2027-01-10')).toBeCloseTo(28 / 19)
  })

  it('is null without an index or a window', () => {
    expect(seasonFactor(null, '2026-12-22', '2027-01-10')).toBeNull()
    expect(seasonFactor([1], null, '2027-01-10')).toBeNull()
  })
})

describe('draftItems', () => {
  it('drafts the ticked lines with a quantity, adjusted', () => {
    const parts = [
      { partId: 'motor', excluded: false, quantity: 360, purchaseUnits: 18 },
      { partId: 'bracket', excluded: true, quantity: 540, purchaseUnits: 540 },
      { partId: 'frame', excluded: false, quantity: 0, purchaseUnits: 0 },
      { partId: 'bolt', excluded: false, quantity: null, purchaseUnits: null },
    ]
    expect(draftItems(parts, 10)).toEqual([{ partId: 'motor', quantity: 400 }])
  })
})
