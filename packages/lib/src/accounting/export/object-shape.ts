// packages/lib/src/accounting/export/object-shape.ts
// Turn one posted candidate row + its lines into the native provider object its
// posting type maps to (plan 67 §1-2), or fall back to `journal` when its lines
// do not fit that object's shape. PURE - no db, no io; the caller resolves line
// roles and the counterparty and passes them in.

import type { AccountRole } from '../ledger/builders/entry'
import type { CounterpartyType, PostingDirection, PostingType } from '../ledger/types'
import { BILL_OBJECT_TYPE, type ExportBillPayload, exportBillSchema } from './payloads/bill'
import {
  CREDIT_MEMO_OBJECT_TYPE,
  type ExportCreditMemoPayload,
  exportCreditMemoSchema,
} from './payloads/credit-memo'
import {
  DEPOSIT_OBJECT_TYPE,
  type ExportDepositPayload,
  exportDepositSchema,
} from './payloads/deposit'
import {
  type ExportInvoicePayload,
  exportInvoiceSchema,
  INVOICE_OBJECT_TYPE,
} from './payloads/invoice'
import {
  type ExportJournalPayload,
  exportJournalSchema,
  JOURNAL_OBJECT_TYPE,
} from './payloads/journal'
import {
  type ExportPaymentPayload,
  exportPaymentSchema,
  PAYMENT_OBJECT_TYPE,
} from './payloads/payment'
import {
  type ExportRefundReceiptPayload,
  exportRefundReceiptSchema,
  REFUND_RECEIPT_OBJECT_TYPE,
} from './payloads/refund-receipt'
import {
  type ExportSalesReceiptPayload,
  exportSalesReceiptSchema,
  SALES_RECEIPT_OBJECT_TYPE,
} from './payloads/sales-receipt'

/** `auxx:gl:<type>:<date>:<id>` - the stamp a human greps the provider's register for. */
function stamp(parts: string[], memo?: string): string {
  const composed = memo ? `${parts.join(':')} ${memo}` : parts.join(':')
  return composed.slice(0, 4000)
}

export interface ShapeForPostingLine {
  glAccountId: string
  accountCode: string | null
  direction: PostingDirection
  amountMinor: number
  memo?: string | null
  sortOrder: number
  counterparty?: { type: CounterpartyType; id: string }
}

export interface ShapeForPostingCandidate {
  id: string
  postingType: PostingType
  txnDate: string
  docNumber: string
  totalMinor: number
  currency: string
  storeId: string | null
  railId: string | null
  /** The built entry's own memo, appended to the `auxx:gl:…` stamp. */
  memo?: string
}

export interface ShapeForPostingInput {
  posting: ShapeForPostingCandidate
  /** This document's lines - for a fully-paid `auto` fulfillment, the fulfillment's AND its absorbed receipts' (D1). */
  lines: ShapeForPostingLine[]
  /** Each line's account role, resolved by the caller. */
  roleByGlAccountId: Map<string, AccountRole | null>
  /** OURS, never a provider id - frozen on the receivable/payable line at post time. */
  counterparty: { type: CounterpartyType; id: string } | null
  /** The posting's store's `FinancialSourceAccount.exportShape`. `'auto'` when there is no store. */
  exportShape: 'auto' | 'invoice'
  /** Only meaningful for a `fulfillment` - see {@link wantsSalesReceipt}. */
  fullyPaidAtShipment?: boolean
  /** A `payment` payload's `appliesTo.glPostingId` - the invoice/fulfillment posting it settles. */
  appliesToGlPostingId?: string
}

export interface ShapedPosting {
  objectType: string
  payload: Record<string, unknown>
  /** Set only when the shape fell back to `journal` because its lines did not fit its native object. */
  fallbackReason?: string
}

interface RoledLine extends ShapeForPostingLine {
  role: AccountRole | null
}

/** T14/D1: whether a fulfillment should ship as a Sales Receipt rather than an Invoice. */
export function wantsSalesReceipt(
  exportShape: 'auto' | 'invoice',
  fullyPaidAtShipment: boolean | undefined
): boolean {
  return exportShape !== 'invoice' && fullyPaidAtShipment === true
}

