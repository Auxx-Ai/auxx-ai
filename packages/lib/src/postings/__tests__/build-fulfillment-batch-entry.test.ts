// packages/lib/src/postings/__tests__/build-fulfillment-batch-entry.test.ts
//
// The batch builder turns a day of shipments into ONE posting, so the things
// that can go wrong here are different from the single-order builder's:
//
//  1. **The debit fork.** A Shopify order was paid at checkout. Debiting
//     `accounts_receivable` for it fills aging with money nobody owes and
//     leaves `clearing_card` permanently negative once a payout drains it -
//     and every one of those entries balances. So the fork gets a table test
//     covering every rule, including the two that EXCLUDE.
//  2. **Balance by construction.** Debits are each shipment's total and
//     credits are the same numbers decomposed, so a mixed group (card, Affirm,
//     terms across two orders, a tax-exempt order and a split shipment) must
//     balance without `buildEntry` having anything to say about it.
//  3. **The keyspace.** A day key claims its day once; a late order backfilled
//     into a posted day needs the attempt suffix, and the whole budget is one
//     character wide.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import type {
  FulfillmentDebitRole,
  FulfillmentPostingGroup,
  PlannedShipment,
  UnpostedShipment,
} from '../../money/fulfillment-posting/types'
import { FULFILLMENT_BATCH_SOURCE_TYPE } from '../../money/fulfillment-posting/types'
import { ACCOUNT_ROLES } from '../build-entry'
import {
  buildFulfillmentBatchEntry,
  computeShipmentAmounts,
  FULFILLMENT_DEBIT_ACCOUNT_ROLE,
  FULFILLMENT_GATEWAY_DEBIT,
  type FulfillmentBatchSource,
  type FulfillmentGatewayRoute,
  fulfillmentBatchPeriodKey,
  MAX_COMPACT_FULFILLMENT_BATCH_KEY,
  MAX_FULFILLMENT_BATCH_ATTEMPT,
  resolveFulfillmentDebit,
} from '../build-fulfillment-batch-entry'
import { FULFILLMENT_SOURCE_TYPE } from '../build-fulfillment-entry'
import { buildDocNumber, DOC_NUMBER_MAX_LENGTH } from '../doc-number'

// ── Fixtures ────────────────────────────────────────────────────────────────

let nextOrder = 0

/** One unposted shipment, paid by card unless the test says otherwise. */
function shipment(overrides: Partial<UnpostedShipment> = {}): UnpostedShipment {
  nextOrder += 1
  const number = overrides.orderNumber ?? `#${1000 + nextOrder}`
  const orderId = overrides.orderId ?? `order-${nextOrder}`
  return {
    orderId,
    orderNumber: number,
    fulfillmentInstanceId: overrides.fulfillmentInstanceId ?? `${orderId}-f1`,
    sequence: 1,
    shippedAt: '2026-07-06',
    lines: [
      { lineId: 'l1', quantity: 1, unitPriceMinor: 10_000, lineTaxMinor: null, orderedQuantity: 1 },
    ],
    channel: 'dtc',
    currency: 'USD',
    financialStatus: 'paid',
    gateways: ['shopify_payments'],
    orderSubtotalMinor: 10_000,
    orderTaxTotalMinor: 800,
    orderShippingTotalMinor: 1_500,
    priorShipmentsSubtotalMinor: 0,
    includeShipping: true,
    contactId: 'contact-1',
    taxLines: [],
    ...overrides,
  }
}

/** What `plan.ts` hands the builder: a shipment with its amounts already on it. */
function planned(
  overrides: Partial<UnpostedShipment> = {},
  gatewayRoutes: readonly FulfillmentGatewayRoute[] = []
): PlannedShipment {
  const base = shipment(overrides)
  const debit = resolveFulfillmentDebit({ ...base, gatewayRoutes })
  if (debit.kind !== 'debit') throw new Error(`fixture excluded: ${debit.reason}`)
  const { kind: _kind, ...rest } = debit
  return { ...base, amounts: computeShipmentAmounts(base, rest) }
}

/** Total a group the way the plan does, so the builder gets a realistic input. */
function group(shipments: PlannedShipment[], groupKey = '2026-07-06'): FulfillmentPostingGroup {
  const byDebitRole: Record<FulfillmentDebitRole, number> = {
    clearing_card: 0,
    accounts_receivable: 0,
    gateway: 0,
  }
  let subtotalMinor = 0
  let taxMinor = 0
  let shippingMinor = 0
  let totalMinor = 0
  for (const item of shipments) {
    byDebitRole[item.amounts.debitRole] += item.amounts.totalMinor
    subtotalMinor += item.amounts.subtotalMinor
    taxMinor += item.amounts.taxMinor
    shippingMinor += item.amounts.shippingMinor
    totalMinor += item.amounts.totalMinor
  }
  return {
    groupKey,
    txnDate: shipments.reduce(
      (latest, s) => (s.shippedAt > latest ? s.shippedAt : latest),
      groupKey
    ),
    shipments,
    orderCount: new Set(shipments.map((s) => s.orderId)).size,
    totals: { subtotalMinor, taxMinor, shippingMinor, totalMinor, byDebitRole },
  }
}

