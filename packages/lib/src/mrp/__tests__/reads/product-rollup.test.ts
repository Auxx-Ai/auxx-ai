// packages/lib/src/mrp/__tests__/reads/product-rollup.test.ts

import { describe, expect, it } from 'vitest'
import type { DailySeriesRow } from '../../../inventory/movements/fact/reads'
import type { walkBom } from '../../reads/part-item'
import type { ProjectionWalkPoint } from '../../reads/part-series-projection'
import {
  familyDaysOfCover,
  familyEvents,
  familyUnbuilt,
  foldSeriesKeys,
  OTHER_SERIES_KEY,
  pickFamilyLimiting,
  productTotals,
  rankVariants,
  rollUpUsage,
  sumFamilyDays,
  sumProjections,
} from '../../reads/product-rollup'
import { item } from '../support/plan-item'

const row = (partId: string, day: string, onHandEod: number, consumed = 0): DailySeriesRow => ({
  partId,
  day,
  consumed,
  scrapped: 0,
  net: -consumed,
  onHandEod,
})

const point = (day: string, onHand: number, half: number, used = 1): ProjectionWalkPoint => ({
  day,
  onHand,
  low: Math.max(0, onHand - half),
  high: onHand + half,
  used,
})

type Node = ReturnType<typeof walkBom>[number]
const node = (partId: string): Node => ({
  key: `root/${partId}`,
  parentKey: null,
  partId,
  depth: 1,
  quantityPer: 1,
  hasChildren: false,
  parentCount: 1,
})

