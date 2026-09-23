// packages/lib/src/accounting/providers/quickbooks/transaction-links.ts
// How a provider-authored transaction names what it settles (brief 102 M3). The GeneralLedger
// report carries no `LinkedTxn`, so the matcher reads the object itself.

import type { ProviderTransactionLinks } from '../provider'
import type { QuickbooksToolContext } from './invoke-quickbooks-tool'

const TOOL_GET_PAYMENT = 'get_quickbooks_payment'
const TOOL_GET_DEPOSIT = 'get_quickbooks_deposit'
const TOOL_GET_BILL_PAYMENT = 'get_quickbooks_bill_payment'
const TOOL_GET_PURCHASE = 'get_quickbooks_purchase'

/** The GL report's labels for a BillPayment object (sandbox fixture). */
export const BILL_PAYMENT_TXN_TYPES = [
  'Bill Payment (Check)',
  'Bill Payment (Credit Card)',
] as const
/** The GL report's labels assumed to be a Purchase object; not yet probed live. */
export const PURCHASE_TXN_TYPES = [
  'Expense',
  'Cash Expense',
  'Check',
  'Credit Card Expense',
  'Credit Card Credit',
] as const

type LinkedTxn = { txnId: string; txnType: string }

interface PaymentOutput {
  linkedInvoiceIds?: string[]
}

interface DepositOutput {
  status: 'Found' | 'NotFound'
  lines?: Array<{
    amount: number
    accountId: string | null
    linkedTxns: LinkedTxn[]
  }>
}

type BillPaymentOutput =
  | { status: 'NotFound' }
  | {
      status: 'Found'
      vendorId: string | null
      lines?: Array<{ amount: number; linkedTxns: LinkedTxn[] }>
    }

type PurchaseOutput =
  | { status: 'NotFound' }
  | {
      status: 'Found'
      entityId: string | null
      entityType: 'Vendor' | 'Customer' | 'Employee' | null
      credit: boolean
    }

type LinkReader = (
  context: QuickbooksToolContext,
  txnId: string
) => Promise<ProviderTransactionLinks | null>

function toMinor(amount: number): number {
  return Math.round(amount * 100)
}

const readBillPayment: LinkReader = async (context, txnId) => {
  const payment = (await context.callTool(TOOL_GET_BILL_PAYMENT, {
    billPaymentId: txnId,
  })) as BillPaymentOutput
  if (payment.status !== 'Found') return null
  return {
    linked: (payment.lines ?? []).flatMap((line) =>
      line.linkedTxns.map((linked) => ({ ...linked, amountMinor: toMinor(line.amount) }))
    ),
    codedLines: [],
    vendorId: payment.vendorId,
  }
}

const readPurchase: LinkReader = async (context, txnId) => {
  const purchase = (await context.callTool(TOOL_GET_PURCHASE, {
    purchaseId: txnId,
  })) as PurchaseOutput
  if (purchase.status !== 'Found') return null
  // A card credit is money back from the vendor, never a payment to one.
  const paysVendor = purchase.entityType === 'Vendor' && !purchase.credit
  return { linked: [], codedLines: [], vendorId: paysVendor ? purchase.entityId : null }
}

/** Keyed by the report's transaction label, the spelling `ProviderLedgerEntry` stores. */
export const TRANSACTION_LINK_READERS: Record<string, LinkReader> = {
  Payment: async (context, txnId) => {
    const payment = (await context.callTool(TOOL_GET_PAYMENT, {
      paymentId: txnId,
    })) as PaymentOutput
    return {
      linked: (payment.linkedInvoiceIds ?? []).map((id) => ({ txnType: 'Invoice', txnId: id })),
      codedLines: [],
    }
  },
  Deposit: async (context, txnId) => {
    const deposit = (await context.callTool(TOOL_GET_DEPOSIT, {
      depositId: txnId,
    })) as DepositOutput
    if (deposit.status !== 'Found') return null
    const lines = deposit.lines ?? []
    return {
      linked: lines.flatMap((line) => line.linkedTxns),
      codedLines: lines.flatMap((line) =>
        line.accountId
          ? [{ providerAccountId: line.accountId, amountMinor: toMinor(line.amount) }]
          : []
      ),
    }
  },
  ...Object.fromEntries(BILL_PAYMENT_TXN_TYPES.map((label) => [label, readBillPayment])),
  ...Object.fromEntries(PURCHASE_TXN_TYPES.map((label) => [label, readPurchase])),
}
