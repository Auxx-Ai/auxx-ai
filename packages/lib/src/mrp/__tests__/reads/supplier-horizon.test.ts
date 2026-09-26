// packages/lib/src/mrp/__tests__/reads/supplier-horizon.test.ts

import { describe, expect, it } from 'vitest'
import type { PurchaseOrderLineRow, PurchaseOrderRow } from '../../reads/purchase-orders'
import {
  assembleSupplierHorizon,
  buildHorizonOrders,
  horizonWindow,
  type SupplierHorizonOrder,
} from '../../reads/supplier-horizon'
import type { SupplierCard, SupplierCardPart } from '../../reads/supplier-next-order'
import type { SupplierInput } from '../../types'

const ZONE = 'UTC'
const TODAY = '2026-09-25'

const order = (
  id: string,
  status: 'issued' | 'closed',
  orderedAt: string | null,
  expectedAt: string | null
): PurchaseOrderRow => ({
  id,
  name: id.toUpperCase(),
  createdAt: new Date(`${orderedAt ?? '2026-01-01'}T09:00:00Z`),
  status,
  vendorId: 'acme',
  orderedAt,
  expectedAt,
})

const line = (
  id: string,
  purchaseOrderId: string,
  quantityOrdered: number,
  quantityReceived: number
): PurchaseOrderLineRow => ({
  id,
  purchaseOrderId,
  partId: 'motor',
  vendorPartId: 'vp1',
  quantityOrdered,
  quantityReceived,
})

const receipt = (lineId: string, day: string, quantity: number) => ({
  movementId: `mv-${lineId}-${day}`,
  purchaseOrderLineId: lineId,
  occurredAt: new Date(`${day}T15:00:00Z`),
  quantity,
})

const supplier = (over: Partial<SupplierInput> = {}): SupplierInput => ({
  id: 'acme',
  orderMode: 'when_needed',
  orderCycleDays: null,
  nextOrderDate: null,
  lastIssuedOrderedAt: null,
  ...over,
})

const row = (over: Partial<SupplierHorizonOrder>): SupplierHorizonOrder => ({
  purchaseOrderId: 'po',
  name: 'PO',
  status: 'closed',
  orderedAt: '2026-01-01',
  expectedAt: null,
  lastReceivedAt: null,
  open: false,
  projectedArrival: null,
  quantityOrdered: 10,
  quantityReceived: 10,
  ...over,
})

const cardPart = (partId: string, over: Partial<SupplierCardPart> = {}): SupplierCardPart => ({
  partId,
  name: partId,
  sku: null,
  vendorPartId: null,
  orderByDate: null,
  stockoutDate: null,
  pullsOrderForward: false,
  wontMakeNextArrival: false,
  suggestedQty: null,
  suggestedPurchaseUnits: null,
  nextArrivalDate: null,
  followingArrivalDate: null,
  priority: null,
  ...over,
})

describe('horizonWindow', () => {
  it('ends at today + 90 days, or the later following arrival', () => {
    expect(horizonWindow({ today: TODAY, followingArrivals: [], window: '6m' })).toEqual({
      from: '2026-06-24',
      to: '2026-12-24',
    })
    expect(
      horizonWindow({ today: TODAY, followingArrivals: ['2027-02-10', null], window: '12m' })
    ).toEqual({ from: '2026-02-10', to: '2027-02-10' })
  })

  it('pages back whole windows by offset', () => {
    expect(horizonWindow({ today: TODAY, followingArrivals: [], window: '6m', offset: 2 })).toEqual(
      { from: '2025-06-24', to: '2025-12-24' }
    )
  })
})