describe('rankVariants and foldSeriesKeys', () => {
  const variants = Array.from({ length: 10 }, (_, i) => ({ partId: `p${i}`, name: `V${i}` }))

  it('ranks by baseAdu desc, variants without an item or baseAdu last by name', () => {
    const items = new Map([
      ['p3', item({ partId: 'p3', baseAdu: 5 })],
      ['p1', item({ partId: 'p1', baseAdu: 9 })],
      ['p2', item({ partId: 'p2', baseAdu: null })],
    ])
    const ranked = rankVariants(
      [
        { partId: 'p0', name: 'Zed' },
        { partId: 'p1', name: 'B' },
        { partId: 'p2', name: 'Alpha' },
        { partId: 'p3', name: 'C' },
      ],
      items
    )
    expect(ranked.map((v) => v.partId)).toEqual(['p1', 'p3', 'p2', 'p0'])
  })

  it('keeps every variant its own key up to eight', () => {
    const keys = foldSeriesKeys(variants.slice(0, 8))
    expect(keys).toHaveLength(8)
    expect(keys.some((k) => k.key === OTHER_SERIES_KEY)).toBe(false)
  })

  it('folds the tail past seven into Other', () => {
    const keys = foldSeriesKeys(variants)
    expect(keys).toHaveLength(8)
    expect(keys.slice(0, 7).map((k) => k.key)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
    expect(keys[7]).toEqual({ key: OTHER_SERIES_KEY, name: 'Other', partIds: ['p7', 'p8', 'p9'] })
  })
})

describe('sumFamilyDays', () => {
  const keys = [
    { key: 'a', name: 'A', partIds: ['a'] },
    { key: 'other', name: 'Other', partIds: ['b', 'c'] },
  ]

  it('sums per day, floors each slice at zero and keeps the true sum on the line', () => {
    const [day] = sumFamilyDays(
      [row('a', '2026-09-01', 5, 2), row('b', '2026-09-01', -3, 1), row('c', '2026-09-01', 4)],
      ['a', 'b', 'c'],
      keys
    )
    expect(day).toMatchObject({
      day: '2026-09-01',
      onHandEod: 6,
      consumed: 3,
      net: -3,
      onHandByKey: [5, 4],
      consumedByKey: [2, 1],
      stockout: false,
    })
  })

  it('marks a family stockout only when every stocked variant is out', () => {
    const days = sumFamilyDays(
      [
        row('a', '2026-09-01', 0),
        row('b', '2026-09-01', 0),
        row('c', '2026-09-01', 0),
        row('a', '2026-09-02', 0),
        row('b', '2026-09-02', 0),
        row('c', '2026-09-02', 7),
        row('a', '2026-09-03', 0),
        row('b', '2026-09-03', 0),
      ],
      ['a', 'b', 'c'],
      keys
    )
    // Day 3 has no row for c, which counts as not out.
    expect(days.map((d) => d.stockout)).toEqual([true, false, false])
  })
})

describe('sumProjections', () => {
  it('sums on hand and takes the band half-width as √Σ half²', () => {
    const { projection } = sumProjections([
      [point('2026-09-01', 10, 3)],
      [point('2026-09-01', 20, 4)],
    ])
    expect(projection).toEqual([{ day: '2026-09-01', onHand: 30, low: 25, high: 35 }])
  })

  it('floors the low edge at zero', () => {
    const { projection } = sumProjections([
      [point('2026-09-01', 1, 3)],
      [point('2026-09-01', 1, 4)],
    ])
    expect(projection[0]?.low).toBe(0)
    expect(projection[0]?.high).toBe(7)
  })

  it('pads a shorter walk with its last level and no further usage', () => {
    const { projection, used } = sumProjections([
      [point('2026-09-01', 10, 0, 2), point('2026-09-02', 8, 0, 2), point('2026-09-03', 6, 0, 2)],
      [point('2026-09-01', 5, 0, 1)],
    ])
    expect(projection.map((p) => [p.day, p.onHand])).toEqual([
      ['2026-09-01', 15],
      ['2026-09-02', 13],
      ['2026-09-03', 11],
    ])
    expect(used.map((u) => u.used)).toEqual([3, 2, 2])
  })

  it('is empty without walks', () => {
    expect(sumProjections([])).toEqual({ projection: [], used: [] })
  })
})

describe('rollUpUsage', () => {
  it('buckets the family and carries per-key consumption', () => {
    const usage = rollUpUsage(
      [
        { day: '2026-08-31', consumed: 3, stockout: true, consumedByKey: [1, 2] },
        { day: '2026-09-01', consumed: 4, stockout: false, consumedByKey: [4, 0] },
      ],
      [{ day: '2026-09-02', used: 1.5 }],
      2,
      'month'
    )
    expect(usage).toEqual([
      {
        bucket: '2026-08-01',
        consumed: 3,
        projected: null,
        stockoutDays: 1,
        consumedByKey: [1, 2],
      },
      { bucket: '2026-09-01', consumed: 4, projected: 1.5, stockoutDays: 0, consumedByKey: [4, 0] },
    ])
  })
})

describe('familyEvents', () => {
  it('prefixes run markers with the variant and collapses arrivals per day', () => {
    const events = familyEvents([
      {
        name: 'Lift B',
        itemEvents: [{ day: '2026-10-11', kind: 'stockout', label: 'Stockout' }],
        supply: [
          { day: '2026-10-01', kind: 'po_arrival', label: 'PO-1', qty: 5 },
          { day: '2026-10-01', kind: 'build_due', label: 'B-7', qty: 2 },
        ],
      },
      {
        name: 'Lift A',
        itemEvents: [{ day: '2026-10-05', kind: 'order_by', label: 'Order by', qty: 20 }],
        supply: [
          { day: '2026-10-01', kind: 'po_arrival', label: 'PO-1', qty: 3 },
          { day: '2026-10-01', kind: 'po_arrival', label: 'PO-2', qty: 1 },
        ],
      },
    ])
    expect(events).toEqual([
      { day: '2026-10-01', kind: 'po_arrival', label: 'PO-1, PO-2', qty: 9 },
      { day: '2026-10-01', kind: 'build_due', label: 'B-7', qty: 2 },
      { day: '2026-10-05', kind: 'order_by', label: 'Lift A · Order by', qty: 20 },
      { day: '2026-10-11', kind: 'stockout', label: 'Lift B · Stockout' },
    ])
  })
})

describe('pickFamilyLimiting', () => {
  it('picks the earliest stockout over the union and counts the BOMs holding it', () => {
    const items = new Map([
      ['motor', item({ partId: 'motor', stockoutDate: '2026-11-20' })],
      ['frame', item({ partId: 'frame', stockoutDate: '2026-12-01' })],
      ['bolt', item({ partId: 'bolt', stockoutDate: null })],
    ])
    const picked = pickFamilyLimiting(
      [
        [node('frame'), node('motor')],
        [node('motor'), node('bolt'), node('motor')],
        [node('bolt')],
      ],
      items
    )
    expect(picked?.node.partId).toBe('motor')
    expect(picked?.variantCount).toBe(2)
  })

  it('is null when no node has a stockout', () => {
    expect(pickFamilyLimiting([[node('bolt')]], new Map())).toBeNull()
  })
})

describe('family sums', () => {
  it('floors unbuilt per variant before summing', () => {
    expect(
      familyUnbuilt([
        { sold: 10, built: 4, opening: 2 }, // 4
        { sold: 1, built: 8, opening: 0 }, // −7 floors to 0, not netted
        { sold: 5, built: 0, opening: -3 }, // negative opening counts as 0 → 5
      ])
    ).toBe(9)
  })

  it('takes days of cover as Σ on hand ÷ Σ ADU, null without usage', () => {
    expect(familyDaysOfCover(84, 6)).toBe(14)
    expect(familyDaysOfCover(10, 0)).toBeNull()
    expect(familyDaysOfCover(-5, 2)).toBe(0)
  })

  it('totals stocked items and picks the earliest dates and smallest cover', () => {
    const totals = productTotals([
      {
        partId: 'a',
        item: {
          ...item({
            partId: 'a',
            onHand: 40,
            adu: 2,
            suggestionKind: 'build',
            buffered: true,
            stockoutDate: '2026-11-20',
            orderByDate: '2026-10-11',
          }),
          daysOfCover: 34,
        },
      },
      {
        partId: 'b',
        item: {
          ...item({
            partId: 'b',
            onHand: 4,
            adu: 2,
            suggestionKind: 'purchase',
            stockoutDate: '2026-10-01',
            orderByDate: '2026-09-20',
            isOverdue: true,
          }),
          daysOfCover: 3,
        },
      },
      { partId: 'c', item: null },
    ])
    expect(totals).toMatchObject({
      onHand: 44,
      adu: 4,
      daysOfCover: 11,
      minCover: { partId: 'b', days: 3 },
      firstStockout: { partId: 'b', day: '2026-10-01' },
      firstOrderBy: { partId: 'b', day: '2026-09-20', isOverdue: true },
      suggestions: { purchase: 1, build: 1 },
      buffered: 1,
      stocked: 3,
      inRun: 2,
    })
  })
})
