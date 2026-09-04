// packages/lib/src/postings/__tests__/build-fulfillment-entry.test.ts
//
// The fulfillment builder is the first thing in this repo that puts revenue on
// the books, so almost every test here is about a number being the RIGHT number
// rather than about the entry balancing - balancing is `buildEntry`'s job and
// it is tested there.
//
// Three properties carry the file:
//
//  1. **The channel table fails CLOSED on two of its four rows.** A default to
//     DTC would put dealer sales in the consumer line, where the entry balances
//     and nothing downstream can see it.
//  2. **A second shipment must not re-recognise the first.** That is what the
//     shipped-lines input and the `includeShipping` flag exist for, and it is
//     asserted by summing two entries against the order total.
//  3. **The COGS leg is dark.** It is written and tested; nothing sets the flag.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import {
  buildFulfillmentEntry,
  CHANNEL_REVENUE_ROLE,
  extendRateToAmount,
  FULFILLMENT_SOURCE_TYPE,
  fulfillmentPeriodKey,
  toAmountMinor,
  toChannelKey,
} from '../build-fulfillment-entry'
import { buildDocNumber } from '../doc-number'

const BASE = {
  orderId: 'order-1',
  orderNumber: 'ORD-0012',
  sequence: 1,
  channel: 'dtc' as string | null,
  currency: 'USD' as string | null,
  ledgerCurrency: 'USD',
  txnDate: '2026-09-04',
  orderSubtotalMinor: 100_000,
  orderTaxTotalMinor: 8_000,
  orderShippingTotalMinor: 1_500,
  includeShipping: true,
}

/** Two lines at $500 and $500 - the whole order, shipped at once. */
const WHOLE_ORDER = [
  { lineId: 'l1', quantity: 1, unitPriceMinor: 50_000 },
  { lineId: 'l2', quantity: 1, unitPriceMinor: 50_000 },
]

function amountFor(
  entry: ReturnType<typeof buildFulfillmentEntry>['entry'],
  role: string
): number | undefined {
  return entry.lines.find((line) => line.accountRole === role)?.amount
}

describe('the channel table', () => {
  it('has exactly four rows, two of which refuse', () => {
    expect(Object.keys(CHANNEL_REVENUE_ROLE).sort()).toEqual(['dealer', 'dtc', 'manual', 'null'])
    expect(CHANNEL_REVENUE_ROLE.manual).toBe('refuse')
    expect(CHANNEL_REVENUE_ROLE.null).toBe('refuse')
  })

  it('normalises an absent or unrecognised channel to the null row', () => {
    expect(toChannelKey(null)).toBe('null')
    expect(toChannelKey(undefined)).toBe('null')
    expect(toChannelKey('  ')).toBe('null')
    expect(toChannelKey('wholesale')).toBe('null')
    expect(toChannelKey('dealer')).toBe('dealer')
  })

  it('books dtc to revenue_dtc and dealer to revenue_dealer', () => {
    const dtc = buildFulfillmentEntry({ ...BASE, shippedLines: WHOLE_ORDER })
    expect(dtc.revenueRole).toBe(ACCOUNT_ROLES.REVENUE_DTC)
    const dealer = buildFulfillmentEntry({
      ...BASE,
      channel: 'dealer',
      shippedLines: WHOLE_ORDER,
    })
    expect(dealer.revenueRole).toBe(ACCOUNT_ROLES.REVENUE_DEALER)
  })

  it.each([
    ['manual', 'manual'],
    [null, 'none'],
  ])('refuses channel %s, naming the order and the channel', (channel, shown) => {
    expect(() =>
      buildFulfillmentEntry({ ...BASE, channel, shippedLines: WHOLE_ORDER })
    ).toThrowError(UnprocessableEntityError)
    try {
      buildFulfillmentEntry({ ...BASE, channel, shippedLines: WHOLE_ORDER })
    } catch (error) {
      expect((error as Error).message).toContain('ORD-0012')
      expect((error as Error).message).toContain(shown)
    }
  })
})