const MONEY_ROLES: ReadonlySet<string> = new Set(['bank', 'clearing', 'undeposited_funds'])

function roled(input: ShapeForPostingInput): RoledLine[] {
  return input.lines.map((line) => ({
    ...line,
    role: input.roleByGlAccountId.get(line.glAccountId) ?? null,
  }))
}

function glRef(line: RoledLine) {
  return { glAccountId: line.glAccountId, accountCode: line.accountCode }
}

function toItemLines(lines: RoledLine[]) {
  return lines.map((line, index) => ({
    glAccountId: line.glAccountId,
    accountCode: line.accountCode,
    amountMinor: line.amountMinor,
    sortOrder: index,
    ...(line.memo ? { memo: line.memo } : {}),
    ...(line.role === 'sales_tax_payable' ? { taxCode: 'NON' as const } : {}),
  }))
}

function findMoneyLeg(lines: RoledLine[], direction: PostingDirection): RoledLine | undefined {
  return lines.find(
    (line) => line.direction === direction && line.role && MONEY_ROLES.has(line.role)
  )
}

function base(posting: ShapeForPostingCandidate) {
  return {
    v: 1 as const,
    txnDate: posting.txnDate,
    docNumber: posting.docNumber,
    privateNote: stamp(
      ['auxx', 'gl', posting.postingType, posting.txnDate, posting.id],
      posting.memo
    ),
    currency: 'USD' as const,
    totalMinor: posting.totalMinor,
  }
}

/** Always representable, always correct books - the shape every other builder falls back to. */
function buildJournal(input: ShapeForPostingInput): ShapedPosting {
  const lines = roled(input)
  const payload = exportJournalSchema.parse({
    ...base(input.posting),
    lines: lines.map((line) => ({
      glAccountId: line.glAccountId,
      accountCode: line.accountCode,
      direction: line.direction,
      amountMinor: line.amountMinor,
      sortOrder: line.sortOrder,
      ...(line.memo ? { memo: line.memo } : {}),
      ...(line.counterparty ? { counterparty: line.counterparty } : {}),
    })),
  } satisfies ExportJournalPayload)
  return { objectType: JOURNAL_OBJECT_TYPE, payload }
}

/** A native shape's lines did not fit - correct books over a refusal (plan 67 §2). */
function fallbackToJournal(input: ShapeForPostingInput, reason: string): ShapedPosting {
  return { ...buildJournal(input), fallbackReason: reason }
}

function shapeSalesReceipt(input: ShapeForPostingInput): ShapedPosting {
  const lines = roled(input)
  const moneyLeg = findMoneyLeg(lines, 'debit')
  // Merged lines from the fulfillment AND its receipt(s) (D1): AR appears on
  // BOTH sides (the fulfillment's debit, the receipt's credit) and nets to
  // nothing a SalesReceipt records, so it is implicit on either side.
  const itemLines = lines.filter(
    (line) => line.direction === 'credit' && line.role !== 'accounts_receivable'
  )
  const unclassifiedDebits = lines.filter(
    (line) => line.direction === 'debit' && line.role !== 'accounts_receivable' && line !== moneyLeg
  )
  if (!moneyLeg || itemLines.length === 0 || unclassifiedDebits.length > 0) {
    return fallbackToJournal(
      input,
      'A sales receipt needs a bank/clearing deposit line and at least one revenue line'
    )
  }
  const payload = exportSalesReceiptSchema.parse({
    ...base(input.posting),
    customer: input.counterparty,
    storeId: input.posting.storeId,
    lines: toItemLines(itemLines),
    depositTo: glRef(moneyLeg),
  } satisfies ExportSalesReceiptPayload)
  return { objectType: SALES_RECEIPT_OBJECT_TYPE, payload }
}

