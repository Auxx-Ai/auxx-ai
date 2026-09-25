// packages/lib/src/mrp/__tests__/seasonality.test.ts

import { describe, expect, it } from 'vitest'
import {
  averageIndexOver,
  computeBaseAdu,
  computeSeasonalIndex,
  projectUsage,
  resolveSeasonalIndexes,
} from '../run/seasonality'
import type { MonthlyBucket } from '../types'

/** 02 §6.5: Lift A sold per month, Jan..Dec. */
const LIFT_A = [20, 20, 30, 45, 60, 60, 50, 40, 30, 25, 20, 20]
const LIFT_A_INDEX = [0.57, 0.57, 0.86, 1.29, 1.71, 1.71, 1.43, 1.14, 0.86, 0.71, 0.57, 0.57]

function buckets(years: number[], pattern: number[], stockout: string[] = []): MonthlyBucket[] {
  return years.flatMap((year) =>
    pattern.map((sold, m) => {
      const month = `${year}-${String(m + 1).padStart(2, '0')}`
      return {
        partId: 'lift',
        month,
        sold,
        consumed: sold,
        stockoutDays: stockout.includes(month) ? 3 : 0,
      }
    })
  )
}

describe('computeSeasonalIndex', () => {
  it('reproduces the Lift A table at full weight (24 months)', () => {
    const { index, months, weight } = computeSeasonalIndex(buckets([2024, 2025], LIFT_A))
    expect(months).toBe(24)
    expect(weight).toBe(1)
    index?.forEach((v, m) => expect(v).toBeCloseTo(LIFT_A_INDEX[m] as number, 2))
  })

  it('shrinks towards 1 with 12 months of history', () => {
    const { index, weight } = computeSeasonalIndex(buckets([2025], LIFT_A))
    expect(weight).toBe(0.5)
    expect(index?.[4]).toBeCloseTo(1 + 0.5 * (60 / 35 - 1))
    expect(index?.[0]).toBeCloseTo(1 + 0.5 * (20 / 35 - 1))
  })

  it('is off under 12 clean months', () => {
    expect(computeSeasonalIndex(buckets([2025], LIFT_A).slice(0, 11)).index).toBeNull()
  })

  it('drops stockout months before counting history', () => {
    const result = computeSeasonalIndex(buckets([2025], LIFT_A, ['2025-05']))
    expect(result.months).toBe(11)
    expect(result.index).toBeNull()
  })

  it('reads a flat history as an all-ones index', () => {
    const { index } = computeSeasonalIndex(buckets([2024, 2025], Array(12).fill(10)))
    expect(index).toEqual(Array(12).fill(1))
  })

  it('uses only the latest 24 months', () => {
    const old = buckets([2023], Array(12).fill(1000))
    const { months, index } = computeSeasonalIndex([...old, ...buckets([2024, 2025], LIFT_A)])
    expect(months).toBe(24)
    expect(index?.[0]).toBeCloseTo(0.57, 2)
  })
})

describe('resolveSeasonalIndexes', () => {
  const lift = [2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0]
  const flatSold = null

  it('blends parents by where-used share, a direct sale counting as its own parent', () => {
    const own = new Map([
      ['liftA', lift],
      ['liftB', flatSold],
      ['motor', Array(12).fill(1)],
    ])
    const resolved = resolveSeasonalIndexes(own, [
      { partId: 'motor', parentId: 'liftA', quantity: 50 },
      { partId: 'motor', parentId: 'liftB', quantity: 25 },
      { partId: 'motor', parentId: 'motor', quantity: 25 },
    ])
    expect(resolved.get('liftA')).toEqual(lift)
    // 0.5 × 2 + 0.25 × 1 (flat parent) + 0.25 × 1 (own) in Jan; 0.5 × 0 + 0.5 in Jul.
    expect(resolved.get('motor')?.[0]).toBeCloseTo(1.5)
    expect(resolved.get('motor')?.[6]).toBeCloseTo(0.5)
  })

  it('inherits through a subassembly to its component', () => {
    const own = new Map([['liftA', lift]])
    const resolved = resolveSeasonalIndexes(own, [
      { partId: 'assy', parentId: 'liftA', quantity: 10 },
      { partId: 'bracket', parentId: 'assy', quantity: 20 },
    ])
    expect(resolved.get('bracket')).toEqual(lift)
  })

  it('stays null when no parent has an index', () => {
    const resolved = resolveSeasonalIndexes(new Map(), [
      { partId: 'bolt', parentId: 'liftA', quantity: 10 },
    ])
    expect(resolved.get('bolt')).toBeNull()
  })
})

describe('projection', () => {
  const index = LIFT_A_INDEX

  it('takes the season out of the trailing rate (02 §6.5 step 4)', () => {
    // Jul–Sep, average index (31×1.43 + 31×1.14 + 30×0.86) ÷ 92.
    const avg = averageIndexOver(index, '2026-07-01', '2026-10-01')
    expect(avg).toBeCloseTo((31 * 1.43 + 31 * 1.14 + 30 * 0.86) / 92)
    expect(computeBaseAdu(1.3, index, '2026-07-01', '2026-10-01')).toBeCloseTo(1.3 / avg)
  })

  it('sums base × index per day across month boundaries', () => {
    expect(projectUsage(2, index, '2026-01-30', '2026-02-02')).toBeCloseTo(3 * 2 * 0.57)
    expect(projectUsage(2, index, '2026-05-31', '2026-06-02')).toBeCloseTo(2 * 1.71 * 2)
  })

  it('is ADU × days without an index, and 0 over an empty window', () => {
    expect(projectUsage(2, null, '2026-12-10', '2027-06-08')).toBe(360)
    expect(projectUsage(2, null, '2026-12-10', '2026-12-10')).toBe(0)
    expect(computeBaseAdu(2, null, '2026-07-01', '2026-10-01')).toBe(2)
  })
})