describe('the entry', () => {
  it('debits A/R the total and credits revenue, tax and shipping', () => {
    const built = buildFulfillmentEntry({ ...BASE, shippedLines: WHOLE_ORDER })

    expect(built.subtotalMinor).toBe(100_000)
    expect(built.taxMinor).toBe(8_000)
    expect(built.shippingMinor).toBe(1_500)
    expect(built.totalMinor).toBe(109_500)

    expect(amountFor(built.entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)).toBe(109_500)
    expect(amountFor(built.entry, ACCOUNT_ROLES.REVENUE_DTC)).toBe(100_000)
    expect(amountFor(built.entry, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toBe(8_000)
    expect(amountFor(built.entry, ACCOUNT_ROLES.REVENUE_SHIPPING)).toBe(1_500)
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
    expect(built.entry.postingType).toBe('fulfillment')
  })

  it('sources every line on the order, so the ledger card can find them', () => {
    const built = buildFulfillmentEntry({ ...BASE, shippedLines: WHOLE_ORDER })
    for (const line of built.entry.lines) {
      expect(line.sourceType).toBe(FULFILLMENT_SOURCE_TYPE)
      expect(line.sourceId).toBe('order-1')
    }
  })

  it('drops a zero tax leg rather than posting to an unmapped role', () => {
    const built = buildFulfillmentEntry({
      ...BASE,
      orderTaxTotalMinor: 0,
      orderShippingTotalMinor: 0,
      shippedLines: WHOLE_ORDER,
    })
    expect(amountFor(built.entry, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toBeUndefined()
    expect(amountFor(built.entry, ACCOUNT_ROLES.REVENUE_SHIPPING)).toBeUndefined()
    expect(built.entry.lines).toHaveLength(2)
  })

  it('refuses a currency other than the ledger currency, naming it', () => {
    expect(() =>
      buildFulfillmentEntry({ ...BASE, currency: 'CAD', shippedLines: WHOLE_ORDER })
    ).toThrowError(/CAD/)
  })

  it('treats a blank currency as the ledger currency rather than refusing', () => {
    expect(() =>
      buildFulfillmentEntry({ ...BASE, currency: null, shippedLines: WHOLE_ORDER })
    ).not.toThrow()
  })

  it('refuses an empty shipment and a non-positive quantity', () => {
    expect(() => buildFulfillmentEntry({ ...BASE, shippedLines: [] })).toThrowError(/Nothing was/)
    expect(() =>
      buildFulfillmentEntry({
        ...BASE,
        shippedLines: [{ lineId: 'l1', quantity: 0, unitPriceMinor: 100 }],
      })
    ).toThrowError(/Row 1/)
  })

  it('refuses a shipment worth nothing', () => {
    expect(() =>
      buildFulfillmentEntry({
        ...BASE,
        orderTaxTotalMinor: 0,
        orderShippingTotalMinor: 0,
        includeShipping: false,
        shippedLines: [{ lineId: 'l1', quantity: 2, unitPriceMinor: 0 }],
      })
    ).toThrowError(/worth 0/)
  })
})

describe('partial fulfillment', () => {
  // $500 + $500, 8% tax, $15 shipping. Ship one line, then the other.
  const first = { lineId: 'l1', quantity: 1, unitPriceMinor: 50_000 }
  const second = { lineId: 'l2', quantity: 1, unitPriceMinor: 50_000 }

  it('recognises only what shipped, and shipping only once', () => {
    const one = buildFulfillmentEntry({ ...BASE, sequence: 1, shippedLines: [first] })
    const two = buildFulfillmentEntry({
      ...BASE,
      sequence: 2,
      includeShipping: false,
      shippedLines: [second],
    })

    expect(one.subtotalMinor).toBe(50_000)
    expect(one.taxMinor).toBe(4_000)
    expect(one.shippingMinor).toBe(1_500)
    expect(one.totalMinor).toBe(55_500)

    expect(two.subtotalMinor).toBe(50_000)
    expect(two.taxMinor).toBe(4_000)
    // 🛑 The second entry must not re-recognise the first's shipping.
    expect(two.shippingMinor).toBe(0)
    expect(two.totalMinor).toBe(54_000)

    // The two entries together are the whole order: 100000 + 8000 + 1500.
    expect(one.totalMinor + two.totalMinor).toBe(109_500)
  })

  it('keys each shipment on its own sequence, so the claim cannot merge them', () => {
    const one = buildFulfillmentEntry({ ...BASE, sequence: 1, shippedLines: [first] })
    const two = buildFulfillmentEntry({
      ...BASE,
      sequence: 2,
      includeShipping: false,
      shippedLines: [second],
    })
    expect(one.periodKey).toBe('ORD-0012-F1')
    expect(two.periodKey).toBe('ORD-0012-F2')
    expect(buildDocNumber({ postingType: 'fulfillment', periodKey: one.periodKey })).toBe(
      'AUXX-FUL-ORD0012F1'
    )
  })

  it('allocates tax pro rata when no line carries its own', () => {
    // One of three units at $10, order subtotal $30, tax $2.31 -> 77 cents.
    const built = buildFulfillmentEntry({
      ...BASE,
      orderSubtotalMinor: 3_000,
      orderTaxTotalMinor: 231,
      orderShippingTotalMinor: 0,
      shippedLines: [{ lineId: 'l1', quantity: 1, unitPriceMinor: 1_000 }],
    })
    expect(built.taxBasis).toBe('allocated')
    expect(built.taxMinor).toBe(77)
  })

  it('uses per-line tax only when EVERY shipped line carries one', () => {
    const allKnown = buildFulfillmentEntry({
      ...BASE,
      shippedLines: [
        { ...first, taxMinor: 4_100 },
        { ...second, taxMinor: 3_900 },
      ],
    })
    expect(allKnown.taxBasis).toBe('per_line')
    expect(allKnown.taxMinor).toBe(8_000)

    // Mixing would double-count the line that carried one, so a partial set
    // falls back to the allocation for the WHOLE shipment.
    const mixed = buildFulfillmentEntry({
      ...BASE,
      shippedLines: [{ ...first, taxMinor: 4_100 }, second],
    })
    expect(mixed.taxBasis).toBe('allocated')
    expect(mixed.taxMinor).toBe(8_000)
  })

  it('three equal shipments of a 300 order allocate the whole 100 of tax, not 99', () => {
    // 🛑 The bug this replaces. `round(100 x 100 / 300)` is 33 on every one of
    // the three shipments, they sum to 99, and A/R is a cent short forever with
    // nothing to clear it against. Allocating cumulatively hands the remainder
    // to whichever shipment completes the order.
    const line = (id: string) => ({ lineId: id, quantity: 1, unitPriceMinor: 10_000 })
    const order = {
      ...BASE,
      orderSubtotalMinor: 30_000,
      orderTaxTotalMinor: 10_000,
      orderShippingTotalMinor: 0,
      includeShipping: false,
    }

    const one = buildFulfillmentEntry({
      ...order,
      sequence: 1,
      shippedLines: [line('l1')],
      priorShipmentsSubtotalMinor: 0,
    })
    const two = buildFulfillmentEntry({
      ...order,
      sequence: 2,
      shippedLines: [line('l2')],
      priorShipmentsSubtotalMinor: 10_000,
    })
    const three = buildFulfillmentEntry({
      ...order,
      sequence: 3,
      shippedLines: [line('l3')],
      priorShipmentsSubtotalMinor: 20_000,
    })

    // The remainder lands wherever the running rounding puts it (here on the
    // second shipment) - what matters is that the three sum to the order's tax.
    expect([one.taxMinor, two.taxMinor, three.taxMinor]).toEqual([3_333, 3_334, 3_333])
    expect(one.taxMinor + two.taxMinor + three.taxMinor).toBe(10_000)
    // And the A/R the three entries raise is exactly the order: 30000 + 10000.
    expect(one.totalMinor + two.totalMinor + three.totalMinor).toBe(40_000)
  })

  it('is unchanged for a first or only shipment - prior is zero and the arithmetic is the old one', () => {
    const withDefault = buildFulfillmentEntry({
      ...BASE,
      orderSubtotalMinor: 3_000,
      orderTaxTotalMinor: 231,
      orderShippingTotalMinor: 0,
      shippedLines: [{ lineId: 'l1', quantity: 1, unitPriceMinor: 1_000 }],
    })
    const withExplicitZero = buildFulfillmentEntry({
      ...BASE,
      orderSubtotalMinor: 3_000,
      orderTaxTotalMinor: 231,
      orderShippingTotalMinor: 0,
      shippedLines: [{ lineId: 'l1', quantity: 1, unitPriceMinor: 1_000 }],
      priorShipmentsSubtotalMinor: 0,
    })
    expect(withDefault.taxMinor).toBe(77)
    expect(withExplicitZero.taxMinor).toBe(77)
  })

  it('refuses a fractional prior-shipment subtotal rather than absorbing it', () => {
    expect(() =>
      buildFulfillmentEntry({
        ...BASE,
        shippedLines: [first],
        priorShipmentsSubtotalMinor: 12.5,
      })
    ).toThrowError(UnprocessableEntityError)
  })

  it('allocates zero rather than dividing by a zero order subtotal', () => {
    const built = buildFulfillmentEntry({
      ...BASE,
      orderSubtotalMinor: 0,
      orderTaxTotalMinor: 500,
      shippedLines: WHOLE_ORDER,
    })
    expect(built.taxMinor).toBe(0)
  })
})

describe('the period key', () => {
  it('refuses an order number with no value', () => {
    expect(() => fulfillmentPeriodKey('   ', 1)).toThrowError(/must have a number/)
  })

  it('refuses a sequence below one or fractional', () => {
    expect(() => fulfillmentPeriodKey('ORD-1', 0)).toThrowError(/whole number from 1/)
    expect(() => fulfillmentPeriodKey('ORD-1', 1.5)).toThrowError(/whole number from 1/)
  })

  it('refuses an order number too long to survive a reversal', () => {
    // Compacts to 12, which fits revision 0 and blows up at revision 1 - which
    // is why the check is here rather than in `buildDocNumber`.
    expect(() => fulfillmentPeriodKey('ORDER-2026-0001', 1)).toThrowError(/too long to key/)
  })

  it('accepts a connector-supplied number like Shopify #13919', () => {
    expect(fulfillmentPeriodKey('#13919', 2)).toBe('#13919-F2')
  })

  it('leaves room for a reversal suffix inside the 21-character cap', () => {
    const key = fulfillmentPeriodKey('ORD-0012', 9)
    expect(
      buildDocNumber({ postingType: 'fulfillment', periodKey: key, revision: 1 }).length
    ).toBeLessThanOrEqual(21)
  })
})

describe('the dark COGS leg', () => {
  it('is absent by default', () => {
    const built = buildFulfillmentEntry({ ...BASE, shippedLines: WHOLE_ORDER })
    expect(amountFor(built.entry, ACCOUNT_ROLES.COGS_PRODUCT_COST)).toBeUndefined()
    expect(amountFor(built.entry, ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS)).toBeUndefined()
  })

  it('adds Dr cogs_product_cost / Cr inventory_finished_goods when switched on', () => {
    const built = buildFulfillmentEntry({
      ...BASE,
      shippedLines: WHOLE_ORDER,
      includeCogs: true,
      cogsMinor: 62_000,
    })
    expect(amountFor(built.entry, ACCOUNT_ROLES.COGS_PRODUCT_COST)).toBe(62_000)
    expect(amountFor(built.entry, ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS)).toBe(62_000)
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })

  it('refuses a zero cost rather than shipping goods for free', () => {
    expect(() =>
      buildFulfillmentEntry({
        ...BASE,
        shippedLines: WHOLE_ORDER,
        includeCogs: true,
        cogsMinor: 0,
      })
    ).toThrowError(/nobody priced/)
  })
})

describe('the money conversions', () => {
  it('absorbs a double stored amount back to whole cents', () => {
    expect(toAmountMinor(26_399.999_999_999_996, 'x')).toBe(26_400)
    expect(toAmountMinor(0, 'x')).toBe(0)
    expect(toAmountMinor(null, 'x')).toBe(0)
  })

  it('refuses a genuinely fractional amount rather than absorbing it', () => {
    expect(() => toAmountMinor(1234.5, 'Order X subtotal')).toThrowError(/whole number of cents/)
    expect(() => toAmountMinor(Number.NaN, 'Order X subtotal')).toThrowError(/not a number/)
  })

  it('rounds rate x quantity once, at the boundary', () => {
    // $15.94 per 1,000 screws = 1.594 cents each; 1,500 of them = $23.91.
    expect(extendRateToAmount(1.594, 1_500, 'x')).toBe(2_391)
    expect(() => extendRateToAmount(Number.POSITIVE_INFINITY, 1, 'x')).toThrowError(
      /cannot be extended/
    )
  })
})
