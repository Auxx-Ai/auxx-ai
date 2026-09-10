// packages/lib/src/money/fulfillment-posting/__tests__/plan.test.ts
//
// `planFulfillmentPosting` is the whole decision behind the bulk poster and it
// touches nothing, so this file is where the painful cases live: a week that
// straddles a month, an order carrying two gateways, a shipment dated inside a
// closed period, and the priority order between those reasons.
//
// 🛑 Lane A's `resolveFulfillmentDebit` and `computeShipmentAmounts` are used
// FOR REAL here, not stubbed. They are pure, and the thing worth asserting is
// that the plan and the builder agree about what one shipment is worth - a
// stub would assert only that the plan calls something.
//
// Amounts are integer minor units: 12_000 = $120.00.

import { describe, expect, it } from 'vitest'
import type { GatewayRoute } from '../../../payment-gateways/client'
import { groupKeyFor, isoWeekKey, planFulfillmentPosting } from '../plan'
import type {
  FulfillmentPostingGrouping,
  FulfillmentPostingPlanInput,
  UnpostedShipment,
} from '../types'

/** One shipment of a one-line, $100, paid-by-card order. */
function shipment(overrides: Partial<UnpostedShipment> = {}): UnpostedShipment {
  const orderId = overrides.orderId ?? 'ord_1'
  return {
    orderId,
    orderNumber: overrides.orderNumber ?? '#1001',
    sequence: 1,
    shippedAt: '2026-07-06',
    lines: [
      {
        lineId: `${orderId}_l1`,
        quantity: 1,
        unitPriceMinor: 10_000,
        lineTaxMinor: null,
        orderedQuantity: 1,
        name: 'Widget',
      },
    ],
    channel: 'dtc',
    currency: 'USD',
    financialStatus: 'paid',
    gateways: ['shopify_payments'],
    orderSubtotalMinor: 10_000,
    orderTaxTotalMinor: 0,
    orderShippingTotalMinor: 0,
    priorShipmentsSubtotalMinor: 0,
    includeShipping: false,
    contactId: 'ct_1',
    taxLines: [],
    ...overrides,
  }
}

function plan(
  shipments: UnpostedShipment[],
  overrides: Partial<
    Omit<FulfillmentPostingPlanInput, 'shipments'> & { gatewayRoutes: readonly GatewayRoute[] }
  > = {}
) {
  return planFulfillmentPosting({
    shipments,
    grouping: 'day',
    cutoffPeriod: null,
    lockedThroughMonth: null,
    ledgerCurrency: 'USD',
    timeZone: 'America/Los_Angeles',
    ...overrides,
  })
}

