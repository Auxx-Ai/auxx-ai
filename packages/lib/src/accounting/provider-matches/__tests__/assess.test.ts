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
  billPayments: [] as string[],
  vendorPayments: [] as string[],
  openBills: [] as string[],
  vendors: new Map<string, string>(),
  record: vi.fn(),
  recordVendor: vi.fn(),
  write: vi.fn(),
}))

vi.mock('../reads', () => ({
  listEntriesToAssess: async () => state.entries,
  findOurSentDocument: async () => state.document,
  listReceiptsOnInvoice: async () => state.receipts,
  isSubjectSent: async () => state.sent,
  railOfClearingAccount: async () => state.rail,
  listPayoutCandidates: async () => state.payouts,
  listVendorPaymentsOnBill: async () => state.billPayments,
  listVendorPaymentsToVendor: async () => state.vendorPayments,
  listOpenBillsForAmount: async () => state.openBills,
}))
vi.mock('../writes', () => ({ writeProviderMatch: state.write }))
vi.mock('../../money/invoice-payments/record-payment', () => ({
  recordInvoicePayment: state.record,
}))
vi.mock('../../money/vendor-payments/record-payment', () => ({
  recordVendorPayment: state.recordVendor,
}))
vi.mock('../../mirror/provider-vendors', () => ({
  resolveProviderVendors: async () => state.vendors,
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
  return {
    id: 'quickbooks',
    readTransactionLinks: async () => ok(links),
  } as unknown as AccountingProvider
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
  state.billPayments = []
  state.vendorPayments = []
  state.openBills = []
  state.vendors = new Map([['qbo_vendor_1', 'company_1']])
  state.record.mockReset()
  state.recordVendor.mockReset()
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
    expect(written).toEqual({
      state: 'unmatchable',
      reason: 'cannot_adopt',
      kind: 'invoice',
      matchedId: 'inv_1',
    })
  })

  it('names our invoice when several receipts of ours fit, so its drawer can show it', async () => {
    state.receipts = ['mt_a', 'mt_b']
    const { written } = await assess(PAID_OUR_INVOICE)
    expect(written).toEqual({
      state: 'unmatchable',
      reason: 'ambiguous',
      kind: 'invoice',
      matchedId: 'inv_1',
    })
  })

  it('names no invoice when the payment links several', async () => {
    const { written } = await assess({
      linked: [
        { txnType: 'Invoice', txnId: '400' },
        { txnType: 'Invoice', txnId: '404' },
      ],
      codedLines: [],
    })
    expect(written).toEqual({ state: 'unmatchable', reason: 'ambiguous' })
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

describe('a provider Bill Payment', () => {
  const PAID_OUR_BILL: ProviderTransactionLinks = {
    linked: [{ txnType: 'Bill', txnId: '500', amountMinor: 10000 }],
    codedLines: [],
    vendorId: 'qbo_vendor_1',
  }

  beforeEach(() => {
    state.entries = [entry('Bill Payment (Check)')]
    state.document = { sourceKind: 'vendor_bill', sourceId: 'bill_1' }
  })

  it('adopts a payment on our bill when no vendor payment of ours exists, marking the movement', async () => {
    state.recordVendor.mockResolvedValue({ moneyTransactionId: 'mt_new', moneyApplicationId: 'a' })
    const { outcome, written } = await assess(PAID_OUR_BILL)
    expect(state.recordVendor).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        vendorBillInstanceId: 'bill_1',
        amountMinor: 10000,
        date: '2026-09-22',
        providerLedgerEntryId: 'entry_Bill Payment (Check)',
        commandKey: 'provider-match:entry_Bill Payment (Check)',
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

  it('suggests keeping theirs when our vendor payment on the bill has not been sent', async () => {
    state.billPayments = ['mt_ours']
    const { written } = await assess(PAID_OUR_BILL)
    expect(state.recordVendor).not.toHaveBeenCalled()
    expect(written).toEqual({
      state: 'suggested',
      reason: 'ours_unsent',
      kind: 'money_transaction',
      matchedId: 'mt_ours',
    })
  })

  it('suggests a duplicate when our vendor payment already left', async () => {
    state.billPayments = ['mt_ours']
    state.sent = true
    const { written } = await assess(PAID_OUR_BILL)
    expect(written).toMatchObject({ state: 'suggested', reason: 'duplicate_sent' })
  })

  it('is ambiguous over several bills of ours, naming none', async () => {
    const { written } = await assess({
      ...PAID_OUR_BILL,
      linked: [...PAID_OUR_BILL.linked, { txnType: 'Bill', txnId: '501', amountMinor: 500 }],
    })
    expect(written).toEqual({ state: 'unmatchable', reason: 'ambiguous' })
    expect(state.recordVendor).not.toHaveBeenCalled()
  })

  it('is ambiguous when a vendor credit rides along, and names our one bill', async () => {
    const { written } = await assess({
      ...PAID_OUR_BILL,
      linked: [...PAID_OUR_BILL.linked, { txnType: 'VendorCredit', txnId: '77' }],
    })
    expect(written).toEqual({
      state: 'unmatchable',
      reason: 'ambiguous',
      kind: 'vendor_bill',
      matchedId: 'bill_1',
    })
  })

  it('cannot adopt when our bill refuses the amount, and names the bill', async () => {
    state.recordVendor.mockRejectedValue(new UnprocessableEntityError('more than it owes'))
    const { written } = await assess(PAID_OUR_BILL)
    expect(written).toEqual({
      state: 'unmatchable',
      reason: 'cannot_adopt',
      kind: 'vendor_bill',
      matchedId: 'bill_1',
    })
  })

  it('is not ours when the bill it paid is not one we sent', async () => {
    state.document = null
    const { written } = await assess(PAID_OUR_BILL)
    expect(written).toEqual({ state: null, reason: 'not_ours' })
  })
})

describe('a provider Purchase', () => {
  const TO_OUR_VENDOR: ProviderTransactionLinks = {
    linked: [],
    codedLines: [],
    vendorId: 'qbo_vendor_1',
  }

  beforeEach(() => {
    state.entries = [entry('Check')]
  })

  it('suggests our vendor payment to that vendor for the amount as a duplicate once sent', async () => {
    state.vendorPayments = ['mt_ours']
    state.sent = true
    const { written } = await assess(TO_OUR_VENDOR)
    expect(written).toEqual({
      state: 'suggested',
      reason: 'duplicate_sent',
      kind: 'money_transaction',
      matchedId: 'mt_ours',
    })
    expect(state.recordVendor).not.toHaveBeenCalled()
  })

  it('suggests the one open bill of that balance, never recording it on its own', async () => {
    state.openBills = ['bill_1']
    const { written } = await assess(TO_OUR_VENDOR)
    expect(written).toEqual({
      state: 'suggested',
      reason: 'pays_bill',
      kind: 'vendor_bill',
      matchedId: 'bill_1',
    })
    expect(state.recordVendor).not.toHaveBeenCalled()
  })

  it('refuses to pick between two open bills', async () => {
    state.openBills = ['bill_1', 'bill_2']
    const { written } = await assess(TO_OUR_VENDOR)
    expect(written).toEqual({ state: 'unmatchable', reason: 'ambiguous' })
  })

  it('waits for a candidate when nothing of ours fits yet', async () => {
    const { written } = await assess(TO_OUR_VENDOR)
    expect(written).toEqual({ state: 'pending', reason: 'no_candidate' })
  })

  it('is not ours when its vendor is no company of ours', async () => {
    state.vendors = new Map()
    const { written } = await assess(TO_OUR_VENDOR)
    expect(written).toEqual({ state: null, reason: 'not_ours' })
  })

  it('is not ours when it names no vendor', async () => {
    const { written } = await assess({ ...TO_OUR_VENDOR, vendorId: null })
    expect(written).toEqual({ state: null, reason: 'not_ours' })
  })
})
