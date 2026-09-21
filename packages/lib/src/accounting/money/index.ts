// packages/lib/src/accounting/money/index.ts
//
// Server entrypoint for the money model — `MoneyTransaction` / `MoneyApplication`, the
// invoice payment verbs, bank deposits, payouts, the Stripe Connect account and checkout.
// The documents these settle against live in `sales`.

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
  getBankDeposit,
  groupByDay,
  hasBankDeposits,
  isBankDepositFrozen,
  listBankDeposits,
  listUndepositedPayments,
  resolveBankDepositStatus,
  type UndepositedPaymentRow,
  updateBankDeposit,
} from './bank-deposits'
export {
  type BlockedMovementDetail,
  type BlockedMovementRow,
  countBlockedMovements,
  listBlockedMovements,
  listMovementAccountingCandidates,
  type MovementCandidateWindow,
  type MovementDetail,
  type MovementLinkedRecord,
  type MovementPurpose,
  POSTING_RETRY_INTERVAL_MS,
  type PostBlockedMovementInput,
  postBlockedMovement,
  readBlockedMovement,
  readMovementDetail,
  sweepMovementAccounting,
} from './blocked-movements'
export {
  type CashEndpoint,
  type CashEndpointKind,
  type CashEndpointSource,
  cashEndpointSourceOf,
  resolveCashEndpoint,
} from './cash-endpoint'
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
export { netApplied, validateCashEndpointSource } from './client'
export { type InsertMovementInput, insertMovement } from './commands/insert-movement'
export { findMoneyCommandByKey } from './commands/run-money-command'
export {
  type ApplyMoneyToInvoiceInput,
  type ApplyMoneyToInvoiceResult,
  applyMoneyToInvoice,
} from './invoice-payments/apply-money'
export {
  type MoveInvoicePaymentInput,
  type MoveInvoicePaymentResult,
  moveInvoicePayment,
} from './invoice-payments/move-payment'
export {
  type InvoicePaymentRow,
  listInvoiceMoneyPayments,
  listWorkOrderMoneyPayments,
  type WorkOrderPaymentRow,
} from './invoice-payments/payment-reads'
// ── Task 54: money received against an issued invoice ──────────────────────
// The `customer_receipt` family's second policy. `customer-money/accounting.ts`
// is the same family's ORDER policy; the two never see each other's movements.
export {
  type AcceptInvoiceReceiptInput,
  acceptInvoiceReceiptAccounting,
} from './invoice-payments/receipt-accounting'
export {
  type RecordInvoicePaymentInput,
  type RecordInvoicePaymentResult,
  recordInvoicePayment,
} from './invoice-payments/record-payment'
export {
  type UnapplyMoneyFromInvoiceInput,
  type UnapplyMoneyFromInvoiceResult,
  unapplyMoneyFromInvoice,
} from './invoice-payments/unapply-money'
export {
  type VoidInvoicePaymentInput,
  type VoidInvoicePaymentResult,
  voidInvoicePayment,
} from './invoice-payments/void-payment'
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
  type LoadedMovement,
  MOVEMENT_SOURCE_TYPE,
  type MovementPostingResult,
  type PreparedMovement,
  postMovementEntry,
} from './post-movement'
export {
  assertPostableMovement,
  findSourceLink,
  findSourceLinks,
  listApplicationsByMovement,
  listInvoiceApplications,
  listLiveApplications,
  listMovementApplications,
  listOrderApplications,
  listRefundSettlements,
  listVendorBillApplications,
  type MoneyApplicationRow,
  type MoneyRefundSettlementRow,
  type MoneySourceLinkRow,
  type RefundSettlementFilter,
  readMovement,
  readMovements,
  selectLiveApplications,
  sumAppliedByMovement,
  sumAppliedToInvoice,
  sumAppliedToMovement,
  sumAppliedToOrder,
  sumAppliedToVendorBill,
} from './reads'
export {
  disconnectPaymentAccount,
  getPaymentAccount,
  syncAccountState,
  type UpsertPaymentAccountInput,
  upsertPaymentAccount,
} from './stripe-connect/account'
export type { SyncInvoicePaymentStateInput } from './types'
export {
  type AcceptVendorPaymentInput,
  acceptVendorPaymentAccounting,
} from './vendor-payments/payment-accounting'
export {
  listVendorBillPayments,
  type VendorBillPaymentRow,
} from './vendor-payments/payment-reads'
export {
  type SyncVendorBillPaymentStateInput,
  sumVendorBillPayments,
  syncVendorBillPaymentState,
} from './vendor-payments/payment-state'
export {
  type RecordVendorPaymentInput,
  type RecordVendorPaymentResult,
  recordVendorPayment,
} from './vendor-payments/record-payment'
export {
  type RecordVendorRefundInput,
  type RecordVendorRefundResult,
  recordVendorRefund,
} from './vendor-payments/record-refund'
export {
  postVendorRefundAccounting,
  type VendorRefundAccountingInput,
  type VendorRefundAccountingResult,
} from './vendor-payments/refund-accounting'
export {
  type VoidVendorPaymentInput,
  type VoidVendorPaymentResult,
  voidVendorPayment,
} from './vendor-payments/void-payment'
export { type InsertApplicationInput, insertApplication } from './writes'