describe('grouping', () => {
  const ships = [
    shipment({ orderId: 'a', orderNumber: '#1', shippedAt: '2026-07-27' }),
    shipment({ orderId: 'b', orderNumber: '#2', shippedAt: '2026-07-31' }),
    shipment({ orderId: 'c', orderNumber: '#3', shippedAt: '2026-08-02' }),
  ]

  it('makes one posting per calendar day', () => {
    expect(plan(ships, { grouping: 'day' }).groups.map((g) => g.groupKey)).toEqual([
      '2026-07-27',
      '2026-07-31',
      '2026-08-02',
    ])
  })

  it('makes one posting per calendar month', () => {
    expect(plan(ships, { grouping: 'month' }).groups.map((g) => g.groupKey)).toEqual([
      '2026-07',
      '2026-08',
    ])
  })

  // 🛑 The case a month bucket cannot express. `2026-W31` is Monday July 27
  // through Sunday August 2, so all three shipments are ONE posting - and its
  // `txnDate` is in August while its key names a week that starts in July.
  it('makes one posting for a week that straddles a month boundary', () => {
    const result = plan(ships, { grouping: 'week' })

    expect(result.groups.map((g) => g.groupKey)).toEqual(['2026-W31'])
    expect(result.groups[0]?.shipments).toHaveLength(3)
    expect(result.groups[0]?.txnDate).toBe('2026-08-02')
  })

  it('keeps a week that crosses the new year in the ISO week-numbering year', () => {
    const result = plan(
      [
        shipment({ orderId: 'a', orderNumber: '#1', shippedAt: '2026-12-31' }),
        shipment({ orderId: 'b', orderNumber: '#2', shippedAt: '2027-01-01' }),
      ],
      { grouping: 'week' }
    )

    expect(result.groups.map((g) => g.groupKey)).toEqual(['2026-W53'])
    expect(result.groups[0]?.txnDate).toBe('2027-01-01')
  })

  it('dates a group to its LATEST ship date, never to the key', () => {
    const result = plan(ships, { grouping: 'month' })

    expect(result.groups.map((g) => g.txnDate)).toEqual(['2026-07-31', '2026-08-02'])
  })

  it('counts DISTINCT orders, not shipments', () => {
    const result = plan(
      [
        shipment({ orderId: 'a', orderNumber: '#1', sequence: 1, shippedAt: '2026-07-06' }),
        shipment({ orderId: 'a', orderNumber: '#1', sequence: 2, shippedAt: '2026-07-06' }),
        shipment({ orderId: 'b', orderNumber: '#2', shippedAt: '2026-07-06' }),
      ],
      { grouping: 'day' }
    )

    expect(result.groups[0]?.shipments).toHaveLength(3)
    expect(result.groups[0]?.orderCount).toBe(2)
    expect(result.footer.orders).toBe(2)
  })

  it('orders groups by key and shipments by ship date, order number, sequence', () => {
    const result = plan(
      [
        shipment({ orderId: 'b', orderNumber: '#2', sequence: 2, shippedAt: '2026-07-06' }),
        shipment({ orderId: 'c', orderNumber: '#3', shippedAt: '2026-07-05' }),
        shipment({ orderId: 'b', orderNumber: '#2', sequence: 1, shippedAt: '2026-07-06' }),
        shipment({ orderId: 'a', orderNumber: '#1', shippedAt: '2026-07-06' }),
      ],
      { grouping: 'month' }
    )

    expect(result.groups[0]?.shipments.map((s) => `${s.orderNumber}/${s.sequence}`)).toEqual([
      '#3/1',
      '#1/1',
      '#2/1',
      '#2/2',
    ])
  })
})

describe('isoWeekKey and groupKeyFor', () => {
  it('matches date-fns RRRR-Www on the boundaries that bite', () => {
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01')
    expect(isoWeekKey('2026-07-06')).toBe('2026-W28')
    expect(isoWeekKey('2026-07-12')).toBe('2026-W28')
    expect(isoWeekKey('2026-07-13')).toBe('2026-W29')
    expect(isoWeekKey('2026-12-31')).toBe('2026-W53')
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53')
  })

  it.each<[FulfillmentPostingGrouping, string]>([
    ['day', '2026-07-06'],
    ['week', '2026-W28'],
    ['month', '2026-07'],
  ])('keys a %s group as %s', (grouping, expected) => {
    expect(groupKeyFor('2026-07-06', grouping)).toBe(expected)
  })
})

