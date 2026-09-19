// packages/lib/src/sales/index.ts
//
// Server entrypoint for the sales documents — quotes, orders, fulfillments, invoice
// issuance, credit memos, billing plans, the totals engine and line reordering. What
// settles against these documents lives in `accounting/money`.

export { allocateProportionally, resolveFixedInvoiceAmount } from './billing/allocation-math'
export {
  allocateInvoiceLine,
  allocateInvoiceVisit,
  allocateScheduleOccurrence,
  getActiveAllocatedAmounts,
  listInvoiceAllocations,
  releaseInvoiceAllocations,
} from './billing/allocations'
export {
  addVisitExtrasToContract,
  createExtraWorkInvoice,
  createFixedContractInvoice,
  createRecurringCharge,
  createVisitInvoice,
} from './billing/commands'
export {
  assertBillingConfigurationCompatible,
  isBillingConfigurationCompatible,
} from './billing/config'
export { saveBillingInstallments } from './billing/installments'
export {
  computeWorkOrderBillingProjection,
  rebuildOrganizationBillingProjections,
  syncContactBillingProjection,
  syncInvoiceBillingProjection,
  syncWorkOrderBillingProjection,
} from './billing/projection'
export { getContactBillingOverview, getWorkOrderBillingState } from './billing/state'
// ─── Credit memos (plans/accounting/tasks/done/10-credit-memos.md) ──────────────
// Appended as one block, per HANDOFF section 9a's rule for shared barrels.
export {
  type ApplyCreditMemoInput,
  type ApplyCreditMemoResult,
  applyCreditMemo,
  type ContactCredit,
  type ContactCreditMemo,
  CREDIT_MEMO_NUMBER_PREFIX,
  CREDIT_MEMO_STATUS_BYPASS,
  type CreateCreditMemoFromInvoiceInput,
  type CreateCreditMemoInput,
  type CreateCreditMemoResult,
  type CreditMemoApplicationRow,
  type CreditMemoForApplication,
  type CreditMemoForRefund,
  type CreditMemoLifecycleInput,
  type CreditMemoLineInput,
  type CreditMemoReason,
  type CreditMemoRecord,
  type CreditMemoRefundRow,
  type CreditMemoSettlementState,
  type CreditMemoSource,
  type CreditMemoStatus,
  createCreditMemo,
  createCreditMemoFromInvoice,
  discardCreditMemo,
  type IssueCreditMemoInput,
  type IssueCreditMemoResult,
  issueCreditMemo,
  listOpenInvoicesForContact,
  listRefundableReceipts,
  loadCreditMemo,
  loadCreditMemoLines,
  type OpenInvoiceRow,
  type PlannedCreditApplication,
  planCreditApplication,
  previewIssueCreditMemo,
  type RecordCreditMemoRefundInput,
  type RecordCreditMemoRefundResult,
  readContactCredit,
  readCreditMemoForRefund,
  readCreditMemoSettlement,
  recordCreditMemoRefund,
  refundCreditMemoToCard,
  requireCreditMemo,
  type SettleCreditMemoInput,
  settleCreditMemo,
  type UnapplyCreditMemoInput,
  unapplyCreditMemo,
  voidCreditMemo,
} from './credit-memos'
// ─── Fulfillment records (entity migration 153, plans/money/tasks/55) ──────
// `fulfillment` / `fulfillment_line` records: the shared contract behind the
// native fulfillment door below, the bulk poster, the credit-memo readers and
// the order drawer's ledger card. Appended as one block, per HANDOFF §9a's
// rule for shared barrels.
export {
  type CreatedFulfillment,
  type CreateFulfillmentInput,
  type CreateFulfillmentLineInput,
  createFulfillment,
  defaultFulfillmentName,
  deleteFulfillment,
  FULFILLMENT_STATUSES,
  type Fulfillment,
  type FulfillmentFieldContext,
  type FulfillmentLine,
  type FulfillmentStatusValue,
  isLiveFulfillment,
  loadFulfillmentFieldContext,
  readFulfillmentsForOrder,
  readFulfillmentsForOrders,
  requireFulfillmentFieldContext,
} from './fulfillments'
export { createInvoiceFromWorkOrder, deleteInvoiceLine, listUninvoicedLines } from './gather'
export {
  clearInvoiceSchedule,
  generateDraftOnCompletion,
  generateInvoiceDraft,
  getInvoiceSchedule,
  materializeInvoiceDrafts,
  maybeGenerateVisitInvoiceDraft,
  setInvoiceSchedule,
  sweepInvoiceDrafts,
} from './invoices/auto-invoice'
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
} from './invoices/batch-invoicing'
export { deleteInvoice, markInvoiceSent, voidInvoice } from './invoices/invoice-lifecycle'
export {
  type PreviewWriteOffInput,
  previewWriteOffInvoice,
  readWriteOffState,
  type WriteOffInvoiceInput,
  type WriteOffState,
  writeOffInvoice,
} from './invoices/write-off'
// ── HANDOFF slot 2K: writing off an invoice's balance to bad debt ──────────
export {
  type AcceptInvoiceWriteOffInput,
  acceptInvoiceWriteOffAccounting,
} from './invoices/write-off-accounting'
// ─── Order fulfillment (tasks/01 phase A, HANDOFF slot 2G) ──────────────────
// The sanctioned action decision 6.6 chose over a status hook: it carries WHAT
// shipped, which a status flip cannot, and that is what makes a second
// fulfillment able to avoid re-recognising the first.
export {
  type FulfillOrderInput,
  type FulfillOrderLine,
  type FulfillOrderResult,
  fulfillmentStatusFor,
  fulfillOrder,
  nextFulfillmentSequence,
  ORDER_FULFILLMENT_SOURCE_TYPE,
  type OrderForFulfillment,
  type OrderLineForFulfillment,
  type OrderLineRemaining,
  previewFulfillment,
  readOrderForFulfillment,
  readOrderLines,
  reverseFulfillmentPosting,
  shippedByLine,
  shippingStillOwed,
} from './orders'
export {
  buildPayUrl,
  ensureInvoicePublicToken,
  getPublicInvoicePayload,
  type PublicInvoiceLine,
  type PublicInvoicePayload,
  resolveInvoiceByPublicToken,
} from './public-token'
export { convertQuoteToWorkOrder } from './quotes/convert-quote'
export {
  type AcceptQuoteByTokenInput,
  type AcceptQuoteByTokenResult,
  acceptQuoteByToken,
  type DeclineQuoteByTokenInput,
  type DeclineQuoteByTokenResult,
  declineQuoteByToken,
  requestQuoteUpdateByToken,
} from './quotes/quote-acceptance'
export {
  computeDepositAmount,
  type QuoteDepositType,
  type ResolvedQuoteDeposit,
  resolveQuoteDeposit,
} from './quotes/quote-deposit'
export {
  approveQuote,
  createQuoteFromRequest,
  declineQuote,
  markQuoteSent,
} from './quotes/quote-lifecycle'
export {
  buildQuoteViewUrl,
  ensureQuotePublicToken,
  getPublicQuotePayload,
  getQuotePdfByToken,
  type PublicQuoteLine,
  type PublicQuotePayload,
  type PublicQuotePdfResult,
  resolveQuoteByPublicToken,
} from './quotes/quote-public-token'
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
export {
  computeMarkupPrice,
  pauseMarkupOnPriceEdit,
  recomputePriceOnMarkupChange,
  shouldPauseMarkup,
  syncCatalogCostOnPartChange,
  syncCatalogItemPricing,
} from './totals/catalog-pricing'
export { reorderLines } from './totals/reorder'

export { computeDocumentTotals, computeLineTotal, roundCents } from './totals/totals'

export {
  recomputeOnInvoiceBillingChange,
  recomputeOnLineChange,
  recomputeOnOrderBillingChange,
  recomputeOnQuoteBillingChange,
  recomputeTotals,
} from './totals/totals-hooks'
export {
  formatLineItemUnit,
  LINE_ITEM_UNIT_OPTIONS,
  type LineItemQuantityState,
  type LineItemUnit,
  type LineItemUnitDisplayMode,
  type ParseLineItemQuantityResult,
  parseQuantityWithUnit,
} from './totals/units'
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
  UninvoicedLine,
  WorkOrderBillingBasis,
  WorkOrderBillingCommandInput,
  WorkOrderBillingProjection,
  WorkOrderBillingState,
  WorkOrderInvoiceTiming,
} from './types'
