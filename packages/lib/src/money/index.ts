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
// ─── Bank deposits (plans/accounting/tasks/06-deposit-grouping.md, slot 1D) ──
// Appended as one block, per HANDOFF §9a's rule for shared barrels.
export {
  BANK_DEPOSIT_SOURCE_TYPE,
  type BankDepositDetail,
  type BankDepositRecord,
  type BankDepositStatus,
  type CreateBankDepositResult,
  clearBankDeposit,
  createBankDeposit,
  DEFAULT_PAYMENT_ROUTES,
  getBankDeposit,
  groupByDay,
  hasBankDeposits,
  isBankDepositFrozen,
  listBankDeposits,
  listUndepositedPayments,
  methodsRoutedToUndepositedFunds,
  PAYMENT_ROUTE_SETTING_KEYS,
  PAYMENT_ROUTE_SETTING_OPTIONS,
  type PaymentRoute,
  type PaymentRouteMethod,
  resolveBankDepositStatus,
  resolvePaymentRoute,
  type UndepositedPaymentRow,
  updateBankDeposit,
} from './bank-deposits'
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
// ─── The shared batch-posting frame (accounting/25 §5) ─────────────────────
export {
  BATCH_POSTING_EXCLUSION_REASONS,
  BATCH_POSTING_GROUPINGS,
  type BatchPostingExclusionReason,
  type BatchPostingGrouping,
} from './batch-posting'
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
// ─── Bulk credit memo posting (plans/accounting/tasks/25) ──────────────────
// ⚠️ Two names are aliased on the way out because the fulfillment poster owns
// the unqualified ones in this barrel: `groupKeyFor` is exported for shipments,
// and a second `CLOSE_BLOCKING_EXCLUSION_REASONS` would read as one set over
// both sources when it is per source.
export {
  CLOSE_BLOCKING_EXCLUSION_REASONS as CREDIT_MEMO_CLOSE_BLOCKING_EXCLUSION_REASONS,
  type CreditMemoPlanContext,
  type CreditMemoPostingPreview,
  type CreditMemoPostingPreviewInput,
  type CreditMemoPostingSettings,
  countCloseBlockingCreditMemos,
  countUnpostedCreditMemos,
  groupKeyFor as creditMemoGroupKeyFor,
  listCreditMemoPostings,
  planCreditMemoPosting,
  previewCreditMemoPosting,
  readCreditMemoPostingSettings,
  readCreditMemoSettlementAccounts,
  readUnpostedCreditMemos,
  runCreditMemoPosting,
  type UnpostedCreditMemoRange,
} from './credit-memo-posting'
// ─── Credit memos (plans/accounting/tasks/10-credit-memos.md) ──────────────
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
  type CreditMemoLifecycleInput,
  type CreditMemoLineInput,
  type CreditMemoReason,
  type CreditMemoRecord,
  type CreditMemoRefundRow,
  type CreditMemoSettlement,
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
  loadCreditMemo,
  loadCreditMemoLines,
  type OpenInvoiceRow,
  type PlannedCreditApplication,
  planCreditApplication,
  previewIssueCreditMemo,
  readContactCredit,
  readCreditMemoSettlement,
  type SettleCreditMemoInput,
  settleCreditMemo,
  type UnapplyCreditMemoInput,
  unapplyCreditMemo,
  voidCreditMemo,
} from './credit-memos'
// ─── Bulk fulfillment posting (plans/money/tasks/49-bulk-fulfillment-posting.md) ──
// Appended as one block, per HANDOFF §9a's rule for shared barrels.
export {
  countUnpostedShipments,
  type FulfillmentPostingPreview,
  type FulfillmentPostingSettings,
  groupKeyFor,
  listOrderFulfillmentPostings,
  planFulfillmentPosting,
  previewFulfillmentPosting,
  readFulfillmentPostingSettings,
  readUnpostedShipments,
  runFulfillmentPosting,
  type UnpostedShipmentRange,
} from './fulfillment-posting'
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
  type FulfillmentPostingStamp,
  type FulfillmentStatusValue,
  isLiveFulfillment,
  loadFulfillmentFieldContext,
  readFulfillmentsForOrder,
  readFulfillmentsForOrders,
  requireFulfillmentFieldContext,
  stampFulfillmentPosting,
} from './fulfillments'
export { createInvoiceFromWorkOrder, deleteInvoiceLine, listUninvoicedLines } from './gather'
export { deleteInvoice, markInvoiceSent, voidInvoice } from './invoice-lifecycle'
// ── HANDOFF slot 2K: writing off an invoice's balance to bad debt ──────────
export {
  type PreviewWriteOffInput,
  previewWriteOffInvoice,
  readWriteOffState,
  type WriteOffInvoiceInput,
  type WriteOffState,
  writeOffInvoice,
} from './invoices/write-off'
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
  loadOrderFieldContext,
  nextFulfillmentSequence,
  ORDER_FULFILLMENT_SOURCE_TYPE,
  type OrderFieldContext,
  type OrderForFulfillment,
  type OrderLineRemaining,
  previewFulfillment,
  readOrderForFulfillment,
  requireOrderFieldContext,
  shippedByLine,
  shippingStillOwed,
} from './orders'
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
  type CreditMemoForRefund,
  deleteManualPayment,
  hasSucceededCharges,
  listWorkOrderPayments,
  type RecordManualRefundInput,
  readCreditMemoForRefund,
  recordManualPayment,
  recordManualRefund,
  syncInvoicePaymentState,
  syncTransaction,
} from './payments/ledger'
export {
  type PartialPaymentBounds,
  resolvePartialPaymentBounds,
} from './payments/partial'
// The payment post door. `syncTransaction` calls it; nothing else should.
export {
  listPaymentPostings,
  PAYMENT_POSTING_TYPE,
  postPaymentTransaction,
} from './payments/post-transaction'
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
  findPayoutByGatewayId,
  type GatheredPayout,
  gatherPayout,
  type ListPayoutsFilters,
  listPayouts,
  loadPayoutFieldContext,
  PAYOUT_STATUSES,
  type PayoutFieldContext,
  type PayoutItem,
  type PayoutRecord,
  type PayoutSplit,
  type PayoutStatus,
  requirePayoutFieldContext,
  resolvePayoutStatus,
  reverseFailedPayout,
  type SyncPayoutsResult,
  splitPayout,
  syncPayouts,
} from './payouts'
export {
  buildPayUrl,
  cancelAbandonedCheckout,
  ensureInvoicePublicToken,
  getPublicInvoicePayload,
  type PublicInvoiceLine,
  type PublicInvoicePayload,
  resolveInvoiceByPublicToken,
} from './public-token'
export type { PurchaseOrderLifecycleInput } from './purchase-order-lifecycle'
export { markPurchaseOrderSent } from './purchase-order-lifecycle'
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
  recomputeOnOrderBillingChange,
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
