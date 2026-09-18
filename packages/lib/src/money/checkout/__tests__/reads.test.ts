// packages/lib/src/money/checkout/__tests__/reads.test.ts
//
// A quote deposit is money with nothing to relieve yet, so "held" is the receipt minus
// whatever an invoice has since taken off it. These pin that arithmetic, including the
// `unapply` row that gives held money back.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  receipts: [] as Record<string, unknown>[],
  applications: [] as Record<string, unknown>[],
}))

vi.mock('@auxx/database', () => ({
  database: {},
  schema: new Proxy(
    {},
    { get: (_t, table) => new Proxy({}, { get: (_x, col) => `${String(table)}.${String(col)}` }) }
  ),
}))
vi.mock('drizzle-orm', () => ({
  and: () => undefined,
  eq: () => undefined,
  inArray: () => undefined,
  sql: Object.assign(() => undefined, { raw: () => undefined }),
}))
vi.mock('../../../cache', () => ({ getOrgCache: () => ({ get: async () => 'user-system' }) }))
vi.mock('../../../resources/crud', () => ({ UnifiedCrudHandler: class {} }))
vi.mock('../../../payment-gateways/reads', () => ({ listPaymentGateways: async () => ({}) }))
vi.mock('../../payouts/stripe-account', () => ({ getPaymentAccount: async () => null }))
vi.mock('../../public-token', () => ({ isPaymentsConnected: () => false }))

const { sumQuoteDeposits } = await import('../reads')

/** Chainable select stub that resolves to the deposit receipts. */
function db() {
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'innerJoin', 'where', 'limit']) chain[key] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(h.receipts).then(resolve)
  return {
    select: () => chain,
    query: { MoneyApplication: { findMany: async () => h.applications } },
  } as never
}

beforeEach(() => {
  h.receipts = [
    {
      id: 'mt_1',
      amountMinor: 10_000n,
      occurredAt: new Date('2026-09-01T00:00:00Z'),
      occurredOn: null,
      reference: 'pi_1',
      snapshot: { workOrderInstanceId: 'wo_1' },
    },
  ]
  h.applications = []
})

describe('what a quote still holds', () => {
  it('holds the whole receipt while nothing has claimed it', async () => {
    expect(await sumQuoteDeposits(db(), 'org_1', 'quote_1')).toEqual({
      heldMinor: 10_000,
      appliedMinor: 0,
    })
  })

  it('moves the applied part out of held', async () => {
    h.applications = [{ moneyTransactionId: 'mt_1', operation: 'apply', amountMinor: 4_000n }]
    expect(await sumQuoteDeposits(db(), 'org_1', 'quote_1')).toEqual({
      heldMinor: 6_000,
      appliedMinor: 4_000,
    })
  })

  it('gives held money back when the application is unapplied', async () => {
    h.applications = [
      { moneyTransactionId: 'mt_1', operation: 'apply', amountMinor: 4_000n },
      { moneyTransactionId: 'mt_1', operation: 'unapply', amountMinor: 4_000n },
    ]
    expect(await sumQuoteDeposits(db(), 'org_1', 'quote_1')).toEqual({
      heldMinor: 10_000,
      appliedMinor: 0,
    })
  })

  it('is zero for a quote that never collected one', async () => {
    h.receipts = []
    expect(await sumQuoteDeposits(db(), 'org_1', 'quote_1')).toEqual({
      heldMinor: 0,
      appliedMinor: 0,
    })
  })
})
