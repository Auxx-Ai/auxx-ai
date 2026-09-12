// packages/lib/src/money/orders/__tests__/client.test.ts
//
// The pure half of order fulfillment. Everything here is a total function of
// its arguments, which is what makes "how much of this line is still to ship"
// testable without a fixture - and that question is the whole reason these
// functions exist, because getting it wrong recognises the same revenue twice
// in an entry that balances.

import { describe, expect, it } from 'vitest'
import { toRecordId } from '../../../resources/resource-id'
import type { Fulfillment } from '../../fulfillments/client'
import {
  fulfillmentStatusFor,
  nextFulfillmentSequence,
  type OrderLineRemaining,
  shippedByLine,
  shippedSubtotalMinor,
  shippingStillOwed,
} from '../client'

function shipment(overrides: Partial<Fulfillment> = {}): Fulfillment {
  return {
    id: 'ful_1',
    recordId: toRecordId('fulfillment', 'ful_1'),
    orderId: 'order_1',
    sequence: 1,
    shippedAt: '2026-09-04T12:00:00.000Z',
    status: 'success',
    cancelledAt: null,
    name: 'ORD-0012-F1',
    trackingNumber: null,
    trackingCompany: null,
    trackingUrl: null,
    lines: [
      {
        id: 'ful_line_1',
        recordId: toRecordId('fulfillment_line', 'ful_line_1'),
        lineItemId: 'l1',
        quantity: 2,
        quantityRelieved: null,
      },
    ],
    subtotalMinor: 0,
    totalMinor: 20_000,
    shippingRecognised: false,
    glPosting: 'gp_1',
    docNumber: 'AUXX-FUL-ORD0012F1',
    recordedAt: '2026-09-04T00:00:00.000Z',
    ...overrides,
  }
}

/** One line of a fulfillment, without the `Fulfillment` boilerplate around it. */
function fulfillmentLine(lineItemId: string, quantity: number): Fulfillment['lines'][number] {
  return {
    id: `ful_line_${lineItemId}`,
    recordId: toRecordId('fulfillment_line', `ful_line_${lineItemId}`),
    lineItemId,
    quantity,
    quantityRelieved: null,
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
    lineTaxMinor: null,
    sortOrder: 0,
    ...overrides,
  }
}

describe('shippedSubtotalMinor', () => {
  it('is zero for an order that has shipped nothing, which is the first shipment', () => {
    expect(shippedSubtotalMinor([])).toBe(0)
  })

  it('sums what earlier shipments recognised, before tax and shipping', () => {
    const fulfillments = [
      shipment({ sequence: 1, subtotalMinor: 10_000, totalMinor: 11_000 }),
      shipment({ sequence: 2, subtotalMinor: 5_000, totalMinor: 5_500 }),
    ]
    // The TOTALS carry tax; the allocation basis must not.
    expect(shippedSubtotalMinor(fulfillments)).toBe(15_000)
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
    const fulfillments: Fulfillment[] = []
    const perShipment: number[] = []
    for (let index = 0; index < 3; index++) {
      const prior = shippedSubtotalMinor(fulfillments)
      perShipment.push(allocateThrough(prior + 100) - allocateThrough(prior))
      fulfillments.push(shipment({ sequence: index + 1, subtotalMinor: 100, totalMinor: 100 }))
    }
    expect(perShipment).toEqual([33, 34, 33])
    expect(perShipment.reduce((sum, value) => sum + value, 0)).toBe(100)
  })
})

describe('shippedByLine', () => {
  it('sums a line across every fulfillment', () => {
    const shipped = shippedByLine([
      shipment({ sequence: 1, lines: [fulfillmentLine('l1', 2)] }),
      shipment({ sequence: 2, lines: [fulfillmentLine('l1', 1), fulfillmentLine('l2', 5)] }),
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
    // A reversal story that ever removes a fulfillment must not hand a later
    // shipment a sequence already in the ledger - the claim's unique index
    // would converge it to `already_posted`, a SUCCESS, and the shipment would
    // recognise nothing.
    expect(nextFulfillmentSequence([shipment({ sequence: 1 }), shipment({ sequence: 4 })])).toBe(5)
  })
})

describe('shippingStillOwed', () => {
  it('is true until a fulfillment has actually recognised it', () => {
    expect(shippingStillOwed([])).toBe(true)
    expect(shippingStillOwed([shipment({ shippingRecognised: false })])).toBe(true)
  })

  it('is false once a POSTED fulfillment carried it', () => {
    expect(shippingStillOwed([shipment({ shippingRecognised: true })])).toBe(false)
  })

  it('is still true when the fulfillment that carried it was never posted', () => {
    // A refused post is rolled back by deleting the record outright
    // (`money/orders/fulfill.ts`'s rollback), but a fulfillment that was
    // SUBSEQUENTLY reversed still carries `shippingRecognised: true` with
    // `glPosting: null` - either way, shipping was not actually recognised.
    expect(shippingStillOwed([shipment({ shippingRecognised: true, glPosting: null })])).toBe(true)
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
