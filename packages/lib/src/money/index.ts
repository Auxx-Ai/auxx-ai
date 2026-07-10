// packages/lib/src/money/index.ts
//
// Server entrypoint for the money (quoting + invoicing) feature — totals engine, quote/
// invoice lifecycle mutations, convert-to-work-order, gather-uninvoiced, the payment ledger,
// and line reordering (money MQ1 build spec §F, MI1 build spec §E/§G). Functional +
// neverthrow-style, no model classes (dashboards module is the layout precedent, dispatch is
// the direct sibling for this feature).

export { convertQuoteToWorkOrder } from './convert-quote'
export { createInvoiceFromWorkOrder, deleteInvoiceLine, listUninvoicedLines } from './gather'
export { deleteInvoice, markInvoiceSent, voidInvoice } from './invoice-lifecycle'
export {
  deleteManualPayment,
  hasSucceededCharges,
  recordManualPayment,
  syncInvoicePaymentState,
  syncTransaction,
} from './payments/ledger'
export {
  approveQuote,
  createQuoteFromRequest,
  declineQuote,
  markQuoteSent,
} from './quote-lifecycle'
export { reorderLines } from './reorder'
export {
  type EnsureQuoteDocumentPdfInput,
  type EnsureQuoteDocumentPdfResult,
  ensureQuoteDocumentPdf,
  type PrepareDocumentEmailInput,
  type PrepareDocumentEmailResult,
  prepareDocumentEmail,
} from './send-email'
export { computeDocumentTotals, computeLineTotal, roundCents } from './totals'
export {
  recomputeOnInvoiceBillingChange,
  recomputeOnLineChange,
  recomputeOnQuoteBillingChange,
  recomputeTotals,
} from './totals-hooks'
export type {
  ConvertQuoteToWorkOrderInput,
  CreateInvoiceFromWorkOrderInput,
  CreateInvoiceFromWorkOrderResult,
  CreateQuoteFromRequestInput,
  DeleteInvoiceLineInput,
  DeleteManualPaymentInput,
  DiscountType,
  DocumentBillingInputs,
  DocumentTotals,
  InvoiceLifecycleInput,
  LineForTotals,
  ListUninvoicedLinesInput,
  MoneyMutationInput,
  PaymentMethod,
  QuoteLifecycleInput,
  RecomputeTotalsInput,
  RecordManualPaymentInput,
  ReorderLinesInput,
  SyncInvoicePaymentStateInput,
  UninvoicedLine,
} from './types'
