// packages/lib/src/mrp/__tests__/reads/supply-history.test.ts

import { describe, expect, it } from 'vitest'
import type { PurchaseOrderLineRow, PurchaseOrderRow } from '../../reads/purchase-orders'
import {
  buildSupplyHistory,
  medianOrderInterval,
  summarizeOpenOnOrder,
} from '../../reads/supply-history'

const ZONE = 'UTC'

const order = (
  id: string,
  orderedAt: string | null,
  expectedAt: string | null,
  status: PurchaseOrderRow['status'] = 'closed'
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
  vendorPartId: string | null = 'vp1',
  quantityReceived = quantityOrdered
): PurchaseOrderLineRow => ({
  id,
  purchaseOrderId,
  partId: 'motor',
  vendorPartId,
  quantityOrdered,
  quantityReceived,
})

const receipt = (lineId: string, day: string, quantity: number) => ({
  movementId: `mv-${lineId}-${day}`,
  purchaseOrderLineId: lineId,
  occurredAt: new Date(`${day}T15:00:00Z`),
  quantity,
})

describe('buildSupplyHistory', () => {
  it('observes each line, excludes backfilled paperwork, and compares with the stated values', () => {
    const orders = new Map([
      ['po1', order('po1', '2026-06-02', '2026-07-12')],
      ['po2', order('po2', '2026-03-09', '2026-04-18')],
      ['po3', order('po3', null, null)],
    ])
    const {
      vendorParts: [supply, ...rest],
      stats,
    } = buildSupplyHistory({
      zone: ZONE,
      vendorParts: [
        {
          id: 'vp1',
          partId: 'motor',
          supplierId: 'acme',
          vendorSku: null,
          leadTimeDays: 40,
          minOrderQty: 50,
          purchaseRatio: null,
          isPreferred: true,
        },
      ],
      lines: [line('l1', 'po1', 200), line('l2', 'po2', 100), line('l3', 'po3', 300)],
      orders,
      receipts: [
        receipt('l1', '2026-07-24', 200),
        // An early 10 % partial counts for fill, not lead time (02 §6.2).
        receipt('l2', '2026-03-20', 10),
        receipt('l2', '2026-04-30', 80),
        receipt('l3', '2026-05-01', 300),
      ],
      partLabels: new Map([['motor', { name: 'Motor 400lb', sku: 'M-400' }]]),
      supplierNames: new Map([['acme', 'Acme Motors']]),
    })
    expect(rest).toEqual([])
    expect(supply).toMatchObject({
      vendorPartId: 'vp1',
      partName: 'Motor 400lb',
      supplierName: 'Acme Motors',
      stated: { leadTimeDays: 40, minOrderQty: 50, isPreferred: true },
      medianLineQuantity: 200,
    })
    expect(supply?.stats).toMatchObject({ count: 2, excluded: 1, medianLeadTimeDays: 52 })
    expect(
      supply?.lines.map((l) => [
        l.purchaseOrderLineId,
        l.observation?.leadTimeDays ?? null,
        l.excludedReason,
      ])
    ).toEqual([
      ['l1', 52, null],
      ['l2', 52, null],
      ['l3', null, 'no_ordered_at'],
    ])
    expect(supply?.lines[1]).toMatchObject({ quantityReceived: 90, lastReceivedAt: '2026-04-30' })
    expect(stats).toEqual(supply?.stats)
  })

  it('keeps a vendor part with no orders, and groups lines naming no vendor part by supplier', () => {
    const { vendorParts: groups } = buildSupplyHistory({
      zone: ZONE,
      vendorParts: [
        {
          id: 'vp2',
          partId: 'motor',
          supplierId: 'local',
          vendorSku: null,
          leadTimeDays: 7,
          minOrderQty: null,
          purchaseRatio: null,
          isPreferred: false,
        },
      ],
      lines: [line('l1', 'po1', 20, null)],
      orders: new Map([['po1', order('po1', '2026-06-02', null)]]),
      receipts: [],
      partLabels: new Map(),
      supplierNames: new Map(),
    })
    expect(
      groups.map((g) => [g.vendorPartId, g.supplierId, g.stats.count, g.lines.length])
    ).toEqual([
      ['vp2', 'local', 0, 0],
      [null, 'acme', 0, 1],
    ])
  })
})

describe('buildSupplyHistory supplier rollup', () => {
  it('summarizes every line across vendor parts, not an average of their stats', () => {
    const { vendorParts, stats } = buildSupplyHistory({
      zone: ZONE,
      vendorParts: [
        {
          id: 'vpA',
          partId: 'motor',
          supplierId: 'acme',
          vendorSku: null,
          leadTimeDays: 10,
          minOrderQty: null,
          purchaseRatio: null,
          isPreferred: true,
        },
      ],
      lines: [
        line('l1', 'po1', 100, 'vpA'),
        line('l2', 'po2', 100, 'vpA'),
        line('l3', 'po3', 100, null),
        line('l4', 'po4', 100, null),
      ],
      orders: new Map([
        ['po1', order('po1', '2026-01-01', '2026-01-11')],
        ['po2', order('po2', '2026-02-01', '2026-02-11')],
        ['po3', order('po3', '2026-03-01', '2026-03-11')],
        ['po4', order('po4', null, null)],
      ]),
      receipts: [
        receipt('l1', '2026-01-11', 100),
        receipt('l2', '2026-02-21', 100),
        receipt('l3', '2026-03-16', 90),
        receipt('l4', '2026-04-01', 100),
      ],
      partLabels: new Map(),
      supplierNames: new Map(),
    })
    expect(vendorParts.map((vp) => [vp.vendorPartId, vp.lines.length, vp.stats.count])).toEqual([
      ['vpA', 2, 2],
      [null, 2, 1],
    ])
    expect(stats).toMatchObject({
      count: 3,
      excluded: 1,
      medianLeadTimeDays: 15,
      onTimeRate: 1 / 3,
      medianLatenessDays: 5,
      avgFill: (1 + 1 + 0.9) / 3,
    })
    expect(stats.p90LeadTimeDays).toBeCloseTo(19)
    expect(stats.p90LatenessDays).toBeCloseTo(9)
  })
})

describe('summarizeOpenOnOrder', () => {
  it('counts issued orders with unreceived lines, their remaining quantity and earliest date', () => {
    const orders = [
      order('po1', '2026-08-01', '2026-10-20', 'issued'),
      order('po2', '2026-08-15', '2026-10-05', 'issued'),
      order('po3', '2026-08-20', '2026-09-30', 'issued'),
      order('po4', '2026-07-01', '2026-08-01', 'closed'),
    ]
    const lines = [
      line('l1', 'po1', 100, 'vp1', 40),
      line('l2', 'po1', 50, 'vp1', 0),
      line('l3', 'po2', 30, 'vp1', 0),
      // Fully received: neither the order nor its earlier date counts.
      line('l4', 'po3', 20, 'vp1', 20),
      line('l5', 'po4', 70, 'vp1', 10),
    ]
    expect(summarizeOpenOnOrder(orders, lines)).toEqual({
      poCount: 2,
      quantity: 140,
      earliestExpectedAt: '2026-10-05',
    })
    expect(summarizeOpenOnOrder([], [])).toEqual({
      poCount: 0,
      quantity: 0,
      earliestExpectedAt: null,
    })
  })
})

describe('medianOrderInterval', () => {
  it('takes the median gap between distinct order days', () => {
    expect(
      medianOrderInterval(['2026-01-01', '2026-07-01', '2026-01-01', null, '2027-01-01'])
    ).toBe(182.5)
    expect(medianOrderInterval(['2026-01-01'])).toBeNull()
  })
})