type Entry = ReturnType<typeof buildFulfillmentBatchEntry>['entry']

function linesFor(entry: Entry, role: string) {
  return entry.lines.filter((line) => line.accountRole === role)
}

function amountFor(entry: Entry, role: string): number | undefined {
  const found = linesFor(entry, role)
  return found.length === 0 ? undefined : found.reduce((sum, line) => sum + line.amount, 0)
}

/** Σ of the lines debiting one `gl_account` id directly - a `payment_gateway` route. */
function amountForAccount(entry: Entry, glAccountId: string): number | undefined {
  const found = entry.lines.filter((line) => line.glAccountId === glAccountId)
  return found.length === 0 ? undefined : found.reduce((sum, line) => sum + line.amount, 0)
}

/** The amount on the one `role` line carrying `{ [dimension]: value }` - brief 13 §5. */
function dimensionAmountFor(
  entry: Entry,
  role: string,
  dimension: string,
  value: string
): number | undefined {
  return linesFor(entry, role).find((line) => line.dimensions?.[dimension] === value)?.amount
}

/** A `payment_gateway` record's clearing account, as an id the fixtures share. */
const AFFIRM_ACCOUNT = 'acct_gw_affirm'

// ── 1. The debit fork ───────────────────────────────────────────────────────

describe('resolveFulfillmentDebit', () => {
  it.each([
    // [financialStatus, gateways, expected role]
    ['paid', ['shopify_payments'], 'clearing_card'],
    // 🛑 `affirm` with NO `payment_gateway` route is card money now. It had a
    // role of its own until 2026-09-10; a role may not name a vendor, so the
    // answer moved to a record and the fallback is the ordinary one. This is
    // the residual `1200` carries when an Affirm store never adds the record -
    // see `resolves a routed gateway to the record's own account` below for
    // the path that prevents it.
    ['paid', ['affirm'], 'clearing_card'],
    // Casing and whitespace are the provider's, not a second gateway.
    ['paid', ['  Affirm '], 'clearing_card'],
    ['PAID', ['SHOPIFY_PAYMENTS'], 'clearing_card'],
    // A rail nobody has named is still card money: one processor took it, and
    // `clearing_card` is where a wrong guess fails to reconcile visibly.
    ['paid', ['paypal'], 'clearing_card'],
    ['paid', ['stripe'], 'clearing_card'],
    // Paid, but not on a rail auxx can see. The order still owes.
    ['paid', ['manual'], 'accounts_receivable'],
    ['paid', [], 'accounts_receivable'],
    ['paid', ['  '], 'accounts_receivable'],
    // Terms and pending: never settled, whatever the gateway says.
    ['pending', ['shopify_payments'], 'accounts_receivable'],
    ['authorized', ['affirm'], 'accounts_receivable'],
    ['partially_paid', [], 'accounts_receivable'],
    [null, ['shopify_payments'], 'accounts_receivable'],
    // A refund is its OWN later event (a credit memo). The money was taken.
    ['refunded', ['shopify_payments'], 'clearing_card'],
    ['partially_refunded', ['affirm'], 'clearing_card'],
    // One gateway repeated is one gateway.
    ['paid', ['shopify_payments', 'Shopify_Payments'], 'clearing_card'],
  ])('%s through %j debits %s', (financialStatus, gateways, role) => {
    expect(resolveFulfillmentDebit({ financialStatus, gateways })).toEqual({ kind: 'debit', role })
  })

  it.each([
    [['bogus'], 'bogus'],
    [['Bogus'], 'bogus'],
    // A test order is not a sale in ANY status, so `bogus` is checked before
    // the financial status rather than after it.
    [['bogus', 'shopify_payments'], 'bogus, shopify_payments'],
  ])('excludes the test gateway %j', (gateways, detail) => {
    expect(resolveFulfillmentDebit({ financialStatus: 'paid', gateways })).toEqual({
      kind: 'exclude',
      reason: 'test-gateway',
      detail,
    })
    expect(resolveFulfillmentDebit({ financialStatus: 'pending', gateways })).toMatchObject({
      kind: 'exclude',
      reason: 'test-gateway',
    })
  })

  it('excludes two distinct gateways, naming them', () => {
    const answer = resolveFulfillmentDebit({
      financialStatus: 'paid',
      gateways: ['shopify_payments', 'Affirm'],
    })
    expect(answer).toEqual({
      kind: 'exclude',
      reason: 'gateway-ambiguous',
      detail: 'shopify_payments, affirm',
    })
  })

  it('sends a manual gateway to receivables even beside a card one', () => {
    // `manual` short-circuits ahead of the ambiguity check: the merchant marked
    // it paid outside a rail, so the receivable is the honest leg.
    expect(
      resolveFulfillmentDebit({ financialStatus: 'paid', gateways: ['manual', 'shopify_payments'] })
    ).toEqual({ kind: 'debit', role: 'accounts_receivable' })
  })

  it('maps every debit answer to a declared posting role', () => {
    expect(FULFILLMENT_DEBIT_ACCOUNT_ROLE).toEqual({
      clearing_card: ACCOUNT_ROLES.CLEARING_CARD,
      accounts_receivable: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
    })
  })

  it('names no gateway in the role table - a role must not name a vendor', () => {
    // `build-entry.ts`'s second rule. `affirm` was the one exception and it was
    // retired on 2026-09-10; the card RAIL is not a vendor, so it stays.
    expect(Object.keys(FULFILLMENT_GATEWAY_DEBIT)).toEqual(['shopify_payments'])
  })

  // ── The `payment_gateway` record path (brief 13 §5.3) ─────────────────────
  //
  // 🛑 Load-bearing since `clearing_affirm` was deleted. This is now the ONLY
  // mechanism keeping a non-card rail out of `clearing_card`, and a rail that
  // lands there can never be drained: `PAYOUT_CLEARING_ROLES` relieves
  // `clearing_card` by exactly what a card payout settled, so an Affirm sale
  // sitting in `1200` is a residual that balances and never clears.

  it("resolves a routed gateway to the record's own account, not to a role", () => {
    expect(
      resolveFulfillmentDebit({
        financialStatus: 'paid',
        gateways: ['affirm'],
        gatewayRoutes: [
          { handles: ['Affirm', 'affirm'], clearingGlAccountId: 'acct_affirm', active: true },
        ],
      })
    ).toEqual({ kind: 'debit', glAccountId: 'acct_affirm' })
  })

  it('matches a route handle case- and whitespace-insensitively', () => {
    expect(
      resolveFulfillmentDebit({
        financialStatus: 'paid',
        gateways: ['  AFFIRM '],
        gatewayRoutes: [
          { handles: ['  Affirm  '], clearingGlAccountId: 'acct_affirm', active: true },
        ],
      })
    ).toEqual({ kind: 'debit', glAccountId: 'acct_affirm' })
  })

  it('routes a CLOSED gateway too - its past shipments still have to reconcile', () => {
    expect(
      resolveFulfillmentDebit({
        financialStatus: 'paid',
        gateways: ['authorize_net'],
        gatewayRoutes: [
          { handles: ['authorize_net'], clearingGlAccountId: 'acct_authnet', active: false },
        ],
      })
    ).toEqual({ kind: 'debit', glAccountId: 'acct_authnet' })
  })

  it('falls back to the role table when no route names the gateway', () => {
    expect(
      resolveFulfillmentDebit({
        financialStatus: 'paid',
        gateways: ['affirm'],
        gatewayRoutes: [
          { handles: ['authorize_net'], clearingGlAccountId: 'acct_authnet', active: true },
        ],
      })
    ).toEqual({ kind: 'debit', role: 'clearing_card' })
  })

  it('refuses to choose when two routes claim the same handle', () => {
    // The record's own write path should never allow this. Guessing which of
    // two accounts is right would put real money in one of them.
    expect(
      resolveFulfillmentDebit({
        financialStatus: 'paid',
        gateways: ['affirm'],
        gatewayRoutes: [
          { handles: ['affirm'], clearingGlAccountId: 'acct_a', active: true },
          { handles: ['Affirm'], clearingGlAccountId: 'acct_b', active: true },
        ],
      })
    ).toEqual({ kind: 'debit', role: 'clearing_card' })
  })

  it('never routes an unpaid order, however well its gateway matches', () => {
    // The status fork runs first: a terms order owes whoever it owes, and
    // aging has to name the debtor.
    expect(
      resolveFulfillmentDebit({
        financialStatus: 'pending',
        gateways: ['affirm'],
        gatewayRoutes: [{ handles: ['affirm'], clearingGlAccountId: 'acct_affirm', active: true }],
      })
    ).toEqual({ kind: 'debit', role: 'accounts_receivable' })
  })
})

