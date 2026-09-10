// packages/lib/src/postings/client.ts
//
// Client-safe entry point for the postings module. Pure re-exports only: types,
// account codes, the entry builders and the period helpers. Nothing here touches
// a database, a logger, or a provider.
//
// NOTE: no 'use client' directive - this file is imported by server code too
// (the builders run in a worker), and the directive would turn every export into
// a client-reference proxy there. See docs/lib-module-guide.md section 7.

export {
  GL_ACCOUNT_TYPE_META,
  type GlAccountTypeMeta,
  glAccountTypeMeta,
} from '../resources/registry/gl-account-type-meta'
export { accountLabel, compareAccountsByCodeThenName, type NamedAccount } from './account-label'
export {
  accountSubtypeLabel,
  GL_ACCOUNT_SUBTYPES,
  type GlAccountSubtypeValue,
} from './account-subtype'
// ── plans/accounting/tasks/10: credit memos, one document for "you owe us less" ──
// PURE - reaches nothing but `errors`, `build-entry`, `build-fulfillment-entry`
// and `period-key`, all of which are already on this surface. The write half
// lives in `money/credit-memos/` and stays server-only.
export {
  type BuildCreditMemoEntryInput,
  type BuiltCreditMemoEntry,
  buildCreditMemoEntry,
  CREDIT_MEMO_POSTING_TYPE,
  CREDIT_MEMO_SOURCE_TYPE,
  type CreditMemoSettlement,
} from './build-credit-memo-entry'
// ── plans/accounting/tasks/07: customer deposits are a liability ────────────
// PURE - reaches nothing but `errors`, `build-entry` and `period-key`, all of
// which are already on this surface.
export {
  type BuildDepositApplicationEntryInput,
  type BuiltDepositApplicationEntry,
  buildDepositApplicationEntry,
  DEPOSIT_APPLICATION_PERIOD_KEY_PREFIX,
  DEPOSIT_APPLICATION_POSTING_TYPE,
  DEPOSIT_APPLICATION_SOURCE_TYPE,
  depositApplicationPeriodKey,
} from './build-deposit-application-entry'
export {
  ACCOUNT_ROLE_LABELS,
  ACCOUNT_ROLES,
  type AccountRole,
  type BuildEntryInput,
  buildEntry,
  buildReceiptEntry,
  buildVendorBillEntry,
  type ReceiptEntryInput,
  ROLE_ACCOUNT_TYPES,
  type VendorBillEntryInput,
} from './build-entry'
// ── plans/money/tasks/49: one fulfillment posting per day, not per shipment ──
// PURE. Reaches `errors`, `build-entry`, `build-fulfillment-entry`, `doc-number`
// and `money/fulfillment-posting/types` (types and constants only, no db), all
// of which are safe in a browser.
export {
  type BuildFulfillmentBatchEntryInput,
  type BuiltFulfillmentBatchEntry,
  buildFulfillmentBatchEntry,
  computeShipmentAmounts,
  FULFILLMENT_DEBIT_ACCOUNT_ROLE,
  FULFILLMENT_GATEWAY_DEBIT,
  type FulfillmentBatchSource,
  type FulfillmentDebitExclusionReason,
  type FulfillmentDebitResolution,
  fulfillmentBatchPeriodKey,
  MAX_COMPACT_FULFILLMENT_BATCH_KEY,
  MAX_FULFILLMENT_BATCH_ATTEMPT,
  resolveFulfillmentDebit,
} from './build-fulfillment-batch-entry'
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
} from './build-fulfillment-entry'
// ── plans/accounting/tasks/08: the receivable nothing debits ────────────────
// PURE. `money/invoices/post-invoice.ts` is the write half and stays
// server-only - it imports `@auxx/database`.
export {
  type BuildInvoiceEntryInput,
  type BuiltInvoiceEntry,
  buildInvoiceEntry,
  INVOICE_ISSUED_POSTING_TYPE,
  INVOICE_SOURCE_TYPE,
} from './build-invoice-entry'
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
} from './build-manual-entry'
export {
  type BuiltMonthEndInventoryDraft,
  buildMonthEndInventoryEntry,
  type MonthEndInventoryInputs,
} from './build-month-end-inventory'
// ── HANDOFF slot 1C: the opening trial balance ─────────────────────────────
// Pure/type-only. `build-opening-balance-entry.ts` reaches nothing but
// `errors`, `periods` and `setup-readiness`, all of which are already on this
// surface; `opening-trial-balance/client.ts` is types plus two total functions.
export {
  type BuildOpeningBalanceEntryInput,
  type BuiltOpeningBalanceEntry,
  buildOpeningBalanceEntry,
  cutoverDateFor,
  OPENING_ENTRY_SOURCE_TYPE,
  type OpeningBalanceLine,
} from './build-opening-balance-entry'
export {
  type BuildPaymentEntryInput,
  type BuiltPaymentEntry,
  buildPaymentEntry,
  PAYMENT_PERIOD_KEY_PREFIX,
  PAYMENT_ROUTE_ROLE,
  PAYMENT_SOURCE_TYPE,
  type PaymentEntryTransaction,
  paymentPeriodKey,
} from './build-payment-entry'
export {
  type BuildPayoutEntryInput,
  type BuiltPayoutEntry,
  buildPayoutEntry,
  PAYOUT_CLEARING_ROLES,
  PAYOUT_SOURCE_TYPE,
} from './build-payout-entry'
// ── plans/accounting/tasks/16: the chart import, pure half ─────────────────
// PURE. The two declared tables and the planner reach nothing but types.
export {
  PROVIDER_ACCOUNT_TYPE_SUBTYPE,
  planChartImport,
  ROLE_IMPORT_MATCH,
} from './chart-import-plan'
export {
  CHART_PACK_KEYS,
  CHART_PACKS,
  type ChartPack,
  type ChartPackKey,
  DEFAULT_CHART_OF_ACCOUNTS,
  type DefaultChartAccount,
  GL_ACCOUNT_TYPES,
  type GlAccountTypeValue,
  packForRole,
  packState,
} from './default-chart'
export {
  buildDocNumber,
  DOC_NUMBER_MAX_LENGTH,
  DOC_NUMBER_PREFIX,
  type DocNumberInput,
} from './doc-number'
export {
  type MonthEndInventorySnapshot,
  POSTING_DRAFT_VERSION,
  type PostingAssertions,
  type PostingDraftV1,
  requiresAssertions,
  reverseAssertions,
} from './draft'
// ── plans/accounting/tasks/18: two feeds, one author, unit 1 ───────────────
// Types only - the read touches `@auxx/database` and stays server-only,
// exported from `./index`. The close console's card renders this shape.
export type { DuplicateMovementEntry, DuplicateMovementFinding } from './duplicate-movements'
export {
  JOURNAL_ENTRY_POSTING_TYPE,
  type JournalEntryKindValue,
  type JournalEntryLine,
  type JournalEntryRecord,
  type JournalEntryStatusValue,
  type ListJournalEntriesFilters,
  type PostingSummary,
} from './journal-entries/client'
// ── plans/accounting/tasks/19: opening balances from the provider, pure half ──
// PURE. No database, no io - see opening-fill-plan.ts's own header.
export {
  type ProviderOpeningFillInput,
  type ProviderOpeningFillPlan,
  planProviderOpeningFill,
} from './opening-fill-plan'
export {
  OPENING_TRIAL_BALANCE_FREEZE_KEY,
  OPENING_TRIAL_BALANCE_KIND,
  type OpeningTrialBalancePosting,
  type OpeningTrialBalanceRow,
  type OpeningTrialBalanceView,
  rowsToJournalEntryLines,
  sortChartAccountsForStatement,
} from './opening-trial-balance/client'
export {
  assertCompactablePeriodKey,
  hashedPeriodKey,
  MAX_COMPACT_PERIOD_KEY,
} from './period-key'
export {
  assertPeriodOpen,
  compareMonths,
  isPeriodLocked,
  type ParsedPeriodKey,
  type PeriodGranularity,
  type PeriodLock,
  parsePeriodKey,
  periodKeyForDate,
  periodMonth,
} from './periods'
// ── plans/accounting/tasks/20 §8: do our books and theirs agree ─────────────
// PURE. No database, no io, no clock - reaches only `errors`, `account-label`
// and two type-only imports. See provider-agreement.ts's own header.
export {
  type PlanProviderAgreementInput,
  type ProviderAgreement,
  type ProviderAgreementRow,
  type ProviderAgreementStatus,
  planProviderAgreement,
} from './provider-agreement'
// ── plans/accounting/tasks/20 §5-§7: the inbound half of the seam ───────────
// The CLIENT-SAFE surface only: the contract in `provider-sync/client.ts`, the
// pure planner and the pure range walker. Everything that touches a database or
// the provider (`reads.ts`, `writes.ts`, `sync.ts`) is exported from `./index`
// alone.
//
// 🛑 `isOurs` is on this surface because a screen has to be able to say WHY an
// entry was not imported, and it is the most dangerous function in the module:
// an import that gets it wrong re-reads our own ledger and doubles every posted
// entry in it, with both copies balancing.
export {
  isOurs,
  OUR_PROVIDER_TXN_TYPE,
  type OurEntryCheck,
  type OurEntryVerdict,
  type OurPostedEntry,
  type OurPostedLine,
  PROVIDER_SYNC_POSTING_TYPE,
  PROVIDER_SYNC_SOURCE_TYPE,
  type ProviderLedger,
  type ProviderLedgerEntry,
  type ProviderLedgerLine,
  type ProviderSyncPlan,
  type ProviderSyncRange,
} from './provider-sync/client'
export {
  groupProviderLedgerEntries,
  invertAccountMap,
  type PlanProviderSyncInput,
  planProviderSync,
  resolveProviderSyncLines,
} from './provider-sync/plan'
export {
  type PlanSyncChunksInput,
  planSyncChunks,
  providerSyncFloor,
} from './provider-sync/range'
export {
  ENABLED_POSTING_TYPES,
  EXPORT_ROUTE_BY_POSTING_TYPE,
  type ExportRoute,
  INVENTORY_ROLES,
  INVENTORY_ROLES_BY_POSTING_TYPE,
  SINGLE_WRITER_ROLES,
  SINGLE_WRITER_ROLES_BY_POSTING_TYPE,
} from './regime'
export type { AccountLineRow, AccountLines } from './reports/account-lines'
// ── Statements (HANDOFF slot 1E, wave 1) - pure pieces only. The reads
// (`readTrialBalance`, `readBalanceSheet`, `readProfitAndLoss`,
// `readCompleteness`, `readAccountLines`) and the PDF render touch a database
// or react-pdf/S3 and stay server-only, exported from `./index` only. ────────
export {
  balanceSheetColumns,
  GENERAL_LEDGER_COLUMNS,
  TRIAL_BALANCE_COLUMNS,
  toBalanceSheetRows,
  toGeneralLedgerRows,
  toProfitAndLossRows,
  toTrialBalanceRows,
} from './reports/adapters'
export type { BalanceSheet, BalanceSheetRow, BalanceSheetSnapshot } from './reports/balance-sheet'
export type { Completeness, CompletenessItem } from './reports/completeness'
export { fiscalYearStart, previousCalendarDay } from './reports/fiscal-year'
// The general ledger (task 21 §5). Types only: `readGeneralLedger` and its
// `GENERAL_LEDGER_MAX_LINES` guard are a db read and a server policy, and stay
// on `./index`. `toGeneralLedgerRows`/`GENERAL_LEDGER_COLUMNS` are pure and
// come through the adapters block above, like every other statement's.
export type {
  GeneralLedger,
  GeneralLedgerAccount,
} from './reports/general-ledger'
export type {
  RenderStatementPdfOptions,
  RenderStatementPdfParamsByKind,
  RenderStatementPdfResult,
  StatementKind,
} from './reports/pdf/render-statement-pdf'
export type {
  ProfitAndLoss,
  ProfitAndLossRow,
  ProfitAndLossSnapshot,
} from './reports/profit-and-loss'
export {
  computedRow,
  type StatementColumn,
  type StatementLineInput,
  type StatementRow,
  statementSection,
  toCsvRows,
  totalRow,
} from './reports/rows'
export {
  NATURAL_BALANCE_DIRECTION,
  type NetIncomeRow,
  netIncome,
  type RetainedEarnings,
  type RetainedEarningsInput,
  retainedEarnings,
  signedBalance,
} from './reports/statement-math'
export type { TrialBalance, TrialBalanceRow } from './reports/trial-balance'
export type { Vendor1099Row, Vendor1099Summary } from './reports/vendor-1099-rows'
// ── HANDOFF slot 2K (accountant profile, 1099/W-9, write-off) ──────────────
export {
  toVendor1099CsvRows,
  toVendor1099Rows,
  VENDOR_1099_COLUMNS,
  VENDOR_1099_THRESHOLD_MINOR,
} from './reports/vendor-1099-rows'
// The readiness extension: a fourth requirement whose input is not a setting.
// Exported here rather than folded into the `setup-readiness` block above so
// this slot appended, per HANDOFF §9a, instead of editing another slot's lines.
export {
  ABSORPTION_RATE_SETTING_KEYS,
  FINALIZED_SETUP_STATE,
  isValidTimeZone,
  isWholeMinorUnits,
  minorUnitError,
  OPENING_BASELINE_SETTING_KEYS,
  type OpeningTrialBalanceSummary,
  openingDifference,
  openingDifferenceRows,
  openingTrialBalanceDifference,
  type ReadinessRequirement,
  readSettingMinorUnits,
  readSettingText,
  resolveSetupReadiness,
  SETUP_READINESS_SETTING_KEYS,
  type SettingsRecord,
  type SetupReadiness,
  type SetupReadinessContext,
  summariseOpeningTrialBalance,
} from './setup-readiness'
export {
  type AccountSuggestion,
  isMappableTo,
  SUBTYPE_PROVIDER_ACCOUNT_TYPES,
  suggestAccountIdentities,
  validateProviderMapping,
} from './suggest-account-identities'
export {
  type AccountIdentityRow,
  type AccountIdentityState,
  type AccountSuggestionReason,
  type BooksBalanceDiscrepancy,
  type BooksBalanceReport,
  type BuiltEntry,
  type ChartAccountRow,
  type ChartImportPlan,
  type ChartImportResult,
  type ClosePeriod,
  type CounterpartyType,
  type EntryPreview,
  type FailedExport,
  type GlPostingLineInput,
  NON_FAILURE_REFUSALS,
  POSTING_EXPORT_STATUSES,
  POSTING_STATUSES,
  POSTING_TYPES,
  type PostEntryInput,
  type PostEntryResult,
  type PostEntryStatus,
  type PostFailureClass,
  type PostingDetail,
  type PostingDetailLine,
  type PostingDirection,
  type PostingExportStatus,
  type PostingStatus,
  type PostingType,
  type PostResult,
  type PostResultStatus,
  type ProviderAccount,
  type ProviderBalanceRow,
  type ProviderBalanceSheet,
  ProviderPostError,
  type ResolvedPostingLine,
  type RoleAssignmentRow,
  type RoleAssignmentState,
} from './types'
