// packages/lib/src/accounting/providers/quickbooks/__tests__/transaction-links.test.ts

import { describe, expect, it, vi } from 'vitest'
import type { QuickbooksToolContext } from '../invoke-quickbooks-tool'
import { TRANSACTION_LINK_READERS } from '../transaction-links'

function context(output: unknown) {
  const callTool = vi.fn(async () => output)
  return { context: { callTool } as unknown as QuickbooksToolContext, callTool }
}

const BILL_PAYMENT = {
  status: 'Found',
  id: '130',
  syncToken: '0',
  txnDate: '2026-09-22',
  docNumber: null,
  totalAmt: 125.5,
  vendorId: '56',
  payType: 'Check',
  bankAccountId: '35',
  creditCardAccountId: null,
  linkedTxns: [{ txnId: '120', txnType: 'Bill' }],
  lines: [
    { amount: 100.25, linkedTxns: [{ txnId: '120', txnType: 'Bill' }] },
    { amount: 25.25, linkedTxns: [{ txnId: '121', txnType: 'Bill' }] },
  ],
}

const PURCHASE = {
  status: 'Found',
  id: '140',
  syncToken: '0',
  txnDate: '2026-09-22',
  docNumber: '1042',
  totalAmt: 80,
  paymentType: 'Check',
  accountId: '35',
  entityId: '56',
  entityType: 'Vendor',
  credit: false,
  lines: [{ amount: 80, accountId: '7', itemId: null, linkedTxns: [] }],
}

describe('the Bill Payment reader', () => {
  it.each([
    'Bill Payment (Check)',
    'Bill Payment (Credit Card)',
  ])('reads %s as the bills each line paid, in minor units, and the vendor', async (label) => {
    const { context: ctx, callTool } = context(BILL_PAYMENT)
    const links = await TRANSACTION_LINK_READERS[label]!(ctx, '130')
    expect(callTool).toHaveBeenCalledWith('get_quickbooks_bill_payment', {
      billPaymentId: '130',
    })
    expect(links).toEqual({
      linked: [
        { txnId: '120', txnType: 'Bill', amountMinor: 10025 },
        { txnId: '121', txnType: 'Bill', amountMinor: 2525 },
      ],
      codedLines: [],
      vendorId: '56',
    })
  })

  it('reads nothing when the object is gone', async () => {
    const { context: ctx } = context({ status: 'NotFound' })
    expect(await TRANSACTION_LINK_READERS['Bill Payment (Check)']!(ctx, '130')).toBeNull()
  })
})

describe('the Purchase reader', () => {
  it.each([
    'Expense',
    'Cash Expense',
    'Check',
    'Credit Card Expense',
    'Credit Card Credit',
  ])('reads %s through the purchase tool', async (label) => {
    const { context: ctx, callTool } = context(PURCHASE)
    const links = await TRANSACTION_LINK_READERS[label]!(ctx, '140')
    expect(callTool).toHaveBeenCalledWith('get_quickbooks_purchase', { purchaseId: '140' })
    expect(links).toEqual({ linked: [], codedLines: [], vendorId: '56' })
  })

  it('names no vendor when paid to a customer or an employee', async () => {
    const { context: ctx } = context({ ...PURCHASE, entityType: 'Employee' })
    expect((await TRANSACTION_LINK_READERS.Expense!(ctx, '140'))?.vendorId).toBeNull()
  })

  it('names no vendor on a card credit: money back is never a payment', async () => {
    const { context: ctx } = context({ ...PURCHASE, credit: true })
    expect((await TRANSACTION_LINK_READERS['Credit Card Credit']!(ctx, '140'))?.vendorId).toBeNull()
  })

  it('reads nothing when the object is gone', async () => {
    const { context: ctx } = context({ status: 'NotFound' })
    expect(await TRANSACTION_LINK_READERS.Check!(ctx, '140')).toBeNull()
  })
})