// ── 2. One shipment's amounts ───────────────────────────────────────────────

describe('computeShipmentAmounts', () => {
  it('takes tax per line when EVERY line carries one', () => {
    const amounts = computeShipmentAmounts(
      shipment({
        lines: [
          {
            lineId: 'a',
            quantity: 1,
            unitPriceMinor: 10_000,
            lineTaxMinor: 825,
            orderedQuantity: 1,
          },
          {
            lineId: 'b',
            quantity: 2,
            unitPriceMinor: 5_000,
            lineTaxMinor: 825,
            orderedQuantity: 2,
          },
        ],
        orderSubtotalMinor: 20_000,
        orderTaxTotalMinor: 1_650,
        orderShippingTotalMinor: 0,
      }),
      { role: 'clearing_card' }
    )
    expect(amounts).toMatchObject({
      debitRole: 'clearing_card',
      subtotalMinor: 20_000,
      taxMinor: 1_650,
      shippingMinor: 0,
      totalMinor: 21_650,
      taxBasis: 'per_line',
    })
  })

  it('allocates the order tax when ANY line is missing its own', () => {
    // Mixing a known per-line tax with an allocated remainder would double-count
    // the lines that carried one, so it is all or nothing.
    const amounts = computeShipmentAmounts(
      shipment({
        lines: [
          {
            lineId: 'a',
            quantity: 1,
            unitPriceMinor: 10_000,
            lineTaxMinor: 825,
            orderedQuantity: 1,
          },
          {
            lineId: 'b',
            quantity: 1,
            unitPriceMinor: 10_000,
            lineTaxMinor: null,
            orderedQuantity: 1,
          },
        ],
        orderSubtotalMinor: 20_000,
        orderTaxTotalMinor: 1_650,
        orderShippingTotalMinor: 0,
      }),
      { role: 'clearing_card' }
    )
    expect(amounts.taxBasis).toBe('allocated')
    expect(amounts.taxMinor).toBe(1_650)
  })

  it('scales a line tax to the part of the line that shipped', () => {
    // 4 units ordered carrying 400 of tax, 3 shipped: round(400 x 3 / 4).
    const amounts = computeShipmentAmounts(
      shipment({
        lines: [
          {
            lineId: 'a',
            quantity: 3,
            unitPriceMinor: 1_000,
            lineTaxMinor: 400,
            orderedQuantity: 4,
          },
        ],
        orderSubtotalMinor: 4_000,
        orderTaxTotalMinor: 400,
        orderShippingTotalMinor: 0,
      }),
      { role: 'clearing_card' }
    )
    expect(amounts).toMatchObject({ subtotalMinor: 3_000, taxMinor: 300, taxBasis: 'per_line' })
  })

  it('takes a line tax in full when the ordered quantity cannot scale it', () => {
    const amounts = computeShipmentAmounts(
      shipment({
        lines: [
          {
            lineId: 'a',
            quantity: 2,
            unitPriceMinor: 1_000,
            lineTaxMinor: 400,
            orderedQuantity: 0,
          },
        ],
        orderSubtotalMinor: 2_000,
        orderTaxTotalMinor: 400,
        orderShippingTotalMinor: 0,
      }),
      { role: 'clearing_card' }
    )
    expect(amounts.taxMinor).toBe(400)
  })

  it('allocates a later shipment CUMULATIVELY so the two sum to the order tax', () => {
    const first = computeShipmentAmounts(
      shipment({
        lines: [
          {
            lineId: 'a',
            quantity: 1,
            unitPriceMinor: 10_000,
            lineTaxMinor: null,
            orderedQuantity: 1,
          },
        ],
        orderSubtotalMinor: 30_000,
        orderTaxTotalMinor: 2_310,
        orderShippingTotalMinor: 0,
        priorShipmentsSubtotalMinor: 0,
      }),
      { role: 'clearing_card' }
    )
    const second = computeShipmentAmounts(
      shipment({
        lines: [
          {
            lineId: 'b',
            quantity: 2,
            unitPriceMinor: 10_000,
            lineTaxMinor: null,
            orderedQuantity: 2,
          },
        ],
        orderSubtotalMinor: 30_000,
        orderTaxTotalMinor: 2_310,
        orderShippingTotalMinor: 0,
        priorShipmentsSubtotalMinor: 10_000,
      }),
      { role: 'clearing_card' }
    )
    expect(first.taxMinor).toBe(770)
    expect(second.taxMinor).toBe(1_540)
    expect(first.taxMinor + second.taxMinor).toBe(2_310)
  })

  it('recognises shipping once, on the shipment that carries the flag', () => {
    const carries = computeShipmentAmounts(
      shipment({ orderShippingTotalMinor: 1_500, includeShipping: true }),
      { role: 'clearing_card' }
    )
    const does_not = computeShipmentAmounts(
      shipment({ orderShippingTotalMinor: 1_500, includeShipping: false }),
      { role: 'clearing_card' }
    )
    expect(carries.shippingMinor).toBe(1_500)
    expect(does_not.shippingMinor).toBe(0)
  })

  it('refuses a non-positive quantity rather than posting a negative line', () => {
    expect(() =>
      computeShipmentAmounts(
        shipment({
          lines: [
            {
              lineId: 'a',
              quantity: 0,
              unitPriceMinor: 1_000,
              lineTaxMinor: null,
              orderedQuantity: 1,
            },
          ],
        }),
        { role: 'clearing_card' }
      )
    ).toThrowError(UnprocessableEntityError)
  })
})