describe('exclusions carry the value that proves them', () => {
  it('excludes a shipment at or before the accounting cutoff, naming the cutoff', () => {
    const result = plan([shipment({ shippedAt: '2025-12-31' })], { cutoffPeriod: '2025-12' })

    expect(result.groups).toEqual([])
    expect(result.exclusions).toEqual([
      expect.objectContaining({ reason: 'before-cutoff', detail: '2025-12' }),
    ])
  })

  it('keeps a shipment in the month AFTER the cutoff', () => {
    const result = plan([shipment({ shippedAt: '2026-01-02' })], { cutoffPeriod: '2025-12' })

    expect(result.exclusions).toEqual([])
    expect(result.groups).toHaveLength(1)
  })

  it('excludes a shipment in a locked month, naming the lock', () => {
    const result = plan([shipment({ shippedAt: '2026-07-06' })], {
      lockedThroughMonth: '2026-07',
    })

    expect(result.exclusions).toEqual([
      expect.objectContaining({ reason: 'locked-period', detail: '2026-07' }),
    ])
  })

  it('excludes a foreign-currency order, naming the currency', () => {
    const result = plan([shipment({ currency: 'CAD' })])

    expect(result.exclusions).toEqual([
      expect.objectContaining({ reason: 'foreign-currency', detail: 'CAD' }),
    ])
  })

  // A blank currency is an unfilled cell, not a foreign order. 7 of the org's
  // 538 imported orders carry one (§7).
  it('reads a blank currency as the ledger currency', () => {
    expect(plan([shipment({ currency: '' })]).exclusions).toEqual([])
    expect(plan([shipment({ currency: null })]).exclusions).toEqual([])
  })

  it('excludes a test order, naming the gateway', () => {
    const result = plan([shipment({ gateways: ['bogus'] })])

    expect(result.exclusions).toEqual([
      expect.objectContaining({ reason: 'test-gateway', detail: 'bogus' }),
    ])
  })

  it('excludes an order split across two gateways, naming both', () => {
    const result = plan([shipment({ gateways: ['shopify_payments', 'Affirm'] })])

    expect(result.exclusions).toEqual([
      expect.objectContaining({
        reason: 'gateway-ambiguous',
        detail: 'shopify_payments, affirm',
      }),
    ])
  })

  it('excludes a shipment worth nothing, naming the total', () => {
    const result = plan([
      shipment({
        lines: [
          {
            lineId: 'l1',
            quantity: 1,
            unitPriceMinor: 0,
            lineTaxMinor: null,
            orderedQuantity: 1,
          },
        ],
        orderSubtotalMinor: 0,
      }),
    ])

    expect(result.exclusions).toEqual([
      expect.objectContaining({ reason: 'zero-value', detail: '0' }),
    ])
  })

  it('reports a shipment whose amounts cannot be computed rather than throwing', () => {
    const result = plan([
      shipment({
        lines: [
          {
            lineId: 'l1',
            quantity: Number.NaN,
            unitPriceMinor: 10_000,
            lineTaxMinor: null,
            orderedQuantity: 1,
          },
        ],
      }),
    ])

    expect(result.groups).toEqual([])
    expect(result.exclusions[0]?.reason).toBe('zero-value')
    // The builder's own sentence, not a swallowed error.
    expect(result.exclusions[0]?.detail).toMatch(/NaN/)
  })

  it('names the order, the sequence and the ship date on every exclusion', () => {
    const result = plan([
      shipment({ orderId: 'ord_9', orderNumber: '#9', sequence: 3, currency: 'EUR' }),
    ])

    expect(result.exclusions[0]).toEqual({
      orderId: 'ord_9',
      orderNumber: '#9',
      sequence: 3,
      shippedAt: '2026-07-06',
      reason: 'foreign-currency',
      detail: 'EUR',
    })
  })
})

describe('the exclusion PRIORITY order', () => {
  // 🛑 Every one of these shipments qualifies for several reasons at once. The
  // remedy differs per reason, so reporting the wrong one sends a person to the
  // wrong screen.
  it('reports a cutoff shipment as before-cutoff even when the period is also locked', () => {
    const result = plan([shipment({ shippedAt: '2025-11-04', currency: 'CAD' })], {
      cutoffPeriod: '2025-12',
      lockedThroughMonth: '2026-01',
    })

    expect(result.exclusions[0]?.reason).toBe('before-cutoff')
  })

  it('reports a locked shipment as locked-period even when it is foreign currency', () => {
    const result = plan([shipment({ shippedAt: '2026-07-06', currency: 'CAD' })], {
      lockedThroughMonth: '2026-07',
    })

    expect(result.exclusions[0]?.reason).toBe('locked-period')
  })

  it('reports a foreign-currency shipment as such even when its gateways are ambiguous', () => {
    const result = plan([shipment({ currency: 'CAD', gateways: ['stripe', 'paypal'] })])

    expect(result.exclusions[0]?.reason).toBe('foreign-currency')
  })

  it('reports a test order as test-gateway even when the shipment is worth nothing', () => {
    const result = plan([
      shipment({
        gateways: ['bogus'],
        lines: [
          { lineId: 'l1', quantity: 1, unitPriceMinor: 0, lineTaxMinor: null, orderedQuantity: 1 },
        ],
        orderSubtotalMinor: 0,
      }),
    ])

    expect(result.exclusions[0]?.reason).toBe('test-gateway')
  })

  it('excludes each shipment exactly once', () => {
    const result = plan([shipment({ shippedAt: '2025-11-04', currency: 'CAD' })], {
      cutoffPeriod: '2025-12',
    })

    expect(result.exclusions).toHaveLength(1)
    expect(result.footer.excluded).toBe(1)
  })
})

