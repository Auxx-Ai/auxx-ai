// packages/lib/src/money/types.ts

import type { RecordId } from '@auxx/types/resource'

/** Percent-of-subtotal vs flat-amount discount (mirrors `QUOTE_DISCOUNT_TYPE_OPTIONS`). */
export type DiscountType = 'percent' | 'amount'

/**
 * A single line item's contribution to document totals — the minimal shape
 * `computeDocumentTotals` needs (money MQ1 build spec §F.1).
 */
export interface LineForTotals {
  /** `qty * unitPrice` in integer cents, already computed (roundCents). `null` when `unitPrice` is null. */
  lineTotal: number | null
  taxable: boolean
}

/** Document-level billing inputs (the quote's own fields) driving discount + tax math. */
export interface DocumentBillingInputs {
  discountType?: DiscountType | null
  discountValue?: number | null
  /** Percent, e.g. `7.5` for 7.5%. */
  taxRate?: number | null
}

/** Computed document totals — mirrors the three stored quote fields. */
export interface DocumentTotals {
  subtotal: number
  discountAmount: number
  taxTotal: number
  total: number
}

/** Shared base for money mutations — always org/user scoped. */
export interface MoneyMutationInput {
  organizationId: string
  userId: string
}

/** Input for `markQuoteSent` / `approveQuote` / `declineQuote`. */
export interface QuoteLifecycleInput extends MoneyMutationInput {
  /** EntityInstance id of the quote (not the RecordId). */
  quoteInstanceId: string
}

/** Input for `createQuoteFromRequest`. */
export interface CreateQuoteFromRequestInput extends MoneyMutationInput {
  /** EntityInstance id of the source service request (not the RecordId). */
  requestInstanceId: string
}

/** Input for `convertQuoteToWorkOrder`. */
export interface ConvertQuoteToWorkOrderInput extends MoneyMutationInput {
  /** EntityInstance id of the quote (not the RecordId). */
  quoteInstanceId: string
}

/** Input for `reorderLines`. */
export interface ReorderLinesInput extends MoneyMutationInput {
  /** The quote (or work order) the lines belong to — context only, not required for the write. */
  documentRecordId?: RecordId
  /** EntityInstance ids of the line items, in their new order. */
  orderedLineInstanceIds: string[]
}

/**
 * Input for `recomputeTotals` — the delete-path + drift escape hatch (§F.2/§G.2), generalized
 * across quote/invoice (money MI1 build spec §G.1). The legacy quote-only shape (bare
 * `quoteInstanceId`, no `documentType`) is still accepted so existing call sites keep
 * compiling unchanged — it's treated as `documentType: 'quote'`.
 */
export interface RecomputeTotalsInput extends MoneyMutationInput {
  documentType?: 'quote' | 'invoice'
  /** EntityInstance id of the quote or invoice (not the RecordId). */
  documentInstanceId?: string
  /** @deprecated legacy shape — pass `documentInstanceId` + `documentType: 'quote'` instead. */
  quoteInstanceId?: string
}

/** How a payment was collected — mirrors `PAYMENT_METHOD_OPTIONS` (money MI1 build spec §B.2). */
export type PaymentMethod = 'cash' | 'check' | 'card' | 'bank' | 'other'

/** Input for `markInvoiceSent` / `voidInvoice` / `deleteInvoice` (§G.2/§G.4/§G.5). */
export interface InvoiceLifecycleInput extends MoneyMutationInput {
  /** EntityInstance id of the invoice (not the RecordId). */
  invoiceInstanceId: string
}

/** Input for `recordManualPayment` (money MI1 build spec §E.2). */
export interface RecordManualPaymentInput extends MoneyMutationInput {
  /** EntityInstance id of the invoice (not the RecordId). */
  invoiceInstanceId: string
  /** Integer cents (the MQ1 convention). */
  amount: number
  /** ISO date string (`yyyy-MM-dd`) — the date the payment was made (may be backdated). */
  date: string
  method: PaymentMethod
  reference?: string
  note?: string
}

/** Input for `deleteManualPayment` (§E.2). */
export interface DeleteManualPaymentInput extends MoneyMutationInput {
  /** `PaymentTransaction.id`. */
  transactionId: string
}

/** Input for `syncInvoicePaymentState` — the ledger → invoice mirror projection (§E.4). */
export interface SyncInvoicePaymentStateInput extends MoneyMutationInput {
  /** EntityInstance id of the invoice (not the RecordId). */
  invoiceInstanceId: string
}

/** Input for `listUninvoicedLines` (§G.3). */
export interface ListUninvoicedLinesInput extends MoneyMutationInput {
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
}

/** A work-order line not yet stamped onto any invoice — the gather dialog's row shape (§G.3). */
export interface UninvoicedLine {
  recordId: RecordId
  instanceId: string
  name: string
  description?: string
  qty: number
  unitPrice: number | null
  lineTotal: number | null
  taxable: boolean
  /** Plain-text bridge to `WorkOrderVisit` — undefined for job-set (non-visit) lines. */
  visitId?: string
}

/** Input for `createInvoiceFromWorkOrder` (§G.3). */
export interface CreateInvoiceFromWorkOrderInput extends MoneyMutationInput {
  /** EntityInstance id of the work order (not the RecordId). */
  workOrderInstanceId: string
  /** EntityInstance ids of the work-order lines to gather (whole-line only, decision 7). */
  lineInstanceIds: string[]
}

/** Result of `createInvoiceFromWorkOrder` — the records-view drawer-open convention. */
export interface CreateInvoiceFromWorkOrderResult {
  recordId: RecordId
  instanceId: string
}

/** Input for `deleteInvoiceLine` (§G.3). */
export interface DeleteInvoiceLineInput extends MoneyMutationInput {
  /** EntityInstance id of the line item (not the RecordId). */
  lineInstanceId: string
}
