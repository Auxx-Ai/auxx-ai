// packages/lib/src/postings/__tests__/build-fulfillment-entry.test.ts
//
// The fulfillment builder is the first thing in this repo that puts revenue on
// the books, so almost every test here is about a number being the RIGHT number
// rather than about the entry balancing - balancing is `buildEntry`'s job and
// it is tested there.
//
// Three properties carry the file:
//
//  1. **The channel table fails OPEN on two of its four rows.** It used to fail
//     closed, on the argument that a default to DTC hides dealer sales in the
//     consumer line. 49 §8.4 decision 5 reversed it: `order_channel` is
//     human-set and unbound, so the refusal recognised no imported revenue at
//     all, and unrecognised revenue is the less visible of the two errors.
//     Since brief 13 §5, the channel is a `dimensions.channel` value on the
//     ONE `revenue_product` line, never a second account.
//  2. **A second shipment must not re-recognise the first.** That is what the
//     shipped-lines input and the `includeShipping` flag exist for, and it is
//     asserted by summing two entries against the order total.
//  3. **The COGS leg is dark.** It is written and tested; nothing sets the flag.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import {
  buildFulfillmentEntry,
  CHANNEL_KEYS,
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

/** The amount on the revenue_product line carrying `{ channel: value }`. */
function channelAmountFor(
  entry: ReturnType<typeof buildFulfillmentEntry>['entry'],
  value: string
): number | undefined {
  return entry.lines.find(
    (line) =>
      line.accountRole === ACCOUNT_ROLES.REVENUE_PRODUCT && line.dimensions?.channel === value
  )?.amount
}

/** Every jurisdiction dimension the sales_tax_payable lines carry, in order. */
function jurisdictionLines(
  entry: ReturnType<typeof buildFulfillmentEntry>['entry']
): Array<{ jurisdiction: string | undefined; amount: number }> {
  return entry.lines
    .filter((line) => line.accountRole === ACCOUNT_ROLES.SALES_TAX_PAYABLE)
    .map((line) => ({ jurisdiction: line.dimensions?.jurisdiction, amount: line.amount }))
}

