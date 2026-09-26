// packages/lib/src/mrp/__tests__/usage.test.ts

import { addDaysToDayKey } from '@auxx/utils/calendar-day'
import { describe, expect, it } from 'vitest'
import { computeShelfSignals, computeUsage, isStockoutDay } from '../run/usage'
import type { DailyActivity, DailySeriesPoint } from '../types'

function series(
  rows: [consumed: number, onHandEod: number, scrapped?: number][]
): DailySeriesPoint[] {
  return rows.map(([consumed, onHandEod, scrapped = 0], i) => ({
    partId: 'p',
    day: addDaysToDayKey('2026-09-01', i),
    consumed,
    scrapped,
    net: -consumed - scrapped,
    onHandEod,
  }))
}

function activity(rows: Partial<DailyActivity>[]): DailyActivity[] {
  return rows.map((r, i) => ({
    partId: 'p',
    day: addDaysToDayKey('2026-09-01', i),
    saleQty: 0,
    saleCount: 0,
    produceQty: 0,
    produceCount: 0,
    consumeQty: 0,
    consumeCount: 0,
    ...r,
  }))
}

describe('computeUsage', () => {
  it('averages every day when nothing stocked out', () => {
    const usage = computeUsage(
      series([
        [2, 10],
        [4, 6],
        [0, 6],
        [2, 4],
      ])
    )
    expect(usage.adu).toBe(2)
    expect(usage.sigma).toBeCloseTo(Math.sqrt(2))
    expect(usage.cv).toBeCloseTo(Math.sqrt(2) / 2)
    expect(usage.observedDays).toBe(4)
    expect(usage.stockoutDaysExcluded).toBe(0)
  })

  it('censors days with nothing on hand and nothing consumed', () => {
    const usage = computeUsage(
      series([
        [3, 3],
        [3, 0],
        [0, 0],
        [0, 0],
        [3, 5],
      ])
    )
    expect(usage.stockoutDaysExcluded).toBe(2)
    expect(usage.observedDays).toBe(3)
    expect(usage.adu).toBe(3)
  })

  it('keeps a zero-use day with stock on the shelf', () => {
    expect(isStockoutDay(series([[0, 5]])[0] as DailySeriesPoint)).toBe(false)
  })

  it('keeps a day that consumed into negative on hand', () => {
    expect(isStockoutDay(series([[2, -2]])[0] as DailySeriesPoint)).toBe(false)
  })

  it('counts scrap as usage', () => {
    expect(
      computeUsage(
        series([
          [1, 9, 1],
          [1, 7, 1],
        ])
      ).adu
    ).toBe(2)
  })

  it('counts a negative on-hand day with no use as usage, not a stockout', () => {
    const usage = computeUsage(
      series([
        [0, -3],
        [2, -5],
        [0, -5],
        [0, -5],
      ])
    )
    expect(usage.stockoutDaysExcluded).toBe(0)
    expect(usage.negativeDays).toBe(4)
    expect(usage.adu).toBe(0.5)
  })

  it('averages every day once stockouts pass half the window', () => {
    const usage = computeUsage(
      series([
        [0, 0],
        [0, 0],
        [0, 0],
        [4, 0],
      ])
    )
    expect(usage.censorCapped).toBe(true)
    expect(usage.stockoutDaysExcluded).toBe(0)
    expect(usage.adu).toBe(1)
  })

  it('returns null ADU for an empty window', () => {
    const usage = computeUsage([])
    expect(usage.adu).toBeNull()
    expect(usage.cv).toBeNull()
    expect(usage.censorCapped).toBe(false)
  })
})

describe('computeShelfSignals', () => {
  it('reads assemble-to-order when most sale days carry a same-day build', () => {
    const signals = computeShelfSignals(
      activity([
        { saleQty: 1, saleCount: 1, produceQty: 1, produceCount: 1 },
        { saleQty: 1, saleCount: 1, produceQty: 1, produceCount: 1 },
        { saleQty: 1, saleCount: 1 },
      ])
    )
    expect(signals.saleDays).toBe(3)
    expect(signals.saleDaysWithoutBuild).toBe(1)
    expect(signals.soldFromShelf).toBe(false)
  })

  it('reads sold from the shelf when most sale days have no build', () => {
    const signals = computeShelfSignals(
      activity([
        { saleQty: 2, saleCount: 2 },
        { saleQty: 1, saleCount: 1 },
        { produceQty: 20, produceCount: 1 },
      ])
    )
    expect(signals.soldFromShelfShare).toBe(1)
    expect(signals.soldFromShelf).toBe(true)
    expect(signals.typicalProduceQty).toBe(20)
    expect(signals.typicalUseQty).toBe(1)
    expect(signals.batchBuilt).toBe(true)
  })

  it('reads a subassembly built one-for-one as not batch built', () => {
    const signals = computeShelfSignals(
      activity([
        { produceQty: 1, produceCount: 1, consumeQty: 1, consumeCount: 1 },
        { produceQty: 2, produceCount: 1, consumeQty: 2, consumeCount: 2 },
      ])
    )
    expect(signals.soldFromShelfShare).toBeNull()
    expect(signals.batchBuilt).toBe(false)
  })
})
