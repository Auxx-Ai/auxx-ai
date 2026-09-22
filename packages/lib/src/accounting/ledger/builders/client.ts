// packages/lib/src/accounting/ledger/builders/client.ts

// ── plans/accounting/tasks/10: credit memos, one document for "you owe us less" ──
// PURE - reaches nothing but `errors`, `build-entry`, `build-fulfillment-entry`
// and `period-key`, all of which are already on this surface. The write half
// lives in `money/credit-memos/` and stays server-only.
export {
  type BuildCreditMemoEntitlementEntryInput,
  type BuildCreditMemoEntryInput,
  type BuiltCreditMemoEntitlementEntry,
  type BuiltCreditMemoEntry,
  buildCreditMemoEntitlementEntry,
  buildCreditMemoEntry,
  CREDIT_MEMO_POSTING_TYPE,
  CREDIT_MEMO_SOURCE_TYPE,
  type CreditMemoAmountsInput,
  type CreditMemoEntitlementComponent,
  computeCreditMemoAmounts,
} from './credit-memo'
export {
  buildDocNumber,
  DOC_NUMBER_KIND,
  DOC_NUMBER_MAX_LENGTH,
  DOC_NUMBER_PREFIX,
  DOCUMENT_KEY_MAX_LENGTH,
  type DocNumberInput,
  type DocNumberKind,
} from './doc-number'
export {
  ACCOUNT_ROLE_LABELS,
  ACCOUNT_ROLES,
  type AccountRole,
  type BuildEntryInput,
  type BuiltVendorBillEntry,
  buildEntry,
  buildVendorBillEntry,
  ROLE_ACCOUNT_SUBTYPES,
  ROLE_ACCOUNT_TYPES,
  roleAcceptsManualSource,
  roleScopeAxis,
  SCOPABLE_ROLES,
  type ScopeAxis,
  VENDOR_BILL_POSTING_TYPE,
  VENDOR_BILL_SOURCE_TYPE,
  type VendorBillEntryInput,
  type VendorBillLineInput,
} from './entry'
// ── HANDOFF slot 2G: the revenue side ───────────────────────────────────────
// All three builders are PURE and reach nothing but `errors`, `build-entry` and
// `doc-number`, which are already on this surface. `post-payout-entry.ts` is
// deliberately NOT here - it imports `@auxx/database`.
export {
  type BuildFulfillmentEntryInput,
  type BuiltFulfillmentEntry,
  buildFulfillmentEntry,
  CHANNEL_KEYS,
  computeShipmentTotals,
  extendRateToAmount,
  FULFILLMENT_SOURCE_TYPE,
  type FulfillmentShippedLine,
  fulfillmentPeriodKey,
  type OrderChannelKey,
  type ShipmentTotals,
  type ShipmentTotalsInput,
  type ShipmentTotalsLine,
  toAmountMinor,
  toChannelKey,
} from './fulfillment'
// ── HANDOFF slot 1C: the opening trial balance ─────────────────────────────
// Pure/type-only. `build-opening-balance-entry.ts` reaches nothing but
// `errors`, `periods` and `setup-readiness`, all of which are already on this
// surface; `opening-trial-balance/client.ts` is types plus two total functions.
export {
  type BuiltInventoryMovementEntry,
  buildInventoryMovementEntry,
  type InventoryDocumentKind,
  type InventoryMovementEntryInput,
  type InventoryMovementLine,
  type ReceiveAccrualInput,
  type ReliefCogsSplit,
} from './inventory-movement'
// ── plans/accounting/tasks/08: the receivable nothing debits ────────────────
// PURE. `money/invoices/post-invoice.ts` is the write half and stays
// server-only - it imports `@auxx/database`.
export {
  type BuildInvoiceEntryInput,
  type BuiltInvoiceEntry,
  buildInvoiceEntry,
  INVOICE_ISSUED_POSTING_TYPE,
  INVOICE_SOURCE_TYPE,
} from './invoice'
// ── HANDOFF slot 1A: manual journal entries ───────────────────────────────
// `build-manual-entry.ts` is PURE - it imports only `errors` and `build-entry`,
// both of which are already on this surface - so the builder and the one
// dollars-to-minor-units conversion are both safe in a browser. That matters:
// `toMinorUnits` is called at the `CurrencyInput` boundary, in the drawer, so
// nothing but integers ever crosses the wire.
export {
  type BuildManualEntryInput,
  type BuiltManualEntry,
  buildManualEntry,
  MANUAL_ENTRY_SOURCE_TYPE,
  type ManualEntryLine,
  type ManualPostingType,
  toMinorUnits,
} from './manual'
export { type MovementPostingType, movementPeriodKey } from './movement-key'
export {
  type BuildOpeningBalanceEntryInput,
  type BuiltOpeningBalanceEntry,
  buildOpeningBalanceEntry,
  cutoverDateFor,
  OPENING_ENTRY_SOURCE_TYPE,
  type OpeningBalanceLine,
} from './opening-balance'
export {
  type BuildPayoutEntryInput,
  type BuiltPayoutEntry,
  buildPayoutEntry,
  PAYOUT_SOURCE_TYPE,
} from './payout'
export { LINE_MEMO_MAX_LENGTH, type SourceFacts, sourceFactsMemo } from './source-facts-memo'
// -- task 71 U7: the supplier's credit note, the expense bill sides-flipped ---
export {
  type BuildVendorCreditEntryInput,
  type BuiltVendorCreditEntry,
  buildVendorCreditEntry,
  VENDOR_CREDIT_POSTING_TYPE,
  VENDOR_CREDIT_SOURCE_TYPE,
  type VendorCreditLineInput,
} from './vendor-credit'
