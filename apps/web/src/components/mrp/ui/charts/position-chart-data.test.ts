// apps/web/src/components/mrp/ui/charts/position-chart-data.test.ts
import { describe, expect, it } from 'vitest'
import {
  buildPositionRows,
  dayToT,
  grainAllowed,
  mergeRows,
  niceTicks,
  type PositionRow,
  type SeriesData,
  tToDay,
  usageSpans,
  xTicks,
  yExtents,
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
  onHandByKey: null,
  usedByKey: null,
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

const day = (d: string, onHandEod: number, onHandByKey?: number[]) => ({
  day: d,
  consumed: 0,
  scrapped: 0,
  net: 0,
  onHandEod,
  stockout: false,
  ...(onHandByKey && { onHandByKey }),
})

const series = (over: Partial<SeriesData> = {}): SeriesData => ({
  run: null,
  zone: 'UTC',
  days: [],
  usage: [],
  projection: [],
  events: [],
  zones: null,
  runAsOf: '2026-09-23',
  seasonal: true,
  historyMonths: 12,
  hasEarlier: false,
  ...over,
})

const product = series({
  series: [
    { key: 'a', name: 'Lift A', partIds: ['a'] },
    { key: 'other', name: 'Other', partIds: ['b', 'c'] },
  ],
  days: [day('2026-09-21', 5, [3, 4]), day('2026-09-22', -1, [0, 2])],
  usage: [
    { bucket: '2026-09-21', consumed: 6, projected: null, stockoutDays: 0, consumedByKey: [2, 4] },
    { bucket: '2026-09-23', consumed: null, projected: 5, stockoutDays: 0, consumedByKey: [0, 0] },
  ],
  projection: [{ day: '2026-09-23', onHand: 0, low: 0, high: 2 }],
})

describe('buildPositionRows — stacked by key', () => {
  it('carries per-key on hand and per-key usage on past days only', () => {
    const rows = buildPositionRows(product)
    expect(rows.map((r) => [r.day, r.onHandByKey, r.usedByKey])).toEqual([
      ['2026-09-21', [3, 4], [2, 4]],
      ['2026-09-22', [0, 2], [2, 4]],
      ['2026-09-23', null, null],
    ])
    expect(rows.map((r) => r.onHand)).toEqual([5, -1, null])
  })

  it('leaves the per-key fields null for a part', () => {
    const part = series({
      days: [day('2026-09-21', 5)],
      usage: [{ bucket: '2026-09-21', consumed: 6, projected: null, stockoutDays: 0 }],
    })
    const [r] = buildPositionRows(part)
    expect(r?.onHandByKey).toBeNull()
    expect(r?.usedByKey).toBeNull()
    expect(r?.used).toBe(6)
  })

  it('draws one stacked span per bucket, not one per day', () => {
    expect(usageSpans(buildPositionRows(product))).toEqual([
      { from: '2026-09-21', to: '2026-09-22', value: 6, projected: false, byKey: [2, 4] },
      { from: '2026-09-23', to: '2026-09-23', value: 5, projected: true },
    ])
  })

  it('stretches the left axis over the floored stack and the right over the stacked bucket', () => {
    const rows = [
      row('2026-09-21', { onHand: -1, onHandByKey: [30, 45], used: 2, usedByKey: [20, 12] }),
    ]
    const { left, right } = yExtents(rows, null)
    expect(left[1]).toBeGreaterThanOrEqual(75)
    expect(right[1]).toBeGreaterThanOrEqual(32)
  })

  it('sizes the usage axis from the positive segments only', () => {
    const rows = [row('2026-09-21', { used: 5, usedByKey: [30, -25] })]
    expect(yExtents(rows, null).right[1]).toBeGreaterThanOrEqual(30)
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
  it('keeps the per-key arrays of the winning row', () => {
    const prev = [row('2026-09-02', { onHandByKey: [1, 1] })]
    const next = [row('2026-09-02', { onHandByKey: [4, 5] })]
    expect(mergeRows(prev, next)[0]?.onHandByKey).toEqual([4, 5])
  })

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
