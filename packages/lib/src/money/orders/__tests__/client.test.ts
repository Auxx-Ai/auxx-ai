// packages/lib/src/money/orders/__tests__/client.test.ts
//
// The pure half of the shipment log. Everything here is a total function of its
// arguments, which is what makes "how much of this line is still to ship"
// testable without a fixture - and that question is the whole reason the log
// exists, because getting it wrong recognises the same revenue twice in an
// entry that balances.

import { describe, expect, it } from 'vitest'
import {
  fulfillmentStatusFor,
  nextFulfillmentSequence,
  type OrderFulfillment,
  type OrderLineRemaining,
  shippedByLine,
  shippedSubtotalMinor,
  shippingStillOwed,
} from '../client'

function shipment(overrides: Partial<OrderFulfillment> = {}): OrderFulfillment {
  return {
    sequence: 1,
    shippedAt: '2026-09-04',
    lines: [{ lineId: 'l1', quantity: 2 }],
    totalMinor: 20_000,
    shippingRecognised: false,
    glPostingId: 'gp_1',
    docNumber: 'AUXX-FUL-ORD0012F1',
    recordedAt: '2026-09-04T00:00:00.000Z',
    ...overrides,
  }
}

function line(overrides: Partial<OrderLineRemaining> = {}): OrderLineRemaining {
  return {
    lineId: 'l1',
    name: 'Widget',
    quantity: 4,
    shippedQuantity: 0,
    remainingQuantity: 4,
    unitPriceMinor: 10_000,
    sortOrder: 0,
    ...overrides,
  }
}

describe('shippedSubtotalMinor', () => {
  it('is zero for an empty log, which is the first shipment', () => {
    expect(shippedSubtotalMinor([])).toBe(0)
  })

  it('sums what earlier shipments recognised, before tax and shipping', () => {
    const log = [
      shipment({ sequence: 1, subtotalMinor: 10_000, totalMinor: 11_000 }),
      shipment({ sequence: 2, subtotalMinor: 5_000, totalMinor: 5_500 }),
    ]
    // The TOTALS carry tax; the allocation basis must not.
    expect(shippedSubtotalMinor(log)).toBe(15_000)
  })

  it('counts a row written before the field existed as zero, never as its total', () => {
    // A legacy row contributes nothing rather than having a subtotal invented
    // for it out of a total that includes tax it never allocated.
    const legacy = shipment({ sequence: 1, totalMinor: 11_000 })
    expect(legacy.subtotalMinor).toBeUndefined()
    expect(shippedSubtotalMinor([legacy])).toBe(0)
  })

  it('is what makes three equal shipments allocate the whole tax', () => {
    // A 300 order with 100 tax, shipped in three 100s. Allocating each shipment
    // on its own gives 33 + 33 + 33 = 99 and leaves A/R a cent short forever.
    //
    // The cumulative basis this function feeds gives 33 + 34 + 33. Note the
    // remainder lands on the MIDDLE shipment, not the last: it falls wherever
    // the running rounding puts it. That is fine and is the point. The property
    // being asserted is that the parts SUM to the whole, not that any
    // particular shipment carries the odd cent.
    const allocateThrough = (through: number) => Math.round((100 * through) / 300)
    const log: OrderFulfillment[] = []
    const perShipment: number[] = []
    for (let index = 0; index < 3; index++) {
      const prior = shippedSubtotalMinor(log)
      perShipment.push(allocateThrough(prior + 100) - allocateThrough(prior))
      log.push(shipment({ sequence: index + 1, subtotalMinor: 100, totalMinor: 100 }))
    }
    expect(perShipment).toEqual([33, 34, 33])
    expect(perShipment.reduce((sum, value) => sum + value, 0)).toBe(100)
  })
})

describe('shippedByLine', () => {
  it('sums a line across every shipment', () => {
    const shipped = shippedByLine([
      shipment({ sequence: 1, lines: [{ lineId: 'l1', quantity: 2 }] }),
      shipment({
        sequence: 2,
        lines: [
          { lineId: 'l1', quantity: 1 },
          { lineId: 'l2', quantity: 5 },
        ],
      }),
    ])
    expect(shipped.get('l1')).toBe(3)
    expect(shipped.get('l2')).toBe(5)
    expect(shipped.get('l3')).toBeUndefined()
  })

  it('is empty for an order that has shipped nothing', () => {
    expect(shippedByLine([]).size).toBe(0)
  })
})

describe('nextFulfillmentSequence', () => {
  it('starts at 1', () => {
    expect(nextFulfillmentSequence([])).toBe(1)
  })

  it('takes max + 1, not length + 1', () => {
    // The claim's unique index is on `(org, type, periodKey, revision)`. If a
    // removed entry let a later shipment reuse a sequence already in the ledger,
    // the claim would converge it to `already_posted` - a SUCCESS - and the
    // shipment would recognise nothing.
    expect(nextFulfillmentSequence([shipment({ sequence: 1 }), shipment({ sequence: 4 })])).toBe(5)
  })
})

describe('shippingStillOwed', () => {
  it('is true until a shipment has actually recognised it', () => {
    expect(shippingStillOwed([])).toBe(true)
    expect(shippingStillOwed([shipment({ shippingRecognised: false })])).toBe(true)
  })

  it('is false once a POSTED shipment carried it', () => {
    expect(shippingStillOwed([shipment({ shippingRecognised: true })])).toBe(false)
  })

  it('is still true when the shipment that carried it was never posted', () => {
    // A refused post rolls the shipment back with `glPostingId: null`, so it did
    // not recognise the shipping and the next one must.
    expect(shippingStillOwed([shipment({ shippingRecognised: true, glPostingId: null })])).toBe(
      true
    )
  })
})

describe('fulfillmentStatusFor', () => {
  it('is fulfilled only when nothing remains on any line', () => {
    expect(fulfillmentStatusFor([line({ remainingQuantity: 0 })])).toBe('fulfilled')
    expect(fulfillmentStatusFor([line({ remainingQuantity: 0 }), line({ lineId: 'l2' })])).toBe(
      'partial'
    )
  })

  it('treats an order with no lines as fulfilled rather than stuck', () => {
    expect(fulfillmentStatusFor([])).toBe('fulfilled')
  })
})
