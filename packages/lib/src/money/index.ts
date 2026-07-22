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
export {
  type InvoiceBatchItemResult,
  type InvoiceBatchRange,
  type InvoiceBatchRow,
  type PreviewInvoiceBatchInput,
  type PreviewInvoiceBatchResult,
  previewInvoiceBatch,
  type RunInvoiceBatchInput,
  type RunInvoiceBatchResult,
  runInvoiceBatch,
} from './batch-invoicing'
export { allocateProportionally, resolveFixedInvoiceAmount } from './billing-allocation-math'
export {
  allocateInvoiceLine,
  allocateInvoiceVisit,
  allocateScheduleOccurrence,
  getActiveAllocatedAmounts,
  listInvoiceAllocations,
  releaseInvoiceAllocations,
} from './billing-allocations'
export {
  addVisitExtrasToContract,
  createExtraWorkInvoice,
  createFixedContractInvoice,
  createRecurringCharge,
  createVisitInvoice,
} from './billing-commands'
export {
  assertBillingConfigurationCompatible,
  isBillingConfigurationCompatible,
} from './billing-config'
export { saveBillingInstallments } from './billing-installments'
export {
  computeWorkOrderBillingProjection,
  rebuildOrganizationBillingProjections,
  syncContactBillingProjection,
  syncInvoiceBillingProjection,
  syncWorkOrderBillingProjection,
} from './billing-projection'
export { getContactBillingOverview, getWorkOrderBillingState } from './billing-state'
export {
  computeMarkupPrice,
  pauseMarkupOnPriceEdit,
  recomputePriceOnMarkupChange,
  shouldPauseMarkup,
  syncCatalogCostOnPartChange,
  syncCatalogItemPricing,
} from './catalog-pricing'
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
  collectRefundedChargeIds,
  computeDepositFigures,
  type DepositChargeRow,
  getAllocationTotalsByTransaction,
  getContactCreditOnAccount,
  getInvoiceDepositApplied,
  getRefundedChargeIds,
  listContactDepositCharges,
} from './payments/allocation-reads'
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
export { sendPaymentReceipt } from './payments/receipt-email'
export {
  applyStripeEvent,
  type CreateStripeCheckoutInput,
  type CreateStripeCheckoutResult,
  type CreateStripeDepositCheckoutInput,
  createStripeCheckout,
  createStripeDepositCheckout,
  type ReconcileStripeCheckoutReturnInput,
  type ReconcileStripeDepositCheckoutReturnInput,
  type RefundTransactionInput,
  type RefundTransactionResult,
  reconcileStripeCheckoutReturn,
  reconcileStripeDepositCheckoutReturn,
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
  AddVisitExtrasToContractInput,
  BillingInstallmentInput,
  ConvertQuoteToWorkOrderInput,
  CreateExtraWorkInvoiceInput,
  CreateFixedContractInvoiceInput,
  CreateInvoiceFromWorkOrderInput,
  CreateInvoiceFromWorkOrderResult,
  CreateQuoteFromRequestInput,
  CreateRecurringChargeInput,
  CreateVisitInvoiceInput,
  DeleteInvoiceLineInput,
  DeleteManualPaymentInput,
  DiscountType,
  DocumentBillingInputs,
  DocumentTotals,
  GenerateInvoiceDraftInput,
  GenerateInvoiceDraftResult,
  InvoiceBillingKind,
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
  SaveBillingInstallmentsInput,
  SetInvoiceScheduleInput,
  SyncInvoicePaymentStateInput,
  UninvoicedLine,
  WorkOrderBillingBasis,
  WorkOrderBillingCommandInput,
  WorkOrderBillingProjection,
  WorkOrderBillingState,
  WorkOrderInvoiceTiming,
} from './types'
export {
  formatLineItemUnit,
  LINE_ITEM_UNIT_OPTIONS,
  type LineItemQuantityState,
  type LineItemUnit,
  type LineItemUnitDisplayMode,
  type ParseLineItemQuantityResult,
  parseQuantityWithUnit,
} from './units'