function shapeInvoice(input: ShapeForPostingInput): ShapedPosting {
  const lines = roled(input)
  const itemLines = lines.filter((line) => line.direction === 'credit')
  const arLine = lines.find(
    (line) => line.direction === 'debit' && line.role === 'accounts_receivable'
  )
  const otherDebits = lines.filter((line) => line.direction === 'debit' && line !== arLine)
  if (itemLines.length === 0 || !arLine || otherDebits.length > 0 || !input.counterparty) {
    return fallbackToJournal(
      input,
      'An invoice needs a customer, an accounts-receivable debit and at least one revenue line'
    )
  }
  const payload = exportInvoiceSchema.parse({
    ...base(input.posting),
    customer: input.counterparty,
    storeId: input.posting.storeId,
    lines: toItemLines(itemLines),
  } satisfies ExportInvoicePayload)
  return { objectType: INVOICE_OBJECT_TYPE, payload }
}

function shapePayment(input: ShapeForPostingInput): ShapedPosting {
  const lines = roled(input)
  const moneyLeg = findMoneyLeg(lines, 'debit')
  const arLine = lines.find(
    (line) => line.direction === 'credit' && line.role === 'accounts_receivable'
  )
  const others = lines.filter((line) => line !== moneyLeg && line !== arLine)
  if (
    !moneyLeg ||
    !arLine ||
    others.length > 0 ||
    !input.counterparty ||
    !input.appliesToGlPostingId
  ) {
    return fallbackToJournal(
      input,
      'A payment needs a customer, a bank/clearing debit, an accounts-receivable credit and the invoice it applies to'
    )
  }
  const payload = exportPaymentSchema.parse({
    ...base(input.posting),
    customer: input.counterparty,
    appliesTo: { glPostingId: input.appliesToGlPostingId },
    amountMinor: input.posting.totalMinor,
    depositTo: glRef(moneyLeg),
  } satisfies ExportPaymentPayload)
  return { objectType: PAYMENT_OBJECT_TYPE, payload }
}

function shapeCreditMemo(input: ShapeForPostingInput): ShapedPosting {
  const lines = roled(input)
  const itemLines = lines.filter((line) => line.direction === 'debit')
  const arLine = lines.find(
    (line) => line.direction === 'credit' && line.role === 'accounts_receivable'
  )
  const otherCredits = lines.filter((line) => line.direction === 'credit' && line !== arLine)
  if (itemLines.length === 0 || !arLine || otherCredits.length > 0 || !input.counterparty) {
    return fallbackToJournal(
      input,
      'A credit memo needs a customer, an accounts-receivable credit and at least one contra-revenue debit'
    )
  }
  const payload = exportCreditMemoSchema.parse({
    ...base(input.posting),
    customer: input.counterparty,
    lines: toItemLines(itemLines),
  } satisfies ExportCreditMemoPayload)
  return { objectType: CREDIT_MEMO_OBJECT_TYPE, payload }
}

function shapeRefundReceipt(input: ShapeForPostingInput): ShapedPosting {
  const lines = roled(input)
  const moneyLeg = findMoneyLeg(lines, 'credit')
  const itemLines = lines.filter((line) => line.direction === 'debit')
  const otherCredits = lines.filter((line) => line.direction === 'credit' && line !== moneyLeg)
  if (itemLines.length === 0 || !moneyLeg || otherCredits.length > 0 || !input.counterparty) {
    return fallbackToJournal(
      input,
      'A refund receipt needs a customer, a returns debit and a bank/clearing credit'
    )
  }
  const payload = exportRefundReceiptSchema.parse({
    ...base(input.posting),
    customer: input.counterparty,
    lines: toItemLines(itemLines),
    paidFrom: glRef(moneyLeg),
  } satisfies ExportRefundReceiptPayload)
  return { objectType: REFUND_RECEIPT_OBJECT_TYPE, payload }
}

