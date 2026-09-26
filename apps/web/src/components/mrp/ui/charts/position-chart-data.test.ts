// apps/web/src/components/mrp/ui/charts/position-chart-data.test.ts
import { describe, expect, it } from 'vitest'
import {
  dayToT,
  grainAllowed,
  mergeRows,
  niceTicks,
  type PositionRow,
  tToDay,
  usageSpans,
  xTicks,
} from './position-chart-data'

const row = (day: string, over: Partial<PositionRow> = {}): PositionRow => ({
  day,
  t: dayToT(day),
  onHand: null,
  projected: null,
  bandLow: null,
  bandSpan: null,
  used: null,
  projectedUse: null,
  bucketEnd: false,
  stockout: false,
  events: [],
  ...over,
})

describe('usageSpans', () => {
  it('draws one span per bucket, split at the run day', () => {
    const rows = [
      row('2026-09-21', { used: 7 }),
      row('2026-09-22', { used: 7, bucketEnd: true }),
      row('2026-09-23', { projectedUse: 5 }),
      row('2026-09-24', { projectedUse: 5, bucketEnd: true }),
      row('2026-09-25', { projectedUse: 9, bucketEnd: true }),
    ]
    expect(usageSpans(rows)).toEqual([
      { from: '2026-09-21', to: '2026-09-22', value: 7, projected: false },
      { from: '2026-09-23', to: '2026-09-24', value: 5, projected: true },
      { from: '2026-09-25', to: '2026-09-25', value: 9, projected: true },
    ])
  })

  it('skips empty and zero buckets', () => {
    const rows = [
      row('2026-09-21'),
      row('2026-09-22', { used: 0, bucketEnd: true }),
      row('2026-09-23', { used: 3, bucketEnd: true }),
    ]
    expect(usageSpans(rows)).toEqual([
      { from: '2026-09-23', to: '2026-09-23', value: 3, projected: false },
    ])
  })
})

describe('xTicks', () => {
  it('caps the tick count', () => {
    const ticks = xTicks(0, 765, 10)
    expect(ticks.length).toBeLessThanOrEqual(10)
  })

  it('keeps every day when there are few', () => {
    expect(xTicks(-0.5, 1.5, 10)).toEqual([0, 1])
  })

  it('anchors to the epoch so paging keeps the same days ticked', () => {
    const a = xTicks(100, 190, 10)
    const b = xTicks(130, 220, 10)
    expect(a.filter((t) => t >= 130)).toEqual(b.filter((t) => t <= 190))
  })
})

describe('day ↔ t', () => {
  it('round-trips and counts whole days', () => {
    expect(tToDay(dayToT('2026-09-24'))).toBe('2026-09-24')
    expect(dayToT('2026-09-25') - dayToT('2026-09-24')).toBe(1)
  })
})

describe('niceTicks', () => {
  it('rounds the range out to a 1/2/5 step', () => {
    expect(niceTicks(0, 87)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(0, 3)).toEqual([0, 1, 2, 3])
    expect(niceTicks(-12, 40)).toEqual([-20, -10, 0, 10, 20, 30, 40])
  })

  it('never steps below one', () => {
    expect(niceTicks(0, 0.4)).toEqual([0, 1])
  })
})

describe('mergeRows', () => {
  it('unions two windows with the newer window winning on overlap', () => {
    const prev = [row('2026-09-01', { used: 1 }), row('2026-09-02', { used: 1 })]
    const next = [row('2026-09-02', { used: 9 }), row('2026-09-03', { used: 9 })]
    expect(mergeRows(prev, next).map((r) => [r.day, r.used])).toEqual([
      ['2026-09-01', 1],
      ['2026-09-02', 9],
      ['2026-09-03', 9],
    ])
  })
})

describe('grainAllowed', () => {
  it('allows Day only at 3 months', () => {
    expect(grainAllowed('day', '3m')).toBe(true)
    expect(grainAllowed('day', '12m')).toBe(false)
    expect(grainAllowed('month', '12m')).toBe(true)
  })
})