// ── 3. The entry ────────────────────────────────────────────────────────────

describe('buildFulfillmentBatchEntry', () => {
  it('balances a mixed group and decomposes the same numbers', () => {
    const card = planned({ orderId: 'o-card', orderNumber: '#2001' })
    // A non-card rail, routed by a `payment_gateway` record to its OWN clearing
    // account. This used to be the `clearing_affirm` role; since 2026-09-10 the
    // record is the only way a rail stays out of `1200`, so the mixed group
    // exercises it end to end.
    const affirm = planned(
      {
        orderId: 'o-affirm',
        orderNumber: '#2002',
        gateways: ['Affirm'],
        orderShippingTotalMinor: 0,
      },
      [{ handles: ['affirm'], clearingGlAccountId: AFFIRM_ACCOUNT, active: true }]
    )
    // One terms order shipping twice on the same day: two lines in, ONE A/R line out.
    const termsFirst = planned({
      orderId: 'o-terms',
      orderNumber: '#2003',
      financialStatus: 'pending',
      gateways: ['manual'],
      lines: [
        {
          lineId: 't1',
          quantity: 1,
          unitPriceMinor: 10_000,
          lineTaxMinor: null,
          orderedQuantity: 1,
        },
      ],
      orderSubtotalMinor: 30_000,
      orderTaxTotalMinor: 2_310,
      orderShippingTotalMinor: 1_000,
      includeShipping: true,
    })
    const termsSecond = planned({
      orderId: 'o-terms',
      orderNumber: '#2003',
      sequence: 2,
      financialStatus: 'pending',
      gateways: ['manual'],
      lines: [
        {
          lineId: 't2',
          quantity: 2,
          unitPriceMinor: 10_000,
          lineTaxMinor: null,
          orderedQuantity: 2,
        },
      ],
      orderSubtotalMinor: 30_000,
      orderTaxTotalMinor: 2_310,
      orderShippingTotalMinor: 1_000,
      priorShipmentsSubtotalMinor: 10_000,
      includeShipping: false,
    })
    // A second terms order, so the A/R leg has to be per ORDER and not per group.
    const termsOther = planned({
      orderId: 'o-terms-2',
      orderNumber: '#2004',
      channel: 'dealer',
      financialStatus: 'pending',
      gateways: [],
      orderShippingTotalMinor: 0,
    })
    // Tax exempt: zero tax, and it must not drag a zero leg into the entry.
    const exempt = planned({
      orderId: 'o-exempt',
      orderNumber: '#2005',
      orderTaxTotalMinor: 0,
      orderShippingTotalMinor: 0,
    })

    const shipments = [card, affirm, termsFirst, termsSecond, termsOther, exempt]
    const built = buildFulfillmentBatchEntry({
      group: group(shipments),
      ledgerCurrency: 'USD',
      attempt: 0,
    })
    const { entry } = built

    const expectedTotal = shipments.reduce((sum, s) => sum + s.amounts.totalMinor, 0)
    expect(entry.totalDebit).toBe(expectedTotal)
    expect(entry.totalCredit).toBe(expectedTotal)
    expect(built.totals.totalMinor).toBe(expectedTotal)
    expect(built.totals.byDebitRole.accounts_receivable).toBe(
      termsFirst.amounts.totalMinor + termsSecond.amounts.totalMinor + termsOther.amounts.totalMinor
    )

    // The credits decompose the debits: subtotal + tax + shipping.
    const credits = entry.lines.filter((line) => line.direction === 'credit')
    expect(credits.reduce((sum, line) => sum + line.amount, 0)).toBe(expectedTotal)
    expect(amountFor(entry, ACCOUNT_ROLES.SALES_TAX_PAYABLE)).toBe(built.totals.taxMinor)
    expect(amountFor(entry, ACCOUNT_ROLES.REVENUE_SHIPPING)).toBe(built.totals.shippingMinor)
    expect(amountFor(entry, ACCOUNT_ROLES.CLEARING_CARD)).toBe(
      card.amounts.totalMinor + exempt.amounts.totalMinor
    )
    // 🛑 By ACCOUNT ID, not by role, and NOT folded into `clearing_card` - a
    // rail that lands in `1200` can never be drained, because a payout relieves
    // that account by exactly what a CARD payout settled.
    expect(amountForAccount(entry, AFFIRM_ACCOUNT)).toBe(affirm.amounts.totalMinor)
    expect(built.totals.byDebitRole.gateway).toBe(affirm.amounts.totalMinor)
    // Channel is a dimension on ONE revenue_product account now (brief 13 §5),
    // never a second account - the dealer order's share is the dealer-dimensioned line.
    expect(dimensionAmountFor(entry, ACCOUNT_ROLES.REVENUE_PRODUCT, 'channel', 'dealer')).toBe(
      termsOther.amounts.subtotalMinor
    )
  })

  it('emits ONE receivable line per order, sourced on the order', () => {
    const first = planned({
      orderId: 'o-terms',
      orderNumber: '#3001',
      financialStatus: 'pending',
      gateways: [],
    })
    const second = planned({
      orderId: 'o-terms',
      orderNumber: '#3001',
      sequence: 2,
      financialStatus: 'pending',
      gateways: [],
      includeShipping: false,
      priorShipmentsSubtotalMinor: 10_000,
    })
    const other = planned({
      orderId: 'o-terms-2',
      orderNumber: '#3002',
      financialStatus: 'pending',
      gateways: [],
    })

    const { entry } = buildFulfillmentBatchEntry({
      group: group([first, second, other]),
      ledgerCurrency: 'USD',
      attempt: 0,
    })
    const receivables = linesFor(entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)

    // 🛑 Aging has to name the debtor, so this leg alone stays at order grain.
    expect(receivables).toHaveLength(2)
    expect(receivables.map((line) => line.sourceType)).toEqual([
      FULFILLMENT_SOURCE_TYPE,
      FULFILLMENT_SOURCE_TYPE,
    ])
    expect(receivables.map((line) => line.sourceId)).toEqual(['o-terms', 'o-terms-2'])
    expect(receivables.map((line) => line.memo)).toEqual(['#3001', '#3002'])
    expect(receivables[0]?.amount).toBe(first.amounts.totalMinor + second.amounts.totalMinor)
  })

  it('carries the order contact on its receivable line only (brief 13 §1.2)', () => {
    const terms = planned({
      orderId: 'o-terms',
      orderNumber: '#5001',
      financialStatus: 'pending',
      gateways: [],
      contactId: 'contact-terms',
    })
    const noContact = planned({
      orderId: 'o-terms-2',
      orderNumber: '#5002',
      financialStatus: 'pending',
      gateways: [],
      contactId: null,
    })
    const card = planned({ orderId: 'o-card', orderNumber: '#5003', contactId: 'contact-card' })

    const { entry } = buildFulfillmentBatchEntry({
      group: group([terms, noContact, card]),
      ledgerCurrency: 'USD',
      attempt: 0,
    })
    const receivables = linesFor(entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)
    expect(receivables.find((line) => line.sourceId === 'o-terms')).toMatchObject({
      counterpartyType: 'customer',
      counterpartyId: 'contact-terms',
    })
    expect(
      receivables.find((line) => line.sourceId === 'o-terms-2')?.counterpartyId
    ).toBeUndefined()
    // The card order's clearing debit is summarised, and never carries a
    // counterparty even though the shipment itself has a contact.
    expect(linesFor(entry, ACCOUNT_ROLES.CLEARING_CARD)[0]?.counterpartyId).toBeUndefined()
  })

  it('sources every summarised line on the period key, never on an order', () => {
    const built = buildFulfillmentBatchEntry({
      group: group([planned(), planned({ channel: 'dealer' })]),
      ledgerCurrency: 'USD',
      attempt: 0,
    })
    const summarised = built.entry.lines.filter(
      (line) => line.accountRole !== ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE
    )
    expect(summarised.length).toBeGreaterThan(0)
    for (const line of summarised) {
      expect(line.sourceType).toBe(FULFILLMENT_BATCH_SOURCE_TYPE)
      expect(line.sourceId).toBe(built.periodKey)
    }
  })

  it('emits the lines in the declared order and drops the zero legs', () => {
    const terms = planned({
      orderId: 'o-terms',
      orderNumber: '#4001',
      financialStatus: 'pending',
      gateways: [],
      orderShippingTotalMinor: 0,
      orderTaxTotalMinor: 0,
    })
    const card = planned({
      orderId: 'o-card',
      orderNumber: '#4002',
      orderShippingTotalMinor: 0,
      orderTaxTotalMinor: 0,
    })
    const { entry } = buildFulfillmentBatchEntry({
      group: group([terms, card]),
      ledgerCurrency: 'USD',
      attempt: 0,
    })
    expect(entry.lines.map((line) => line.accountRole)).toEqual([
      ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
      ACCOUNT_ROLES.CLEARING_CARD,
      ACCOUNT_ROLES.REVENUE_PRODUCT,
    ])
    expect(entry.lines.map((line) => line.sortOrder)).toEqual([0, 1, 2])
  })

  it('freezes the per-shipment list into the entry, for the draft envelope', () => {
    const card = planned({ orderId: 'o-card', orderNumber: '#5001' })
    const terms = planned({
      orderId: 'o-terms',
      orderNumber: '#5002',
      sequence: 3,
      financialStatus: 'pending',
      gateways: [],
    })
    const { entry } = buildFulfillmentBatchEntry({
      group: group([card, terms]),
      ledgerCurrency: 'USD',
      attempt: 0,
    })

    // Summarised lines name a period key, not the orders behind it, so this
    // list is the only record of what the number was made of (49 §2.5).
    expect(entry.sources).toEqual([
      {
        orderId: 'o-card',
        orderNumber: '#5001',
        sequence: 1,
        amounts: card.amounts,
      },
      {
        orderId: 'o-terms',
        orderNumber: '#5002',
        sequence: 3,
        amounts: terms.amounts,
      },
    ] satisfies FulfillmentBatchSource[])
  })

  it('books an unset or manual channel to consumer revenue, never refusing', () => {
    // The fail-open half of 49 §8.4 decision 5: 535 of 545 orders on the
    // reference org carry `manual`, and refusing them recognised no revenue.
    const built = buildFulfillmentBatchEntry({
      group: group([
        planned({ channel: 'manual' }),
        planned({ channel: null }),
        planned({ channel: 'wholesale' }),
      ]),
      ledgerCurrency: 'USD',
      attempt: 0,
    })
    // One revenue_product line, dimensioned `dtc` - never a dealer line.
    expect(amountFor(built.entry, ACCOUNT_ROLES.REVENUE_PRODUCT)).toBe(built.totals.subtotalMinor)
    expect(dimensionAmountFor(built.entry, ACCOUNT_ROLES.REVENUE_PRODUCT, 'channel', 'dtc')).toBe(
      built.totals.subtotalMinor
    )
    expect(
      dimensionAmountFor(built.entry, ACCOUNT_ROLES.REVENUE_PRODUCT, 'channel', 'dealer')
    ).toBeUndefined()
  })

  it('carries the memo onto the summarised lines and the order number onto the A/R ones', () => {
    const built = buildFulfillmentBatchEntry({
      group: group([
        planned({ orderId: 'o-1', orderNumber: '#6001' }),
        planned({ orderId: 'o-2', orderNumber: '#6002', financialStatus: 'pending', gateways: [] }),
      ]),
      ledgerCurrency: 'USD',
      attempt: 0,
      memo: 'July catch-up',
    })
    expect(linesFor(built.entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)[0]?.memo).toBe('#6002')
    expect(linesFor(built.entry, ACCOUNT_ROLES.CLEARING_CARD)[0]?.memo).toContain('July catch-up')
  })

  it('stamps the posting type, the period key and the group txn date', () => {
    const built = buildFulfillmentBatchEntry({
      group: group([planned({ shippedAt: '2026-07-06' })], '2026-07-06'),
      ledgerCurrency: 'USD',
      attempt: 0,
    })
    expect(built.entry.postingType).toBe('fulfillment')
    expect(built.entry.periodKey).toBe('2026-07-06')
    expect(built.periodKey).toBe('2026-07-06')
    expect(built.entry.txnDate).toBe('2026-07-06')
  })

  it('refuses an empty group rather than claiming the period for nothing', () => {
    expect(() =>
      buildFulfillmentBatchEntry({ group: group([]), ledgerCurrency: 'USD', attempt: 0 })
    ).toThrowError(/no shipments/)
  })

  it('refuses a foreign-currency shipment rather than implying a 1.0 rate', () => {
    expect(() =>
      buildFulfillmentBatchEntry({
        group: group([planned({ currency: 'CAD' })]),
        ledgerCurrency: 'USD',
        attempt: 0,
      })
    ).toThrowError(/implied 1\.0 rate/)
  })

  it('refuses frozen amounts whose parts do not sum to their own total', () => {
    // 🛑 Load-bearing: the debits use `totalMinor` and the credits use its
    // parts, so a mis-stated total is an entry that genuinely does not balance.
    const bad = planned()
    bad.amounts = { ...bad.amounts, totalMinor: bad.amounts.totalMinor + 1 }
    expect(() =>
      buildFulfillmentBatchEntry({ group: group([bad]), ledgerCurrency: 'USD', attempt: 0 })
    ).toThrowError(/could not balance/)
  })

  it('refuses a fractional frozen amount', () => {
    const bad = planned()
    bad.amounts = { ...bad.amounts, taxMinor: 12.5, totalMinor: bad.amounts.totalMinor + 12.5 }
    expect(() =>
      buildFulfillmentBatchEntry({ group: group([bad]), ledgerCurrency: 'USD', attempt: 0 })
    ).toThrowError(/whole number of cents/)
  })
})

