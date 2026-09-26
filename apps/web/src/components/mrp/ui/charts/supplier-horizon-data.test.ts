// apps/web/src/components/mrp/ui/charts/supplier-horizon-data.test.ts
import { describe, expect, it } from 'vitest'
import { dayToT } from './position-chart-data'
import {
  buildHorizonLanes,
  cycleTicks,
  type HorizonMark,
  type HorizonOrder,
  type HorizonPart,
  horizonExtent,
  mergeLanes,
  type SupplierHorizonData,
} from './supplier-horizon-data'

const TODAY = '2026-09-24'

const order = (id: string, over: Partial<HorizonOrder> = {}): HorizonOrder => ({
  purchaseOrderId: id,
  name: `PO-${id}`,
  status: 'closed',
  orderedAt: '2026-03-01',
  expectedAt: '2026-04-01',
  lastReceivedAt: '2026-04-03',
  open: false,
  projectedArrival: null,
  quantityOrdered: 10,
  quantityReceived: 10,
  ...over,
})

const part = (id: string, over: Partial<HorizonPart> = {}): HorizonPart => ({
  partId: id,
  name: `Part ${id}`,
  sku: null,
  orderByDate: '2026-10-10',
  stockoutDate: '2026-11-10',
  pullsOrderForward: false,
  wontMakeNextArrival: false,
  suggestedQty: 5,
  ...over,
})

const horizon = (over: Partial<SupplierHorizonData> = {}): SupplierHorizonData => ({
  runAsOf: TODAY,
  from: '2026-03-24',
  to: '2026-12-23',
  hasEarlier: false,
  orders: [],
  cycle: null,
  nextOrder: null,
  parts: [],
  ...over,
})

const kinds = (marks: HorizonMark[]) => marks.map((m) => m.kind)