function shapeDeposit(input: ShapeForPostingInput): ShapedPosting {
  const lines = roled(input)
  const bankLeg = lines.find((line) => line.direction === 'debit' && line.role === 'bank')
  const feeLine = lines.find(
    (line) => line.direction === 'debit' && line.role === 'payment_processing_fees'
  )
  const sourceLines = lines.filter(
    (line) =>
      line.direction === 'credit' && (line.role === 'clearing' || line.role === 'undeposited_funds')
  )
  const otherDebits = lines.filter(
    (line) => line.direction === 'debit' && line !== bankLeg && line !== feeLine
  )
  const otherCredits = lines.filter(
    (line) => line.direction === 'credit' && !sourceLines.includes(line)
  )
  if (!bankLeg || sourceLines.length === 0 || otherDebits.length > 0 || otherCredits.length > 0) {
    return fallbackToJournal(
      input,
      'A deposit needs a bank debit and at least one clearing/undeposited-funds credit'
    )
  }
  const depositLines = [
    ...sourceLines.map((line) => ({
      fromAccount: glRef(line),
      amountMinor: line.amountMinor,
      ...(line.memo ? { memo: line.memo } : {}),
    })),
    ...(feeLine
      ? [
          {
            fromAccount: glRef(feeLine),
            amountMinor: -feeLine.amountMinor,
            ...(feeLine.memo ? { memo: feeLine.memo } : {}),
          },
        ]
      : []),
  ]
  const payload = exportDepositSchema.parse({
    ...base(input.posting),
    // The posting's own `totalMinor` is the entry's GROSS balancing total (Dr
    // bank + Dr fees); a Deposit's total is what actually lands in the bank -
    // the NET the signed lines sum to. Equal to `posting.totalMinor` whenever
    // there is no fee line (a plain `bank_deposit`).
    totalMinor: bankLeg.amountMinor,
    depositTo: glRef(bankLeg),
    lines: depositLines,
  } satisfies ExportDepositPayload)
  return { objectType: DEPOSIT_OBJECT_TYPE, payload }
}

function shapeBill(input: ShapeForPostingInput): ShapedPosting {
  const lines = roled(input)
  const expenseLines = lines.filter((line) => line.direction === 'debit')
  const apLine = lines.find(
    (line) => line.direction === 'credit' && line.role === 'accounts_payable'
  )
  const otherCredits = lines.filter((line) => line.direction === 'credit' && line !== apLine)
  const vendor = input.counterparty
  if (
    expenseLines.length === 0 ||
    !apLine ||
    otherCredits.length > 0 ||
    !vendor ||
    vendor.type !== 'vendor'
  ) {
    return fallbackToJournal(
      input,
      'A bill needs a vendor, an accounts-payable credit and at least one expense debit'
    )
  }
  const payload = exportBillSchema.parse({
    ...base(input.posting),
    vendor,
    lines: expenseLines.map((line) => ({
      glAccountId: line.glAccountId,
      accountCode: line.accountCode,
      amountMinor: line.amountMinor,
      ...(line.memo ? { memo: line.memo } : {}),
    })),
  } satisfies ExportBillPayload)
  return { objectType: BILL_OBJECT_TYPE, payload }
}

/**
 * Turn one posting into its native provider object, or `journal` (plan 67 §2).
 *
 * `posting.postingType` decides the candidate shape (§1's mapping table); each
 * shape then classifies its own lines by role and falls back to `journal`,
 * with a reason, the moment a line does not fit - never a refusal.
 */
export function shapeForPosting(input: ShapeForPostingInput): ShapedPosting {
  switch (input.posting.postingType) {
    case 'fulfillment':
      return wantsSalesReceipt(input.exportShape, input.fullyPaidAtShipment)
        ? shapeSalesReceipt(input)
        : shapeInvoice(input)
    case 'invoice_issued':
      return shapeInvoice(input)
    case 'payment':
    case 'deposit_application':
      return shapePayment(input)
    case 'credit_memo':
      return shapeCreditMemo(input)
    case 'refund':
      return shapeRefundReceipt(input)
    case 'payout':
    case 'bank_deposit':
      return shapeDeposit(input)
    case 'expense_bill':
    case 'vendor_bill':
      return shapeBill(input)
    // write_off, manual_journal, recurring_journal, inventory_movement and the
    // month-end types have no native shape (§1's table) - a plain journal, not
    // a fallback: nothing here was tried and rejected.
    default:
      return buildJournal(input)
  }
}
