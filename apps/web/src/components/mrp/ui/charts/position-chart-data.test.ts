// apps/web/src/components/mrp/ui/charts/position-chart-data.test.ts
import { describe, expect, it } from 'vitest'
import { axisTicks, grainAllowed, type PositionRow, usageSpans } from './position-chart-data'

const row = (day: string, over: Partial<PositionRow> = {}): PositionRow => ({
  day,
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

describe('axisTicks', () => {
  it('caps the tick count', () => {
    const rows = Array.from({ length: 765 }, (_, i) => row(`d${i}`))
    const ticks = axisTicks(rows, 10)
    expect(ticks.length).toBeLessThanOrEqual(10)
    expect(ticks[0]).toBe('d0')
  })

  it('keeps every day when there are few', () => {
    expect(axisTicks([row('a'), row('b')], 10)).toEqual(['a', 'b'])
  })
})

describe('grainAllowed', () => {
  it('allows Day only at 3 months', () => {
    expect(grainAllowed('day', '3m')).toBe(true)
    expect(grainAllowed('day', '12m')).toBe(false)
    expect(grainAllowed('month', '12m')).toBe(true)
  })
})
