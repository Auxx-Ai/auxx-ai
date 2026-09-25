// packages/lib/src/mrp/__tests__/reads/part-series.test.ts

import { describe, expect, it } from 'vitest'
import { itemEvents, zonesFromItem } from '../../reads/part-series'
import {
  BAND_Z,
  bandHalfWidth,
  bucketStart,
  bucketUsage,
  projectionEndDay,
  walkProjection,
} from '../../reads/part-series-projection'
import { item } from '../support/plan-item'

const past = (day: string, consumed: number, stockout = false) => ({ day, consumed, stockout })

describe('bucketStart', () => {
  it('keeps the day, snaps weeks to Monday and months to the first', () => {
    expect(bucketStart('2026-09-24', 'day')).toBe('2026-09-24')
    expect(bucketStart('2026-09-24', 'week')).toBe('2026-09-21') // a Thursday
    expect(bucketStart('2026-09-21', 'week')).toBe('2026-09-21')
    expect(bucketStart('2026-09-27', 'week')).toBe('2026-09-21') // Sunday closes the week
    expect(bucketStart('2026-09-24', 'month')).toBe('2026-09-01')
  })
})

describe('bucketUsage', () => {
  it('sums the past as consumed and the future as projected, with stockout days', () => {
    const usage = bucketUsage(
      [past('2026-08-30', 4), past('2026-08-31', 0, true), past('2026-09-01', 3)],
      [
        { day: '2026-09-02', used: 2 },
        { day: '2026-10-01', used: 2.5 },
      ],
      'month'
    )
    expect(usage).toEqual([
      { bucket: '2026-08-01', consumed: 4, projected: null, stockoutDays: 1 },
      { bucket: '2026-09-01', consumed: 3, projected: 2, stockoutDays: 0 },
      { bucket: '2026-10-01', consumed: null, projected: 2.5, stockoutDays: 0 },
    ])
  })

  it('buckets weekly on both sides of today', () => {
    const usage = bucketUsage(
      [past('2026-09-21', 1), past('2026-09-23', 1)],
      [
        { day: '2026-09-24', used: 2 },
        { day: '2026-09-28', used: 2 },
      ],
      'week'
    )
    expect(usage.map((b) => [b.bucket, b.consumed, b.projected])).toEqual([
      ['2026-09-21', 2, 2],
      ['2026-09-28', null, 2],
    ])
  })
})

describe('projectionEndDay', () => {
  it('runs 90 days, or to a later following arrival, capped at 400', () => {
    expect(projectionEndDay('2026-09-24', null)).toBe('2026-12-23')
    expect(projectionEndDay('2026-09-24', '2026-11-01')).toBe('2026-12-23')
    expect(projectionEndDay('2026-09-24', '2027-06-08')).toBe('2027-06-08')
    expect(projectionEndDay('2026-09-24', '2029-01-01')).toBe('2027-10-29')
  })
})

describe('bandHalfWidth', () => {
  it('grows with √days and stops at the lead time', () => {
    expect(bandHalfWidth(2, 4, null)).toBeCloseTo(BAND_Z * 2 * 2)
    expect(bandHalfWidth(2, 100, 25)).toBeCloseTo(BAND_Z * 2 * 5)
    expect(bandHalfWidth(null, 10, 5)).toBe(0)
  })
})

describe('walkProjection', () => {
  const base = {
    fromDay: '2026-09-24',
    toDay: '2026-09-28',
    onHand: 10,
    receipts: [],
    baseAdu: 2,
    seasonalIndex: null,
    sigma: null,
    leadTimeDays: null,
  }

  it('depletes at baseAdu per day and floors at zero', () => {
    const points = walkProjection(base)
    expect(points.map((p) => p.onHand)).toEqual([8, 6, 4, 2, 0])
    expect(walkProjection({ ...base, onHand: 3 }).map((p) => p.onHand)).toEqual([1, 0, 0, 0, 0])
  })

  it('lands receipts at the start of their day, past-dated ones on day 0', () => {
    const points = walkProjection({
      ...base,
      receipts: [
        { day: '2026-09-26', quantity: 20 },
        { day: '2026-09-01', quantity: 5 },
        { day: '2027-01-01', quantity: 99 },
      ],
    })
    expect(points.map((p) => p.onHand)).toEqual([13, 11, 29, 27, 25])
  })

  it('applies the seasonal index of each day’s month', () => {
    const index = Array.from({ length: 12 }, () => 1)
    index[8] = 0.5 // Sep
    index[9] = 2 // Oct
    const points = walkProjection({
      ...base,
      fromDay: '2026-09-29',
      toDay: '2026-10-02',
      onHand: 100,
      seasonalIndex: index,
    })
    expect(points.map((p) => p.used)).toEqual([1, 1, 4, 4])
    expect(points.map((p) => p.onHand)).toEqual([99, 98, 94, 90])
  })

  it('brackets the line with z·σ·√(days ahead) capped at the lead time', () => {
    const points = walkProjection({ ...base, onHand: 100, sigma: 1, leadTimeDays: 2 })
    const [d0, , d2] = points
    expect(d0?.high).toBeCloseTo(98 + BAND_Z, 1)
    expect(d0?.low).toBeCloseTo(98 - BAND_Z, 1)
    expect(d2?.high).toBeCloseTo(94 + BAND_Z * Math.SQRT2, 1)
  })
})

describe('zonesFromItem / itemEvents', () => {
  it('zones only for a buffered item with all three tops', () => {
    expect(
      zonesFromItem(
        item({ partId: 'p', buffered: true, topOfRed: 45, topOfYellow: 165, topOfGreen: 225 })
      )
    ).toEqual({ topOfRed: 45, topOfYellow: 165, topOfGreen: 225 })
    expect(zonesFromItem(item({ partId: 'p', topOfRed: 1, topOfYellow: 2, topOfGreen: 3 }))).toBe(
      null
    )
    expect(zonesFromItem(undefined)).toBeNull()
  })

  it('marks order-by with the suggested quantity and the stockout date', () => {
    expect(
      itemEvents(
        item({
          partId: 'p',
          orderByDate: '2026-10-11',
          stockoutDate: '2026-12-31',
          suggestedQty: 360,
        })
      )
    ).toEqual([
      { day: '2026-10-11', kind: 'order_by', label: 'Order by', qty: 360 },
      { day: '2026-12-31', kind: 'stockout', label: 'Stockout' },
    ])
    expect(itemEvents(undefined)).toEqual([])
  })
})