// ── 4. The keyspace ─────────────────────────────────────────────────────────

describe('fulfillmentBatchPeriodKey', () => {
  it('is the group key verbatim at attempt 0', () => {
    // 🛑 Byte for byte: the key is half the claim's uniqueness tuple, so
    // re-keying it would hide every posting already in a ledger.
    expect(fulfillmentBatchPeriodKey('2026-07-06', 0)).toBe('2026-07-06')
    expect(fulfillmentBatchPeriodKey('2026-W27', 0)).toBe('2026-W27')
    expect(fulfillmentBatchPeriodKey('2026-07', 0)).toBe('2026-07')
  })

  it('appends one base-36 character per attempt', () => {
    expect(fulfillmentBatchPeriodKey('2026-07-06', 1)).toBe('2026-07-061')
    expect(fulfillmentBatchPeriodKey('2026-07-06', 10)).toBe('2026-07-06A')
    expect(fulfillmentBatchPeriodKey('2026-07-06', 35)).toBe('2026-07-06Z')
  })

  it('leaves exactly one character of budget for the attempt', () => {
    // `AUXX-FUL-` is 9 and `-R9` is 3, so 9 compacted characters are left, and
    // a day key is 8 of them. The margin is one character, and it is the whole
    // reason a late order can be posted at all.
    expect(MAX_COMPACT_FULFILLMENT_BATCH_KEY).toBe(9)
    expect('2026-07-06'.replace(/-/g, '')).toHaveLength(8)
    expect('2026-W27'.replace(/-/g, '')).toHaveLength(7)
    expect('2026-07'.replace(/-/g, '')).toHaveLength(6)
  })

  it('mints a document number that survives a reversal at every grouping', () => {
    for (const key of ['2026-07-06', '2026-W27', '2026-07']) {
      for (const attempt of [0, 1, 35]) {
        const periodKey = fulfillmentBatchPeriodKey(key, attempt)
        const reversal = buildDocNumber({ postingType: 'fulfillment', periodKey, revision: 1 })
        expect(reversal.length).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
      }
    }
    expect(buildDocNumber({ postingType: 'fulfillment', periodKey: '2026-07-061' })).toBe(
      'AUXX-FUL-202607061'
    )
  })

  it('refuses a blank key, a fractional attempt and an attempt past the keyspace', () => {
    expect(() => fulfillmentBatchPeriodKey('   ', 0)).toThrowError(/needs a group key/)
    expect(() => fulfillmentBatchPeriodKey('2026-07-06', 1.5)).toThrowError(/whole number from 0/)
    expect(() => fulfillmentBatchPeriodKey('2026-07-06', -1)).toThrowError(/whole number from 0/)
    expect(() =>
      fulfillmentBatchPeriodKey('2026-07-06', MAX_FULFILLMENT_BATCH_ATTEMPT + 1)
    ).toThrowError(/keyspace can hold/)
  })

  it('refuses a group key too long to survive a reversal', () => {
    // Ten compacted characters posts fine at revision 0 and blows up at
    // revision 1, which is why the check is here and not in `buildDocNumber`.
    expect('2026-07-06-12'.replace(/-/g, '')).toHaveLength(10)
    expect(() => fulfillmentBatchPeriodKey('2026-07-06-12', 0)).toThrowError(/compacts to/)
    // A day key at the very top of the budget still refuses the attempt char.
    expect(() => fulfillmentBatchPeriodKey('2026-07-061', 1)).toThrowError(/compacts to/)
  })
})
