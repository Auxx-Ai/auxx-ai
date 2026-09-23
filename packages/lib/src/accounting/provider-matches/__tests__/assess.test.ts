// packages/lib/src/accounting/provider-matches/__tests__/assess.test.ts

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import type { AccountingProvider, ProviderTransactionLinks } from '../../providers/provider'

const state = vi.hoisted(() => ({
  entries: [] as unknown[],
  document: null as { sourceKind: string; sourceId: string } | null,
  receipts: [] as string[],
  sent: false,
  rail: null as string | null,
  payouts: [] as string[],
  record: vi.fn(),
  write: vi.fn(),
}))

vi.mock('../reads', () => ({
  listEntriesToAssess: async () => state.entries,
  findOurSentDocument: async () => state.document,
  listReceiptsOnInvoice: async () => state.receipts,
  isSubjectSent: async () => state.sent,
  railOfClearingAccount: async () => state.rail,
  listPayoutCandidates: async () => state.payouts,
}))
vi.mock('../writes', () => ({ writeProviderMatch: state.write }))
vi.mock('../../money/invoice-payments/record-payment', () => ({
  recordInvoicePayment: state.record,
}))
vi.mock('../../../cache', () => ({ getOrgCache: () => ({ get: async () => 'system_user' }) }))

import { assessProviderMatches } from '../assess'

const db = {} as Database

function entry(txnType: string) {
  return {
    id: `entry_${txnType}`,
    providerTxnType: txnType,
    providerTxnId: '401',
    txnDate: '2026-09-22',
    docNumber: 'PROBE-102-A',
    lines: [
      { providerAccountId: '129', direction: 'debit' as const, amountMinor: 10000 },
      { providerAccountId: '1100', direction: 'credit' as const, amountMinor: 10000 },
    ],
  }
}

function provider(links: ProviderTransactionLinks | null): AccountingProvider {
  return { readTransactionLinks: async () => ok(links) } as unknown as AccountingProvider
}

const PAID_OUR_INVOICE: ProviderTransactionLinks = {
  linked: [{ txnType: 'Invoice', txnId: '400' }],
  codedLines: [],
}

async function assess(links: ProviderTransactionLinks | null) {
  const result = await assessProviderMatches(db, 'org_1', {
    bookId: 'book_1',
    from: '2026-09-01',
    to: '2026-09-30',
    provider: provider(links),
    glAccountIdByProviderId: new Map([['1150040092', 'gl_clearing']]),
  })
  return { outcome: result._unsafeUnwrap(), written: state.write.mock.calls[0]?.[3] }
}

beforeEach(() => {
  state.entries = [entry('Payment')]
  state.document = { sourceKind: 'invoice', sourceId: 'inv_1' }
  state.receipts = []
  state.sent = false
  state.rail = null
  state.payouts = []
  state.record.mockReset()
  state.write.mockReset()
})

describe('a provider Payment', () => {
  it('adopts a payment on our invoice when no receipt of ours exists, marking the movement', async () => {
    state.record.mockResolvedValue({ moneyTransactionId: 'mt_new', moneyApplicationId: 'app_1' })
    const { outcome, written } = await assess(PAID_OUR_INVOICE)
    expect(state.record).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        invoiceInstanceId: 'inv_1',
        amountMinor: 10000,
        date: '2026-09-22',
        providerLedgerEntryId: 'entry_Payment',
        commandKey: 'provider-match:entry_Payment',
      })
    )
    expect(written).toEqual({
      state: 'matched',
      reason: 'adopted',
      kind: 'money_transaction',
      matchedId: 'mt_new',
    })
    expect(outcome.adopted).toBe(1)
  })

  it('suggests keeping theirs when our receipt for the same amount has not been sent', async () => {
    state.receipts = ['mt_ours']
    const { written } = await assess(PAID_OUR_INVOICE)
    expect(state.record).not.toHaveBeenCalled()
    expect(written).toMatchObject({
      state: 'suggested',
      reason: 'ours_unsent',
      matchedId: 'mt_ours',
    })
  })

  it('suggests a duplicate when our receipt already left', async () => {
    state.receipts = ['mt_ours']
    state.sent = true
    const { written } = await assess(PAID_OUR_INVOICE)
    expect(written).toMatchObject({ state: 'suggested', reason: 'duplicate_sent' })
  })

  it('is not ours when the invoice it paid is not one we sent', async () => {
    state.document = null
    const { written } = await assess(PAID_OUR_INVOICE)
    expect(written).toEqual({ state: null, reason: 'not_ours' })
  })

  it('cannot adopt when our invoice refuses the amount, and says so rather than failing', async () => {
    state.record.mockRejectedValue(new UnprocessableEntityError('more than it owes'))
    const { written } = await assess(PAID_OUR_INVOICE)
    expect(written).toEqual({ state: 'unmatchable', reason: 'cannot_adopt' })
  })

  it('leaves an order invoice alone until orders are matched', async () => {
    state.document = { sourceKind: 'fulfillment', sourceId: 'ful_1' }
    const { written } = await assess(PAID_OUR_INVOICE)
    expect(written).toEqual({ state: 'unmatchable', reason: 'order_invoice' })
  })
})

describe('a provider Deposit', () => {
  const FEED_ADD: ProviderTransactionLinks = {
    linked: [],
    codedLines: [{ providerAccountId: '1150040092', amountMinor: 25000 }],
  }

  beforeEach(() => {
    state.entries = [entry('Deposit')]
  })

  it('is not ours when no line is coded to a rail clearing account', async () => {
    const { written } = await assess(FEED_ADD)
    expect(written).toEqual({ state: null, reason: 'not_ours' })
  })

  it('waits for a payout of ours when the rail has none of that amount yet', async () => {
    state.rail = 'rail_shopify'
    const { written } = await assess(FEED_ADD)
    expect(written).toEqual({ state: 'pending', reason: 'no_payout' })
  })

  it('suggests the one payout on that rail, amount and window as a duplicate once sent', async () => {
    state.rail = 'rail_shopify'
    state.payouts = ['payout_1']
    state.sent = true
    const { written } = await assess(FEED_ADD)
    expect(written).toEqual({
      state: 'suggested',
      reason: 'duplicate_sent',
      kind: 'payout',
      matchedId: 'payout_1',
    })
  })

  it('refuses to pick between two payouts', async () => {
    state.rail = 'rail_shopify'
    state.payouts = ['payout_1', 'payout_2']
    const { written } = await assess(FEED_ADD)
    expect(written).toEqual({ state: 'unmatchable', reason: 'ambiguous' })
  })
})