describe('buildHorizonLanes', () => {
  it('orders lanes: Orders, open POs, Next order, parts', () => {
    const lanes = buildHorizonLanes(
      horizon({
        orders: [
          order('a'),
          order('b', {
            status: 'issued',
            open: true,
            lastReceivedAt: null,
            expectedAt: '2026-10-01',
          }),
        ],
        nextOrder: { orderDate: '2026-10-05', arrivalDate: '2026-11-01', pulledForwardBy: [] },
        parts: [part('late', { orderByDate: null }), part('early', { orderByDate: '2026-10-01' })],
      }),
      { today: TODAY }
    )
    expect(lanes.map((l) => l.key)).toEqual(['orders', 'po:b', 'next', 'part:early', 'part:late'])
    expect(lanes[1]?.record).toEqual({ definition: 'purchase_order', id: 'b' })
  })

  it('draws a past PO as a bar to its receipt, a dot without one', () => {
    const [orders] = buildHorizonLanes(
      horizon({ orders: [order('a'), order('b', { lastReceivedAt: null })] }),
      { today: TODAY }
    )
    expect(orders?.marks).toMatchObject([
      { kind: 'bar', tone: 'received', from: dayToT('2026-03-01'), to: dayToT('2026-04-03') },
      { kind: 'dot', t: dayToT('2026-03-01') },
    ])
  })

  it('caps part lanes at 12, 6 when compact, with a "+N more" label', () => {
    const data = horizon({ parts: Array.from({ length: 15 }, (_, i) => part(`p${i}`)) })
    const full = buildHorizonLanes(data, { today: TODAY })
    expect(full.filter((l) => l.kind === 'part')).toHaveLength(12)
    expect(full.at(-1)).toMatchObject({ kind: 'more', label: '+3 more' })
    const compact = buildHorizonLanes(data, { today: TODAY, compact: true })
    expect(compact.filter((l) => l.kind === 'part')).toHaveLength(6)
    expect(compact.at(-1)?.label).toBe('+9 more')
  })

  it('extends an overdue open PO with a hatched run to its projected arrival', () => {
    const lanes = buildHorizonLanes(
      horizon({
        orders: [
          order('x', {
            status: 'issued',
            open: true,
            lastReceivedAt: null,
            expectedAt: '2026-09-01',
            projectedArrival: '2026-10-08',
          }),
        ],
      }),
      { today: TODAY }
    )
    const po = lanes.find((l) => l.key === 'po:x')
    expect(kinds(po?.marks ?? [])).toEqual(['bar', 'overdue'])
    expect(po?.marks[1]).toMatchObject({ from: dayToT('2026-09-01'), to: dayToT('2026-10-08') })
  })

  it('clamps a past order-by to today and mutes a part that will not make the arrival', () => {
    const lanes = buildHorizonLanes(
      horizon({ parts: [part('p', { orderByDate: '2026-08-01', wontMakeNextArrival: true })] }),
      { today: TODAY }
    )
    const lane = lanes.find((l) => l.kind === 'part')
    expect(lane?.wontMake).toBe(true)
    expect(lane?.marks[0]).toMatchObject({
      kind: 'dumbbell',
      from: dayToT(TODAY),
      to: dayToT('2026-11-10'),
      muted: true,
    })
  })

  it('marks the rhythm date on the Next order lane only when it differs', () => {
    const cycle = { statedDays: 90, rhythmDate: '2026-10-20' }
    const next = { orderDate: '2026-10-05', arrivalDate: '2026-11-01', pulledForwardBy: ['Motor'] }
    const differ = buildHorizonLanes(horizon({ cycle, nextOrder: next }), { today: TODAY })
    expect(kinds(differ.find((l) => l.key === 'next')?.marks ?? [])).toEqual(['next', 'rhythm'])
    const same = buildHorizonLanes(
      horizon({ cycle, nextOrder: { ...next, orderDate: '2026-10-20' } }),
      { today: TODAY }
    )
    expect(kinds(same.find((l) => l.key === 'next')?.marks ?? [])).toEqual(['next'])
  })

  it('drops the Orders lane on mobile and the cycle ticks when compact', () => {
    const data = horizon({
      orders: [order('a')],
      cycle: { statedDays: 30, rhythmDate: '2026-04-30' },
    })
    expect(buildHorizonLanes(data, { today: TODAY, mobile: true })).toEqual([])
    const [compact] = buildHorizonLanes(data, { today: TODAY, compact: true })
    expect(kinds(compact?.marks ?? [])).toEqual(['bar'])
  })
})

describe('cycleTicks', () => {
  it('walks back from the latest order and forward to the rhythm date', () => {
    const ticks = cycleTicks({
      from: '2026-01-01',
      to: '2026-12-31',
      orders: [order('a', { orderedAt: '2026-03-01' }), order('b', { orderedAt: '2026-06-01' })],
      cycle: { statedDays: 60, rhythmDate: '2026-10-01' },
    })
    const start = dayToT('2026-06-01')
    expect(ticks.map((m) => (m.kind === 'tick' ? m.t : null))).toEqual([
      start - 120,
      start - 60,
      start,
      start + 60,
      start + 120,
    ])
  })

  it('is empty without a cycle', () => {
    expect(cycleTicks({ from: '2026-01-01', to: '2026-12-31', orders: [], cycle: null })).toEqual(
      []
    )
  })
})

describe('horizonExtent', () => {
  it('pads the window by half a day', () => {
    expect(horizonExtent({ from: '2026-01-01', to: '2026-01-31' })).toEqual([
      dayToT('2026-01-01') - 0.5,
      dayToT('2026-01-31') + 0.5,
    ])
  })
})

describe('mergeLanes', () => {
  it('keeps the old window marks on shared lanes and drops lanes that left', () => {
    const prev = buildHorizonLanes(horizon({ orders: [order('a')], parts: [part('gone')] }), {
      today: TODAY,
    })
    const next = buildHorizonLanes(horizon({ orders: [order('b', { orderedAt: '2026-05-01' })] }), {
      today: TODAY,
    })
    const merged = mergeLanes(prev, next)
    expect(merged.map((l) => l.key)).toEqual(['orders'])
    expect(merged[0]?.marks.map((m) => m.key)).toEqual(['po:a', 'po:b'])
  })
})