describe('totals and the debit split', () => {
  it('splits a group by the account each shipment debits', () => {
    const result = plan([
      // Paid by card.
      shipment({ orderId: 'a', orderNumber: '#1' }),
      // Paid by Affirm: its own clearing account, so the payout reconciles.
      shipment({ orderId: 'b', orderNumber: '#2', gateways: ['Affirm'] }),
      // Not paid: a receivable, and aging needs the debtor.
      shipment({ orderId: 'c', orderNumber: '#3', financialStatus: 'pending' }),
    ])

    expect(result.groups[0]?.totals.byDebitRole).toEqual({
      clearing_card: 10_000,
      clearing_affirm: 10_000,
      accounts_receivable: 10_000,
      gateway: 0,
    })
  })

  it('sums subtotal, tax and shipping into the group total', () => {
    const result = plan([
      shipment({
        orderId: 'a',
        orderNumber: '#1',
        orderTaxTotalMinor: 800,
        orderShippingTotalMinor: 1_500,
        includeShipping: true,
      }),
      shipment({ orderId: 'b', orderNumber: '#2' }),
    ])

    expect(result.groups[0]?.totals).toMatchObject({
      subtotalMinor: 20_000,
      taxMinor: 800,
      shippingMinor: 1_500,
      totalMinor: 22_300,
    })
  })

  it('recognises shipping only on the shipment the log flagged', () => {
    const result = plan([
      shipment({
        orderId: 'a',
        sequence: 1,
        orderShippingTotalMinor: 1_500,
        includeShipping: true,
      }),
      shipment({
        orderId: 'a',
        sequence: 2,
        orderShippingTotalMinor: 1_500,
        includeShipping: false,
        priorShipmentsSubtotalMinor: 10_000,
      }),
    ])

    expect(result.groups[0]?.totals.shippingMinor).toBe(1_500)
  })

  // The reason `priorShipmentsSubtotalMinor` is on the read at all: the second
  // shipment's tax is the running allocation minus the first's, so the two
  // shipments together carry the order's whole 100 of tax with no cent lost.
  it('allocates tax cumulatively across two shipments of one order', () => {
    const first = plan([
      shipment({
        orderId: 'a',
        sequence: 1,
        lines: [
          {
            lineId: 'l1',
            quantity: 1,
            unitPriceMinor: 10_000,
            lineTaxMinor: null,
            orderedQuantity: 3,
          },
        ],
        orderSubtotalMinor: 30_000,
        orderTaxTotalMinor: 100,
        priorShipmentsSubtotalMinor: 0,
      }),
    ])
    const third = plan([
      shipment({
        orderId: 'a',
        sequence: 3,
        lines: [
          {
            lineId: 'l1',
            quantity: 1,
            unitPriceMinor: 10_000,
            lineTaxMinor: null,
            orderedQuantity: 3,
          },
        ],
        orderSubtotalMinor: 30_000,
        orderTaxTotalMinor: 100,
        priorShipmentsSubtotalMinor: 20_000,
      }),
    ])

    expect(first.groups[0]?.totals.taxMinor).toBe(33)
    // 100 - round(100 * 20000/30000) = 100 - 67 = 33... the remainder lands here.
    expect(third.groups[0]?.totals.taxMinor).toBe(33)
    expect(first.groups[0]?.shipments[0]?.amounts.taxBasis).toBe('allocated')
  })

  it('uses the per-line tax when every shipped line carries one', () => {
    const result = plan([
      shipment({
        lines: [
          {
            lineId: 'l1',
            quantity: 1,
            unitPriceMinor: 10_000,
            lineTaxMinor: 875,
            orderedQuantity: 1,
          },
        ],
        orderTaxTotalMinor: 999,
      }),
    ])

    expect(result.groups[0]?.shipments[0]?.amounts.taxBasis).toBe('per_line')
    expect(result.groups[0]?.totals.taxMinor).toBe(875)
  })
})

