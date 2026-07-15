// packages/lib/src/money/index.ts
//
// Server entrypoint for the money (quoting + invoicing) feature — totals engine, quote/
// invoice lifecycle mutations, convert-to-work-order, gather-uninvoiced, the payment ledger,
// and line reordering (money MQ1 build spec §F, MI1 build spec §E/§G). Functional +
// neverthrow-style, no model classes (dashboards module is the layout precedent, dispatch is
// the direct sibling for this feature).

export {
  clearInvoiceSchedule,
  generateDraftOnCompletion,
  generateInvoiceDraft,
  getInvoiceSchedule,
  materializeInvoiceDrafts,
  maybeGenerateVisitInvoiceDraft,
  setInvoiceSchedule,
  sweepInvoiceDrafts,
} from './auto-invoice'
export { convertQuoteToWorkOrder } from './convert-quote'
export { createInvoiceFromWorkOrder, deleteInvoiceLine, listUninvoicedLines } from './gather'
export { deleteInvoice, markInvoiceSent, voidInvoice } from './invoice-lifecycle'
export {
  disconnectPaymentAccount,
  getPaymentAccount,
  syncAccountState,
  type UpsertPaymentAccountInput,
  upsertPaymentAccount,
} from './payments/account-state'
export {
  computeDepositAmount,
  type QuoteDepositType,
  type ResolvedQuoteDeposit,
  resolveQuoteDeposit,
} from './payments/deposit'
export {
  type PaymentAccountFeeInput,
  resolveApplicationFee,
} from './payments/fees'
export {
  deleteManualPayment,
  hasSucceededCharges,
  listWorkOrderPayments,
  recordManualPayment,
  syncInvoicePaymentState,
  syncTransaction,
} from './payments/ledger'
export {
  type PartialPaymentBounds,
  resolvePartialPaymentBounds,
} from './payments/partial'
export {
  applyStripeEvent,
  type CreateStripeCheckoutInput,
  type CreateStripeCheckoutResult,
  type CreateStripeDepositCheckoutInput,
  createStripeCheckout,
  createStripeDepositCheckout,
  type RefundTransactionInput,
  type RefundTransactionResult,
  refundTransaction,
} from './payments/stripe-rail'
export {
  buildPayUrl,
  cancelAbandonedCheckout,
  ensureInvoicePublicToken,
  getPublicInvoicePayload,
  type PublicInvoiceLine,
  type PublicInvoicePayload,
  resolveInvoiceByPublicToken,
} from './public-token'
export {
  type AcceptQuoteByTokenInput,
  type AcceptQuoteByTokenResult,
  acceptQuoteByToken,
  type DeclineQuoteByTokenInput,
  type DeclineQuoteByTokenResult,
  declineQuoteByToken,
  requestQuoteUpdateByToken,
} from './quote-acceptance'
export {
  approveQuote,
  createQuoteFromRequest,
  declineQuote,
  markQuoteSent,
} from './quote-lifecycle'
export {
  buildQuoteViewUrl,
  cancelAbandonedDepositCheckout,
  ensureQuotePublicToken,
  getPublicQuotePayload,
  getQuotePdfByToken,
  type PublicQuoteLine,
  type PublicQuotePayload,
  type PublicQuotePdfResult,
  resolveQuoteByPublicToken,
} from './quote-public-token'
export { reorderLines } from './reorder'
export {
  type EnsureQuoteDocumentPdfInput,
  type EnsureQuoteDocumentPdfResult,
  ensureQuoteDocumentPdf,
  type PrepareDocumentEmailInput,
  type PrepareDocumentEmailResult,
  prepareDocumentEmail,
  type RecordDocumentSendSignalInput,
  recordDocumentSendSignal,
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
  GenerateInvoiceDraftInput,
  GenerateInvoiceDraftResult,
  InvoiceDraftTrigger,
  InvoiceLifecycleInput,
  InvoiceScheduleQueryInput,
  LineForTotals,
  ListUninvoicedLinesInput,
  ListWorkOrderPaymentsInput,
  MoneyMutationInput,
  PaymentMethod,
  QuoteLifecycleInput,
  RecomputeTotalsInput,
  RecordManualPaymentInput,
  ReorderLinesInput,
  SetInvoiceScheduleInput,
  SyncInvoicePaymentStateInput,
  UninvoicedLine,
} from './types'
