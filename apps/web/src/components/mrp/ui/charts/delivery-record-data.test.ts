// apps/web/src/components/mrp/ui/charts/delivery-record-data.test.ts
import { describe, expect, it } from 'vitest'
import {
  buildDeliveryRecord,
  deliveryExtents,
  formatLateness,
  rollingMedian,
  type SupplierPerformanceData,
} from './delivery-record-data'
import { dayToT } from './position-chart-data'

type VendorPart = SupplierPerformanceData['vendorParts'][number]
type Line = VendorPart['lines'][number]

let seq = 0
const line = (over: Partial<Line> = {}): Line => {
  seq++
  return {
    purchaseOrderLineId: `pol-${seq}`,
    purchaseOrderId: `po-${seq}`,
    purchaseOrderName: `PO-${seq}`,
    status: 'closed',
    orderedAt: '2026-03-01',
    expectedAt: '2026-03-20',
    lastReceivedAt: '2026-03-24',
    quantityOrdered: 10,
    quantityReceived: 10,
    observation: null,
    excludedReason: null,
    ...over,
  }
}
const clean = (orderedAt: string, latenessDays: number | null, over: Partial<Line> = {}) =>
  line({
    orderedAt,
    observation: {
      purchaseOrderLineId: 'x',
      leadTimeDays: 20,
      latenessDays,
      fill: 1,
      receiptCount: 1,
    },
    ...over,
  })

const perf = (...parts: Line[][]): SupplierPerformanceData =>
  ({
    vendorParts: parts.map((lines, i) => ({ partName: `Part ${i}`, partSku: null, lines })),
  }) as unknown as SupplierPerformanceData

describe('buildDeliveryRecord', () => {
  it('classifies on time, late and excluded, and counts the lines without an expected date', () => {
    const record = buildDeliveryRecord(
      perf(
        [clean('2026-03-05', 4), clean('2026-03-01', 0)],
        [
          clean('2026-03-03', -2),
          clean('2026-03-04', null),
          line({ orderedAt: '2026-03-02', excludedReason: 'created_after_receipt' }),
          line({ orderedAt: null, excludedReason: 'no_ordered_at' }),
          line({ orderedAt: '2026-03-06', excludedReason: 'not_received', status: 'issued' }),
        ]
      )
    )
    expect(record.clean.map((p) => [p.orderedAt, p.lateness, p.kind])).toEqual([
      ['2026-03-01', 0, 'on_time'],
      ['2026-03-03', -2, 'on_time'],
      ['2026-03-05', 4, 'late'],
    ])
    expect(record.clean[0]?.partName).toBe('Part 0')
    expect(record.clean[1]?.partName).toBe('Part 1')
    expect(record.excluded).toHaveLength(1)
    expect(record.excluded[0]).toMatchObject({
      t: dayToT('2026-03-02'),
      lateness: 0,
      kind: 'excluded',
      excludedReason: 'created_after_receipt',
    })
    expect(record.noExpected).toBe(1)
  })

  it('draws the rolling median over the points in order of order date', () => {
    const record = buildDeliveryRecord(
      perf([clean('2026-03-03', 9), clean('2026-03-01', 1), clean('2026-03-02', 3)])
    )
    expect(record.median).toEqual([
      { t: dayToT('2026-03-01'), value: 1 },
      { t: dayToT('2026-03-02'), value: 2 },
      { t: dayToT('2026-03-03'), value: 3 },
    ])
  })
})

describe('rollingMedian', () => {
  it('takes the median of the last 8 values', () => {
    const values = [10, 10, 10, 10, 0, 0, 0, 0, 0]
    const out = rollingMedian(values)
    expect(out.slice(0, 4)).toEqual([10, 10, 10, 10])
    expect(out[7]).toBe(5)
    // The ninth drops the first 10: five zeros of eight.
    expect(out[8]).toBe(0)
  })

  it('honours a custom window', () => {
    expect(rollingMedian([1, 5, 9, 2], 2)).toEqual([1, 3, 7, 5.5])
  })
})

describe('deliveryExtents', () => {
  it('pads x half a day and puts y on nice ticks around 0', () => {
    const record = buildDeliveryRecord(
      perf([
        clean('2026-03-01', 13),
        clean('2026-03-11', -3),
        line({ orderedAt: '2026-03-20', excludedReason: 'ordered_on_receipt_day' }),
      ])
    )
    expect(deliveryExtents(record)).toEqual([
      dayToT('2026-03-01') - 0.5,
      dayToT('2026-03-20') + 0.5,
      -5,
      15,
    ])
  })

  it('keeps 0 inside y when every point is late', () => {
    const [, , lo, hi] = deliveryExtents(buildDeliveryRecord(perf([clean('2026-03-01', 7)])))
    expect(lo).toBe(0)
    expect(hi).toBeGreaterThanOrEqual(7)
  })
})

describe('formatLateness', () => {
  it('signs days late and early', () => {
    expect(formatLateness(4)).toBe('+4 d')
    expect(formatLateness(-3)).toBe('−3 d')
    expect(formatLateness(0)).toBe('0 d')
    expect(formatLateness(2.5)).toBe('+2.5 d')
  })
})
