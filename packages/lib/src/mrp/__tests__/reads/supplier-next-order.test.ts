// packages/lib/src/mrp/__tests__/reads/supplier-next-order.test.ts

import { describe, expect, it } from 'vitest'
import type { SupplierRow } from '../../reads/purchase-orders'
import {
  bridgeOptions,
  buildScheduledSupplierInput,
  groupSupplierCards,
} from '../../reads/supplier-next-order'
import { recomputeNextOrder } from '../../run/scheduled'
import type { OpenPoLineInput } from '../../types'
import { item } from '../support/plan-item'

const TODAY = '2026-09-24'
const ACME: SupplierRow = {
  id: 'acme',
  name: 'Acme Motors',
  orderMode: 'scheduled',
  orderCycleDays: 180,
  nextOrderDate: null,
  lastIssuedOrderedAt: '2026-04-20',
}

/** 02 §6.4's motor as the run stored it: ADU 2, lead 60, top of red 45, 199 on hand. */
const MOTOR = item({
  partId: 'motor',
  orderMode: 'scheduled',
  buffered: true,
  topOfRed: 45,
  onHand: 199,
  adu: 2,
  baseAdu: 2,
  leadTimeDays: 60,
  suggestedVendorPartId: 'vp-motor',
  suggestedSupplierId: 'acme',
  nextOrderDate: '2026-10-11',
  nextArrivalDate: '2026-12-10',
  orderByDate: '2026-10-11',
  pullsOrderForward: true,
})

describe('buildScheduledSupplierInput', () => {
  it('rebuilds the Acme example from stored values: Oct 11, 360', () => {
    const input = buildScheduledSupplierInput({
      asOf: TODAY,
      supplier: ACME,
      items: [MOTOR],
      poLines: [],
      vendorParts: new Map([['vp-motor', { minOrderQty: null, purchaseRatio: null }]]),
    })
    const plan = recomputeNextOrder(input)
    expect(plan.nextOrderDate).toBe('2026-10-11')
    expect(plan.parts[0]?.quantity).toBe(360)
  })

  it('takes MOQ and packs from the vendor part, and counts an issued PO landing before the arrival', () => {
    const line: OpenPoLineInput = {
      id: 'l1',
      purchaseOrderId: 'po1',
      partId: 'motor',
      vendorPartId: 'vp-other',
      supplierId: 'other',
      status: 'issued',
      quantityOpen: 100,
      orderedAt: '2026-09-01',
      expectedAt: '2026-10-01',
    }
    const input = buildScheduledSupplierInput({
      asOf: TODAY,
      supplier: ACME,
      items: [MOTOR],
      poLines: [line],
      vendorParts: new Map([['vp-motor', { minOrderQty: 100, purchaseRatio: 50 }]]),
    })
    expect(input.parts[0]).toMatchObject({ cushion: 45, minOrderQty: 100, purchaseRatio: 50 })
    expect(input.parts[0]?.projection.receipts).toEqual([{ day: '2026-10-01', quantity: 100 }])
    // 100 more on hand pushes the cushion date, and so the order-by, 50 days later: the rhythm wins.
    expect(recomputeNextOrder(input).nextOrderDate).toBe('2026-10-17')
  })

  it('an unbuffered item has no cushion and open demand comes off on hand', () => {
    const input = buildScheduledSupplierInput({
      asOf: TODAY,
      supplier: ACME,
      items: [{ ...MOTOR, buffered: false, openDemand: 20 }],
      poLines: [],
      vendorParts: new Map(),
    })
    expect(input.parts[0]?.cushion).toBe(0)
    expect(input.parts[0]?.projection.onHand).toBe(179)
  })
})

describe('bridgeOptions', () => {
  it('prices the other vendor parts of an unticked part up to the container', () => {
    const input = buildScheduledSupplierInput({
      asOf: TODAY,
      supplier: ACME,
      items: [MOTOR],
      poLines: [],
      vendorParts: new Map(),
    })
    const plan = recomputeNextOrder(input, ['motor'])
    const bridges = bridgeOptions({
      asOf: TODAY,
      plan,
      items: [MOTOR],
      poLines: [],
      alternatives: [
        {
          id: 'vp-local',
          partId: 'motor',
          supplierId: 'local',
          vendorSku: null,
          leadTimeDays: 7,
          minOrderQty: 10,
          purchaseRatio: null,
          isPreferred: false,
        },
        {
          id: 'vp-motor',
          partId: 'motor',
          supplierId: 'acme',
          vendorSku: null,
          leadTimeDays: 60,
          minOrderQty: null,
          purchaseRatio: null,
          isPreferred: true,
        },
      ],
      supplierNames: new Map([['local', 'Local Supply']]),
    })
    expect(bridges).toHaveLength(1)
    // Container Oct 17 + 60 = Dec 16; bridge Oct 1. 2 × 76 + 45 − (199 − 14) = 12 → MOQ 10 is below it.
    expect(bridges[0]).toMatchObject({
      vendorPartId: 'vp-local',
      supplierName: 'Local Supply',
      bridgeArrivalDate: '2026-10-01',
      rawQuantity: 12,
      quantity: 12,
    })
  })

  it('offers nothing while every part is ticked', () => {
    const plan = recomputeNextOrder(
      buildScheduledSupplierInput({
        asOf: TODAY,
        supplier: ACME,
        items: [MOTOR],
        poLines: [],
        vendorParts: new Map(),
      })
    )
    expect(
      bridgeOptions({
        asOf: TODAY,
        plan,
        items: [MOTOR],
        poLines: [],
        alternatives: [],
        supplierNames: new Map(),
      })
    ).toEqual([])
  })
})

describe('groupSupplierCards', () => {
  it('groups scheduled items and when-needed purchases by supplier, earliest order first', () => {
    const cards = groupSupplierCards({
      items: [
        MOTOR,
        item({
          partId: 'bracket',
          orderMode: 'scheduled',
          suggestedSupplierId: 'acme',
          nextOrderDate: '2026-10-11',
          orderByDate: '2026-09-04',
          flags: ['wont_make_next_arrival'],
        }),
        item({
          partId: 'steel',
          suggestionKind: 'purchase',
          suggestedSupplierId: 'steelco',
          orderByDate: '2026-09-26',
        }),
        item({ partId: 'idle', suggestedSupplierId: 'steelco' }),
        item({ partId: 'made', suggestionKind: 'build' }),
      ],
      suppliers: new Map([['acme', ACME]]),
      labels: new Map([['motor', { name: 'Motor 400lb', sku: 'M-400' }]]),
      names: new Map([['steelco', 'SteelCo']]),
    })
    expect(cards.map((c) => c.supplierId)).toEqual(['steelco', 'acme'])
    const acme = cards[1]
    expect(acme).toMatchObject({
      name: 'Acme Motors',
      orderMode: 'scheduled',
      rhythmDate: '2026-10-17',
      nextOrderDate: '2026-10-11',
      pulledForwardBy: ['motor'],
    })
    // The part that won't make the arrival is pinned first.
    expect(acme?.parts.map((p) => p.partId)).toEqual(['bracket', 'motor'])
    expect(cards[0]).toMatchObject({
      name: 'SteelCo',
      orderMode: 'when_needed',
      nextOrderDate: '2026-09-26',
    })
    expect(cards[0]?.parts).toHaveLength(1)
  })
})
