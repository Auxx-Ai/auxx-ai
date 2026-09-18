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
// ─── Bank deposits (plans/accounting/tasks/done/06-deposit-grouping.md, slot 1D) ──
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
// The legacy `PaymentTransaction` payment lane (`money/payments/`) is gone. Its
// Stripe-account plumbing lives in `payouts/`, the deposit math in `./quote-deposit`, and
// online collection in `./checkout`.
export {
  applyStripeCheckoutEvent,
  type CheckoutSessionResult,
  createInvoiceCheckoutSession,
  createQuoteDepositCheckoutSession,
  hasQuoteDeposit,
  isCheckoutAvailable,
  listQuoteDepositReceipts,
  listWorkOrderDepositReceipts,
  type QuoteDepositReceipt,
  resolveStripeRail,
  sumQuoteDeposits,
  sumUnappliedCustomerMoney,
  sumWorkOrderDeposits,
} from './checkout'
export { convertQuoteToWorkOrder } from './convert-quote'
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
  type RecordCreditMemoRefundInput,
  type RecordCreditMemoRefundResult,
  readContactCredit,
  readCreditMemoForRefund,
  readCreditMemoSettlement,
  recordCreditMemoRefund,
  refundCreditMemoToCard,
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
export { deleteInvoice, markInvoiceSent, voidInvoice } from './invoice-lifecycle'
export {
  type ApplyMoneyToInvoiceInput,
  type ApplyMoneyToInvoiceResult,
  applyMoneyToInvoice,
} from './invoices/apply-money'
export {
  type MoveInvoicePaymentInput,
  type MoveInvoicePaymentResult,
  moveInvoicePayment,
} from './invoices/move-payment'
export {
  type InvoicePaymentRow,
  listInvoiceMoneyPayments,
  listWorkOrderMoneyPayments,
  type WorkOrderPaymentRow,
} from './invoices/payment-reads'
// ── Task 54: money received against an issued invoice ──────────────────────
// The `customer_receipt` family's second policy. `customer-money/accounting.ts`
// is the same family's ORDER policy; the two never see each other's movements.
export {
  type AcceptInvoiceReceiptInput,
  acceptInvoiceReceiptAccounting,
} from './invoices/receipt-accounting'
export {
  type RecordInvoicePaymentInput,
  type RecordInvoicePaymentResult,
  recordInvoicePayment,
} from './invoices/record-payment'
export {
  type UnapplyMoneyFromInvoiceInput,
  type UnapplyMoneyFromInvoiceResult,
  unapplyMoneyFromInvoice,
} from './invoices/unapply-money'
export {
  type VoidInvoicePaymentInput,
  type VoidInvoicePaymentResult,
  voidInvoicePayment,
} from './invoices/void-payment'
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
  loadOrderFieldContext,
  nextFulfillmentSequence,
  ORDER_FULFILLMENT_SOURCE_TYPE,
  type OrderFieldContext,
  type OrderForFulfillment,
  type OrderLineRemaining,
  previewFulfillment,
  readOrderForFulfillment,
  requireOrderFieldContext,
  reverseFulfillmentPosting,
  shippedByLine,
  shippingStillOwed,
} from './orders'
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
  disconnectPaymentAccount,
  getPaymentAccount,
  syncAccountState,
  type UpsertPaymentAccountInput,
  upsertPaymentAccount,
} from './payouts/stripe-account'
export {
  buildPayUrl,
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
  computeDepositAmount,
  type QuoteDepositType,
  type ResolvedQuoteDeposit,
  resolveQuoteDeposit,
} from './quote-deposit'
export {
  approveQuote,
  createQuoteFromRequest,
  declineQuote,
  markQuoteSent,
} from './quote-lifecycle'
export {
  buildQuoteViewUrl,
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
