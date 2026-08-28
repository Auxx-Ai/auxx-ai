// packages/lib/src/purchasing/__tests__/purchase-order-status.test.ts
//
// The classifier is pure, so every rule in
// plans/purchasing/07-purchase-order-send-and-status.md §3.3 is testable here
// without a single mock. The writer's tests cover the database half.

import { describe, expect, it } from 'vitest'
import {
  derivePurchaseOrderStatuses,
  type PurchaseOrderLineQuantities,
} from '../purchase-order-status'

/** A line, defaulting to "ordered 10, nothing happened yet". */
function line(overrides: Partial<PurchaseOrderLineQuantities> = {}): PurchaseOrderLineQuantities {
  return { quantityOrdered: 10, quantityReceived: 0, quantityBilled: 0, ...overrides }
}

describe('derivePurchaseOrderStatuses — the nine combinations', () => {
  // The two axes are independent, so the exhaustive table is receipt x billing.
  const NOTHING = 0
  const SOME = 4
  const ALL = 10

  const cases: Array<{
    received: number
    billed: number
    receiptStatus: string
    billingStatus: string
  }> = [
    {
      received: NOTHING,
      billed: NOTHING,
      receiptStatus: 'not_received',
      billingStatus: 'not_billed',
    },
    {
      received: NOTHING,
      billed: SOME,
      receiptStatus: 'not_received',
      billingStatus: 'partially_billed',
    },
    { received: NOTHING, billed: ALL, receiptStatus: 'not_received', billingStatus: 'billed' },
    {
      received: SOME,
      billed: NOTHING,
      receiptStatus: 'partially_received',
      billingStatus: 'not_billed',
    },
    {
      received: SOME,
      billed: SOME,
      receiptStatus: 'partially_received',
      billingStatus: 'partially_billed',
    },
    { received: SOME, billed: ALL, receiptStatus: 'partially_received', billingStatus: 'billed' },
    { received: ALL, billed: NOTHING, receiptStatus: 'received', billingStatus: 'not_billed' },
    { received: ALL, billed: SOME, receiptStatus: 'received', billingStatus: 'partially_billed' },
    { received: ALL, billed: ALL, receiptStatus: 'received', billingStatus: 'billed' },
  ]

  for (const c of cases) {
    it(`received ${c.received}/10, billed ${c.billed}/10 -> ${c.receiptStatus} + ${c.billingStatus}`, () => {
      expect(
        derivePurchaseOrderStatuses([
          line({ quantityReceived: c.received, quantityBilled: c.billed }),
        ])
      ).toEqual({ receiptStatus: c.receiptStatus, billingStatus: c.billingStatus })
    })
  }

  it('is the prepayment case that one enum could not express: fully billed, nothing received', () => {
    expect(
      derivePurchaseOrderStatuses([line({ quantityReceived: 0, quantityBilled: 10 })])
    ).toEqual({ receiptStatus: 'not_received', billingStatus: 'billed' })
  })
})

describe('derivePurchaseOrderStatuses — over-receipt and over-billing', () => {
  it('calls an over-received line `received`, not `partially_received`', () => {
    // A vendor shipping 105 against an order for 100 is a real, ordinary event.
    // An `===` completion test would report this order as partial forever.
    expect(
      derivePurchaseOrderStatuses([line({ quantityOrdered: 100, quantityReceived: 105 })])
        .receiptStatus
    ).toBe('received')
  })

  it('calls an over-billed line `billed`', () => {
    expect(
      derivePurchaseOrderStatuses([line({ quantityOrdered: 100, quantityBilled: 101 })])
        .billingStatus
    ).toBe('billed')
  })

  it('does not let one over-received line complete an order another line is short on', () => {
    expect(
      derivePurchaseOrderStatuses([
        line({ quantityOrdered: 10, quantityReceived: 50 }),
        line({ quantityOrdered: 10, quantityReceived: 1 }),
      ]).receiptStatus
    ).toBe('partially_received')
  })
})

describe('derivePurchaseOrderStatuses — multiple lines', () => {
  it('needs EVERY line satisfied before it says received', () => {
    expect(
      derivePurchaseOrderStatuses([
        line({ quantityReceived: 10 }),
        line({ quantityReceived: 10 }),
        line({ quantityReceived: 9 }),
      ]).receiptStatus
    ).toBe('partially_received')
  })

  it('needs only ONE line with progress before it says partially received', () => {
    expect(
      derivePurchaseOrderStatuses([
        line({ quantityReceived: 0 }),
        line({ quantityReceived: 0 }),
        line({ quantityReceived: 1 }),
      ]).receiptStatus
    ).toBe('partially_received')
  })

  it('moves the two axes independently across lines', () => {
    expect(
      derivePurchaseOrderStatuses([
        line({ quantityReceived: 10, quantityBilled: 0 }),
        line({ quantityReceived: 10, quantityBilled: 3 }),
      ])
    ).toEqual({ receiptStatus: 'received', billingStatus: 'partially_billed' })
  })
})

describe('derivePurchaseOrderStatuses — the edges', () => {
  it('returns not_received / not_billed for an order with ZERO lines', () => {
    // `every` over an empty list is vacuously true. Without the explicit guard a
    // purchase order nobody has typed a line into yet would read as fully
    // received and fully billed, then flip BACKWARDS on the first line.
    expect(derivePurchaseOrderStatuses([])).toEqual({
      receiptStatus: 'not_received',
      billingStatus: 'not_billed',
    })
  })

  it('treats a line ordered=0 as satisfied — nothing was ordered, nothing is outstanding', () => {
    expect(
      derivePurchaseOrderStatuses([line({ quantityOrdered: 0, quantityReceived: 0 })])
    ).toEqual({ receiptStatus: 'received', billingStatus: 'billed' })
  })

  it('does not let an ordered=0 line hold an otherwise complete order open', () => {
    expect(
      derivePurchaseOrderStatuses([
        line({ quantityOrdered: 10, quantityReceived: 10 }),
        line({ quantityOrdered: 0, quantityReceived: 0 }),
      ]).receiptStatus
    ).toBe('received')
  })

  it('does not let an ordered=0 line complete an order that is still short elsewhere', () => {
    expect(
      derivePurchaseOrderStatuses([
        line({ quantityOrdered: 10, quantityReceived: 0 }),
        line({ quantityOrdered: 0, quantityReceived: 0 }),
      ]).receiptStatus
    ).toBe('not_received')
  })

  it('reads a net-zero line as not_received, not partially_received', () => {
    // A receipt fully reversed by a return sums back to 0. Nothing is there.
    expect(
      derivePurchaseOrderStatuses([line({ quantityOrdered: 10, quantityReceived: 0 })])
        .receiptStatus
    ).toBe('not_received')
  })

  it('reads a net-negative line as not_received', () => {
    expect(
      derivePurchaseOrderStatuses([line({ quantityOrdered: 10, quantityReceived: -2 })])
        .receiptStatus
    ).toBe('not_received')
  })

  it('is total — the same lines always give the same answer', () => {
    const lines = [line({ quantityReceived: 4 }), line({ quantityBilled: 10 })]
    expect(derivePurchaseOrderStatuses(lines)).toEqual(derivePurchaseOrderStatuses(lines))
  })
})