describe('the footer', () => {
  it('counts postings, shipments, orders, exclusions and the money', () => {
    const result = plan(
      [
        shipment({ orderId: 'a', orderNumber: '#1', shippedAt: '2026-07-06' }),
        shipment({ orderId: 'a', orderNumber: '#1', sequence: 2, shippedAt: '2026-07-07' }),
        shipment({ orderId: 'b', orderNumber: '#2', shippedAt: '2026-07-07' }),
        shipment({ orderId: 'c', orderNumber: '#3', shippedAt: '2026-07-07', currency: 'CAD' }),
      ],
      { grouping: 'day' }
    )

    expect(result.footer).toEqual({
      postings: 2,
      shipments: 3,
      orders: 2,
      excluded: 1,
      totalMinor: 30_000,
    })
  })

  it('reports an empty range as an empty plan rather than refusing', () => {
    expect(plan([])).toEqual({
      grouping: 'day',
      groups: [],
      exclusions: [],
      footer: { postings: 0, shipments: 0, orders: 0, excluded: 0, totalMinor: 0 },
    })
  })

  it('carries the grouping it was asked for', () => {
    expect(plan([], { grouping: 'week' }).grouping).toBe('week')
  })
})

describe('what the plan does NOT know', () => {
  // 🛑 The netting read decides what is unposted (a null stamp, a `reversed`
  // posting, or a stamp pointing at a posting that no longer exists). The plan
  // sees only shipments, so a shipment that came back BECAUSE its posting was
  // reversed is planned exactly like a never-posted one - which is what makes
  // "reverse a day and it comes back on the next preview" work.
  it('plans a re-offered shipment identically to a fresh one', () => {
    const fresh = plan([shipment({ orderId: 'a', orderNumber: '#1' })])
    const reoffered = plan([shipment({ orderId: 'a', orderNumber: '#1' })])

    expect(reoffered).toEqual(fresh)
  })
})

describe('gatewayRoutes (brief 13 §5.3)', () => {
  const authNetRoute: GatewayRoute = {
    handles: ['authorize_net', 'authorize.net'],
    clearingGlAccountId: 'acct_authnet_clearing',
    active: false,
  }

  it('debits a payment_gateway route instead of the role default when exactly one route matches', () => {
    const result = plan(
      [shipment({ orderId: 'a', orderNumber: '#1', gateways: ['Authorize.Net'] })],
      { gatewayRoutes: [authNetRoute] }
    )

    const posted = result.groups[0]?.shipments[0]
    expect(posted?.amounts.debitRole).toBe('gateway')
    expect(posted?.amounts.debitGlAccountId).toBe('acct_authnet_clearing')
    // The role buckets stay zero; the id-based debit is counted under `gateway`.
    expect(result.groups[0]?.totals.byDebitRole).toEqual({
      clearing_card: 0,
      clearing_affirm: 0,
      accounts_receivable: 0,
      gateway: 10_000,
    })
  })

  it('a closed route still routes its own history (active does not gate the match)', () => {
    const result = plan(
      [shipment({ orderId: 'a', orderNumber: '#1', gateways: ['authorize_net'] })],
      { gatewayRoutes: [authNetRoute] }
    )
    expect(result.groups[0]?.shipments[0]?.amounts.debitGlAccountId).toBe('acct_authnet_clearing')
  })

  it('falls back to the role default when no route names the gateway', () => {
    const result = plan([shipment({ orderId: 'a', orderNumber: '#1' })], {
      gatewayRoutes: [authNetRoute],
    })
    const posted = result.groups[0]?.shipments[0]
    expect(posted?.amounts.debitRole).toBe('clearing_card')
    expect(posted?.amounts.debitGlAccountId).toBeUndefined()
  })

  it('omitting gatewayRoutes entirely reproduces the role-only plan', () => {
    const withRoutes = plan([shipment({ orderId: 'a', orderNumber: '#1' })], { gatewayRoutes: [] })
    const withoutRoutes = plan([shipment({ orderId: 'a', orderNumber: '#1' })])
    expect(withRoutes).toEqual(withoutRoutes)
  })
})