describe('the channel keyspace', () => {
  it('has exactly four rows and every dimension value is dtc or dealer', () => {
    expect(Object.keys(CHANNEL_KEYS).sort()).toEqual(['dealer', 'dtc', 'manual', 'null'])
    // ⤵️ Both used to be 'refuse'. 49 §8.4 decision 5: `order_channel` is
    // human-set and no connector binds it, so the refusal did not protect the
    // DTC/dealer split - it refused every imported order and recognised nothing.
    expect(CHANNEL_KEYS.manual).toBe('dtc')
    expect(CHANNEL_KEYS.null).toBe('dtc')
    expect(Object.values(CHANNEL_KEYS)).not.toContain('refuse')
  })

  it('normalises an absent or unrecognised channel to the null row', () => {
    expect(toChannelKey(null)).toBe('null')
    expect(toChannelKey(undefined)).toBe('null')
    expect(toChannelKey('  ')).toBe('null')
    expect(toChannelKey('wholesale')).toBe('null')
    expect(toChannelKey('dealer')).toBe('dealer')
  })

  it('books dtc and dealer onto the SAME revenue_product role, dimensioned by channel', () => {
    const dtc = buildFulfillmentEntry({ ...BASE, shippedLines: WHOLE_ORDER })
    expect(dtc.revenueRole).toBe(ACCOUNT_ROLES.REVENUE_PRODUCT)
    expect(dtc.channelDimension).toBe('dtc')
    const dealer = buildFulfillmentEntry({
      ...BASE,
      channel: 'dealer',
      shippedLines: WHOLE_ORDER,
    })
    expect(dealer.revenueRole).toBe(ACCOUNT_ROLES.REVENUE_PRODUCT)
    expect(dealer.channelDimension).toBe('dealer')
    // One role total, exactly two accounts is what this unit set out to undo.
    expect(
      dtc.entry.lines.filter((l) => l.accountRole === ACCOUNT_ROLES.REVENUE_PRODUCT)
    ).toHaveLength(1)
  })

  it.each([
    ['manual'],
    [null],
    ['wholesale'],
    ['  '],
  ])('books channel %s to consumer revenue rather than refusing it', (channel) => {
    const built = buildFulfillmentEntry({ ...BASE, channel, shippedLines: WHOLE_ORDER })
    expect(built.channelDimension).toBe('dtc')
    // The whole subtotal reaches 4000. The point of failing open is that the
    // revenue is ON the books, in a line a person can move, not missing.
    expect(channelAmountFor(built.entry, 'dtc')).toBe(100_000)
  })

  it('still books an explicit dealer order to the dealer dimension', () => {
    // Failing open must not collapse the split it was protecting: the moment a
    // person says `dealer`, the default stops being reached.
    const built = buildFulfillmentEntry({ ...BASE, channel: 'dealer', shippedLines: WHOLE_ORDER })
    expect(built.channelDimension).toBe('dealer')
    expect(channelAmountFor(built.entry, 'dtc')).toBeUndefined()
    expect(channelAmountFor(built.entry, 'dealer')).toBe(100_000)
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
    expect(amountFor(built.entry, ACCOUNT_ROLES.REVENUE_PRODUCT)).toBe(100_000)
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

describe('the counterparty (brief 13 §1.2)', () => {
  it('carries the order contact on the receivable line only', () => {
    const built = buildFulfillmentEntry({
      ...BASE,
      shippedLines: WHOLE_ORDER,
      contactInstanceId: 'ei_contact_1',
    })
    const receivable = built.entry.lines.find(
      (line) => line.accountRole === ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE
    )
    expect(receivable).toMatchObject({
      counterpartyType: 'customer',
      counterpartyId: 'ei_contact_1',
    })
    const revenue = built.entry.lines.find(
      (line) => line.accountRole === ACCOUNT_ROLES.REVENUE_PRODUCT
    )
    expect(revenue?.counterpartyId).toBeUndefined()
  })

  it('posts fine with no contact - the export refuses, not the ledger', () => {
    const built = buildFulfillmentEntry({ ...BASE, shippedLines: WHOLE_ORDER })
    const receivable = built.entry.lines.find(
      (line) => line.accountRole === ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE
    )
    expect(receivable?.counterpartyId).toBeUndefined()
  })
})

describe('the jurisdiction split (brief 13 §5)', () => {
  const TAX_LINES = [
    { title: 'CA State Tax', priceMinor: 6_000 },
    { title: 'CA District Tax', priceMinor: 2_000 },
  ]

  it('splits the tax credit across jurisdictions when the tax lines tie to the order total', () => {
    const built = buildFulfillmentEntry({ ...BASE, shippedLines: WHOLE_ORDER, taxLines: TAX_LINES })
    const lines = jurisdictionLines(built.entry)
    expect(lines).toEqual(
      expect.arrayContaining([
        { jurisdiction: 'CA State Tax', amount: 6_000 },
        { jurisdiction: 'CA District Tax', amount: 2_000 },
      ])
    )
    expect(lines).toHaveLength(2)
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(8_000)
  })

  it('falls back to one undimensioned line when the tax lines do not tie to the order total', () => {
    // A partial breakdown reads as a complete one - see split-tax-by-jurisdiction.ts.
    const built = buildFulfillmentEntry({
      ...BASE,
      shippedLines: WHOLE_ORDER,
      taxLines: [{ title: 'CA State Tax', priceMinor: 5_000 }],
    })
    expect(jurisdictionLines(built.entry)).toEqual([{ jurisdiction: undefined, amount: 8_000 }])
  })

  it('falls back to one undimensioned line when there are no tax lines at all', () => {
    const built = buildFulfillmentEntry({ ...BASE, shippedLines: WHOLE_ORDER })
    expect(jurisdictionLines(built.entry)).toEqual([{ jurisdiction: undefined, amount: 8_000 }])
  })

  it('splits THIS shipment tax pro rata to the tax lines, with largest-remainder rounding', () => {
    // Order-level weights (A:B = 77:154 = 1:2) applied to this shipment's own
    // $0.77 of tax, not to the order's $2.31 - a `tax_line` has no per-shipment
    // granularity of its own (brief 13 §5.3).
    const built = buildFulfillmentEntry({
      ...BASE,
      orderSubtotalMinor: 3_000,
      orderTaxTotalMinor: 231,
      orderShippingTotalMinor: 0,
      shippedLines: [{ lineId: 'l1', quantity: 1, unitPriceMinor: 1_000 }],
      taxLines: [
        { title: 'A', priceMinor: 77 },
        { title: 'B', priceMinor: 154 },
      ],
    })
    expect(built.taxMinor).toBe(77)
    expect(jurisdictionLines(built.entry)).toEqual(
      expect.arrayContaining([
        { jurisdiction: 'A', amount: 26 },
        { jurisdiction: 'B', amount: 51 },
      ])
    )
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
