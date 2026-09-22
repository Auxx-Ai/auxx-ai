// packages/lib/src/accounting/ledger/builders/index.ts

export {
  type AccountingBasisDimension,
  reservedAccountingBasis,
} from './basis-dimension'
// ── plans/accounting/tasks/10: credit memos, one document for "you owe us less" ──
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
// ── HANDOFF slot 2G: the revenue side (tasks/01 phases A to C) ──────────────
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
export {
  type BuildInvoiceEntryInput,
  type BuiltInvoiceEntry,
  buildInvoiceEntry,
  INVOICE_ISSUED_POSTING_TYPE,
  INVOICE_SOURCE_TYPE,
} from './invoice'
// ── HANDOFF slot 1A: manual journal entries ───────────────────────────────
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
// ── HANDOFF slot 1C: the opening trial balance ─────────────────────────────
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
// ── HANDOFF slot 2K (accountant profile, 1099/W-9, write-off) ──────────────
export {
  type BuildWriteOffEntryInput,
  buildWriteOffEntry,
  MAX_WRITE_OFF_ATTEMPT,
  WRITE_OFF_SOURCE_TYPE,
  writeOffPeriodKey,
} from './write-off'