describe('buildHorizonOrders', () => {
  it('projects an overdue open PO to today + the median lateness', () => {
    const { orders, medianLatenessDays } = buildHorizonOrders({
      zone: ZONE,
      today: TODAY,
      orders: [
        order('po1', 'closed', '2026-03-01', '2026-04-01'),
        order('po2', 'closed', '2026-05-01', '2026-06-01'),
        order('po3', 'issued', '2026-07-01', '2026-08-01'),
        order('po4', 'issued', null, null),
      ],
      lines: [
        line('l1', 'po1', 10, 10),
        line('l2', 'po2', 10, 10),
        line('l3', 'po3', 20, 5),
        line('l4', 'po4', 5, 0),
      ],
      receipts: [
        receipt('l1', '2026-04-05', 10),
        receipt('l2', '2026-06-07', 10),
        receipt('l3', '2026-08-20', 5),
      ],
    })
    expect(medianLatenessDays).toBe(5)
    expect(orders.map((o) => o.purchaseOrderId)).toEqual(['po1', 'po2', 'po3'])
    expect(orders[2]).toMatchObject({
      open: true,
      lastReceivedAt: '2026-08-20',
      projectedArrival: '2026-09-30',
      quantityOrdered: 20,
      quantityReceived: 5,
    })
    expect(orders[0]).toMatchObject({
      open: false,
      lastReceivedAt: '2026-04-05',
      projectedArrival: null,
    })
  })

  it('projects to today when there is no clean lateness, and not at all when not yet due', () => {
    const { orders } = buildHorizonOrders({
      zone: ZONE,
      today: TODAY,
      orders: [
        order('late', 'issued', '2026-07-01', '2026-08-01'),
        order('due', 'issued', '2026-09-01', '2026-10-15'),
      ],
      lines: [line('a', 'late', 10, 0), line('b', 'due', 10, 0)],
      receipts: [],
    })
    expect(orders.map((o) => o.projectedArrival)).toEqual([TODAY, null])
  })
})

describe('assembleSupplierHorizon', () => {
  it('keeps orders whose span meets the window and flags earlier ones', () => {
    const horizon = assembleSupplierHorizon({
      today: TODAY,
      window: '6m',
      supplier: supplier(),
      orders: [
        row({ purchaseOrderId: 'old', orderedAt: '2025-11-01', lastReceivedAt: '2026-01-10' }),
        row({ purchaseOrderId: 'span', orderedAt: '2026-05-01', lastReceivedAt: '2026-07-02' }),
        row({
          purchaseOrderId: 'open',
          status: 'issued',
          orderedAt: '2026-04-01',
          expectedAt: '2026-05-01',
          open: true,
        }),
      ],
      run: null,
      card: null,
    })
    expect(horizon.from).toBe('2026-06-24')
    expect(horizon.hasEarlier).toBe(true)
    expect(horizon.orders.map((o) => o.purchaseOrderId)).toEqual(['span', 'open'])
  })

  it('returns the past lanes with no run and the cycle from the supplier', () => {
    const horizon = assembleSupplierHorizon({
      today: TODAY,
      window: '12m',
      supplier: supplier({
        orderMode: 'scheduled',
        orderCycleDays: 90,
        lastIssuedOrderedAt: '2026-07-01',
      }),
      orders: [row({ orderedAt: '2026-07-01', lastReceivedAt: '2026-08-01' })],
      run: null,
      card: null,
    })
    expect(horizon).toMatchObject({
      runAsOf: null,
      nextOrder: null,
      parts: [],
      cycle: { statedDays: 90, rhythmDate: '2026-09-29' },
    })
    expect(horizon.orders).toHaveLength(1)
  })

  it('takes the next order and parts from the run card, order-by first', () => {
    const card: SupplierCard = {
      supplierId: 'acme',
      name: 'Acme',
      orderMode: 'when_needed',
      orderCycleDays: null,
      rhythmDate: null,
      nextOrderDate: '2026-10-01',
      nextArrivalDate: '2026-11-10',
      pulledForwardBy: ['motor'],
      parts: [
        cardPart('bracket', { wontMakeNextArrival: true }),
        cardPart('frame', { orderByDate: '2026-10-20', followingArrivalDate: '2027-03-01' }),
        cardPart('motor', { orderByDate: '2026-10-01', pullsOrderForward: true }),
      ],
    }
    const horizon = assembleSupplierHorizon({
      today: TODAY,
      window: '6m',
      supplier: supplier(),
      orders: [],
      run: { asOfDay: '2026-09-24' },
      card,
    })
    expect(horizon.runAsOf).toBe('2026-09-24')
    expect(horizon.to).toBe('2027-03-01')
    expect(horizon.cycle).toBeNull()
    expect(horizon.nextOrder).toEqual({
      orderDate: '2026-10-01',
      arrivalDate: '2026-11-10',
      pulledForwardBy: ['motor'],
    })
    expect(horizon.parts.map((p) => p.partId)).toEqual(['motor', 'frame', 'bracket'])
    expect(horizon.parts[0]).not.toHaveProperty('followingArrivalDate')
  })
})
