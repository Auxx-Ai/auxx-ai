// packages/lib/src/accounting/money/payouts/__tests__/match-entries.test.ts
import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { assessProcessorEntries, type MatchableProcessorEntry } from '../match-entries'

function database(results: unknown[][]) {
  const select = vi.fn(() => {
    const rows = results.shift()
    if (!rows) throw new Error('Unexpected extra query')
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
      then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve),
    }
    return chain
  })
  return { db: { select } as unknown as Database }
}

const sourceAccount = { providerKey: 'shopify', externalAccountId: 'store', environment: 'live' }
const reference = {
  sourceAccount,
  objectType: 'order_transaction',
  externalId: 'txn-1',
  componentKey: '',
}
const entry = (overrides: Partial<MatchableProcessorEntry> = {}): MatchableProcessorEntry => ({
  id: 'entry-1',
  sourceAccountId: 'feed',
  sourceReference: reference,
  type: 'charge',
  grossMinor: 10000n,
  currency: 'USD',
  currencyExponent: 2,
  ...overrides,
})
const candidate = (id: string, overrides: Record<string, unknown> = {}) => ({
  object: { objectType: 'order_transaction', externalId: 'txn-1', componentKey: '' },
  account: { ...sourceAccount, paymentGatewayId: 'rail-sp' },
  money: {
    id,
    amountMinor: 10000n,
    currency: 'USD',
    currencyExponent: 2,
    purpose: 'customer_receipt',
  },
  ...overrides,
})
const gateways = [{ id: 'feed', paymentGatewayId: 'rail-sp' }]

describe('assessProcessorEntries near misses', () => {
  it('matches when every check passes', async () => {
    const { db } = database([gateways, [candidate('mt-1')]])
    const outcome = await assessProcessorEntries(db, 'org', [entry()])
    expect(outcome.matches.get('entry-1')).toBe('mt-1')
    expect(outcome.refusals.has('entry-1')).toBe(false)
  })

  it('keeps the one candidate whose amount differs', async () => {
    const near = candidate('mt-1')
    near.money.amountMinor = 9500n
    const { db } = database([gateways, [near]])
    const outcome = await assessProcessorEntries(db, 'org', [entry()])
    expect(outcome.refusals.get('entry-1')).toEqual({
      reason: 'amount_differs',
      candidateMoneyTransactionId: 'mt-1',
    })
  })

  it('keeps the one candidate whose rail differs', async () => {
    const near = candidate('mt-1')
    near.account.paymentGatewayId = 'rail-affirm'
    const { db } = database([gateways, [near]])
    const outcome = await assessProcessorEntries(db, 'org', [entry()])
    expect(outcome.refusals.get('entry-1')).toEqual({
      reason: 'rail_differs',
      candidateMoneyTransactionId: 'mt-1',
    })
  })

  it("matches on the receipt's own gateway when its store account has none", async () => {
    const receipt = candidate('mt-1')
    receipt.account.paymentGatewayId = null as unknown as string
    Object.assign(receipt.money, { paymentGatewayId: 'rail-sp' })
    const { db } = database([gateways, [receipt]])
    const outcome = await assessProcessorEntries(db, 'org', [entry()])
    expect(outcome.matches.get('entry-1')).toBe('mt-1')
  })

  it("prefers the receipt's own gateway over its account's", async () => {
    const receipt = candidate('mt-1')
    Object.assign(receipt.money, { paymentGatewayId: 'rail-affirm' })
    const { db } = database([gateways, [receipt]])
    const outcome = await assessProcessorEntries(db, 'org', [entry()])
    expect(outcome.refusals.get('entry-1')).toEqual({
      reason: 'rail_differs',
      candidateMoneyTransactionId: 'mt-1',
    })
  })

  it('refuses two candidates that each fail a different check', async () => {
    const wrongAmount = candidate('mt-1')
    wrongAmount.money.amountMinor = 9500n
    const wrongRail = candidate('mt-2')
    wrongRail.account = { ...sourceAccount, paymentGatewayId: 'rail-affirm' }
    const { db } = database([gateways, [wrongAmount, wrongRail]])
    const outcome = await assessProcessorEntries(db, 'org', [entry()])
    expect(outcome.refusals.get('entry-1')).toEqual({ reason: 'ambiguous' })
  })

  it('refuses two candidates that both pass every check', async () => {
    const { db } = database([gateways, [candidate('mt-1'), candidate('mt-2')]])
    const outcome = await assessProcessorEntries(db, 'org', [entry()])
    expect(outcome.refusals.get('entry-1')).toEqual({ reason: 'ambiguous' })
  })

  it('says no receipt when the reference names nothing recorded yet', async () => {
    const { db } = database([gateways, []])
    const outcome = await assessProcessorEntries(db, 'org', [entry()])
    expect(outcome.refusals.get('entry-1')).toEqual({ reason: 'no_receipt' })
  })

  it('says no receipt when the only candidate settles the other purpose', async () => {
    const refundReceipt = candidate('mt-1')
    refundReceipt.money.purpose = 'customer_refund'
    const { db } = database([gateways, [refundReceipt]])
    const outcome = await assessProcessorEntries(db, 'org', [entry()])
    expect(outcome.refusals.get('entry-1')).toEqual({ reason: 'no_receipt' })
  })

  it('says no rail for a feed with no payment gateway, before looking at candidates', async () => {
    const { db } = database([[], [candidate('mt-1')]])
    const outcome = await assessProcessorEntries(db, 'org', [entry()])
    expect(outcome.refusals.get('entry-1')).toEqual({ reason: 'no_rail' })
  })

  it('says no reference when the item carries none', async () => {
    const { db } = database([])
    const outcome = await assessProcessorEntries(db, 'org', [entry({ sourceReference: null })])
    expect(outcome.refusals.get('entry-1')).toEqual({ reason: 'no_reference' })
    expect(outcome.matches.size).toBe(0)
  })

  // 91 D8, trap #11: `type` is free text; a chargeback is money leaving, so it is a refund.
  it('matches a dispute to the customer refund it moved, by the absolute amount', async () => {
    const chargeback = candidate('mt-1')
    chargeback.money.purpose = 'customer_refund'
    const { db } = database([gateways, [chargeback]])
    const outcome = await assessProcessorEntries(db, 'org', [
      entry({ type: 'dispute', grossMinor: -10000n }),
    ])
    expect(outcome.matches.get('entry-1')).toBe('mt-1')
  })

  it('never matches a dispute to a receipt', async () => {
    const { db } = database([gateways, [candidate('mt-1')]])
    const outcome = await assessProcessorEntries(db, 'org', [
      entry({ type: 'dispute', grossMinor: -10000n }),
    ])
    expect(outcome.refusals.get('entry-1')).toEqual({ reason: 'no_receipt' })
  })

  it('has nothing to say about a fee', async () => {
    const { db } = database([])
    const outcome = await assessProcessorEntries(db, 'org', [entry({ type: 'fee' })])
    expect(outcome.refusals.size).toBe(0)
  })
})
