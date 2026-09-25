// packages/lib/src/mrp/__tests__/scheduled.test.ts

import { describe, expect, it } from 'vitest'
import {
  bridgeQuantity,
  recomputeNextOrder,
  rhythmDate,
  type ScheduledPartInput,
  type ScheduledSupplierInput,
} from '../run/scheduled'
import type { SupplierInput } from '../types'

const TODAY = '2026-09-24'

/** 02 §6.4: Acme, scheduled every 180 days, last PO Apr 20. */
const ACME: SupplierInput = {
  id: 'acme',
  orderMode: 'scheduled',
  orderCycleDays: 180,
  nextOrderDate: null,
  lastIssuedOrderedAt: '2026-04-20',
}

function part(partId: string, onHand: number, adu: number, cushion: number): ScheduledPartInput {
  return {
    partId,
    vendorPartId: `vp-${partId}`,
    leadTimeDays: 60,
    cushion,
    projection: { fromDay: TODAY, onHand, receipts: [], baseAdu: adu, seasonalIndex: null },
    minOrderQty: null,
    purchaseRatio: null,
  }
}

/** Motor: ADU 2, lead time 60, cushion 2 × 60 × 0.25 × 1.5 = 45, 200 on hand. */
const MOTOR = part('motor', 200, 2, 45)
/** Bracket kit: cushion reached Nov 3, so its order-by is Sep 4, already past (04 §4). */
const BRACKET = part('bracket', 55, 1, 15)

const input = (parts: ScheduledPartInput[]): ScheduledSupplierInput => ({
  asOf: TODAY,
  supplier: ACME,
  parts,
})

describe('the Acme container (02 §6.4, 04 §4)', () => {
  it('runs the rhythm from the last PO: Apr 20 + 180 = Oct 17', () => {
    expect(rhythmDate(ACME)).toBe('2026-10-17')
    expect(rhythmDate({ ...ACME, nextOrderDate: '2026-11-01' })).toBe('2026-11-01')
    expect(rhythmDate({ ...ACME, lastIssuedOrderedAt: null })).toBeNull()
  })

  it('motor: cushion Dec 10, order-by Oct 11 pulls the order forward from Oct 17', () => {
    const plan = recomputeNextOrder(input([MOTOR]))
    const motor = plan.parts[0]
    expect(plan.rhythmDate).toBe('2026-10-17')
    expect(plan.nextOrderDate).toBe('2026-10-11')
    expect(plan.pulledForwardBy).toEqual(['motor'])
    expect(motor).toMatchObject({
      cushionDate: '2026-12-10',
      orderByDate: '2026-10-11',
      pullsOrderForward: true,
      wontMakeNextArrival: false,
      nextArrivalDate: '2026-12-10',
      followingArrivalDate: '2027-06-08',
    })
  })

  it('motor quantity: 2 × 180 + 45 − on hand at arrival', () => {
    const motor = recomputeNextOrder(input([MOTOR])).parts[0]
    // The doc writes 45 for on hand at Dec 10 (200 − 2 × 77.5); stock at the start of Dec 10 is 46.
    expect(motor?.projectedOnHandAtNextArrival).toBe(46)
    expect(motor?.rawQuantity).toBe(359)
    // With 199 on hand the cushion is hit exactly on Dec 10 and the doc's 360 falls out.
    const exact = recomputeNextOrder(input([part('motor', 199, 2, 45)])).parts[0]
    expect(exact?.orderByDate).toBe('2026-10-11')
    expect(exact?.rawQuantity).toBe(360)
  })

  it('rounds the quantity to MOQ and packs', () => {
    const packed = recomputeNextOrder(input([{ ...MOTOR, minOrderQty: 100, purchaseRatio: 50 }]))
      .parts[0]
    expect(packed?.quantity).toBe(400)
    expect(packed?.purchaseUnits).toBe(8)
  })

  it('unticking the motor puts the order back on Oct 17', () => {
    const plan = recomputeNextOrder(input([MOTOR]), ['motor'])
    expect(plan.nextOrderDate).toBe('2026-10-17')
    expect(plan.pulledForwardBy).toEqual([])
    expect(plan.parts[0]).toMatchObject({ excluded: true, pullsOrderForward: false })
  })

  it('a past order-by moves the order to today and flags the part', () => {
    const plan = recomputeNextOrder(input([BRACKET, MOTOR]))
    expect(plan.nextOrderDate).toBe(TODAY)
    expect(plan.pulledForwardBy).toEqual(['bracket', 'motor'])
    expect(plan.parts[0]).toMatchObject({ orderByDate: '2026-09-04', wontMakeNextArrival: true })
  })

  it('unticking the bracket kit puts the order on Oct 11 for a Dec 10 arrival', () => {
    const plan = recomputeNextOrder(input([BRACKET, MOTOR]), ['bracket'])
    expect(plan.nextOrderDate).toBe('2026-10-11')
    expect(plan.parts[1]?.nextArrivalDate).toBe('2026-12-10')
    expect(plan.parts[0]?.wontMakeNextArrival).toBe(true)
  })

  it('subtracts other POs landing between the next and following arrival', () => {
    const withPo = {
      ...MOTOR,
      projection: { ...MOTOR.projection, receipts: [{ day: '2027-03-01', quantity: 100 }] },
    }
    // The extra 100 also pushes the cushion date out, so compare at a fixed date.
    const plan = recomputeNextOrder({
      ...input([withPo]),
      supplier: { ...ACME, nextOrderDate: '2026-10-11' },
    })
    expect(plan.parts[0]?.rawQuantity).toBe(259)
  })
})

describe('bridgeQuantity (02 §6.4)', () => {
  it('covers usage from bridge arrival to the container, plus cushion, less stock then', () => {
    const bridge = bridgeQuantity({
      asOf: TODAY,
      bridgeLeadTimeDays: 7,
      containerArrivalDate: '2026-12-10',
      cushion: 15,
      projection: BRACKET.projection,
      minOrderQty: 10,
      purchaseRatio: 10,
    })
    // Oct 1 → Dec 10 is 70 days at 1/day; on hand Oct 1 is 55 − 7 = 48.
    expect(bridge).toEqual({
      bridgeArrivalDate: '2026-10-01',
      rawQuantity: 37,
      quantity: 40,
      purchaseUnits: 4,
    })
  })
})
