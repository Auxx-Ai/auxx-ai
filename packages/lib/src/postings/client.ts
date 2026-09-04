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
// ── HANDOFF slot 2G: the revenue side ───────────────────────────────────────
// All three builders are PURE and reach nothing but `errors`, `build-entry` and
// `doc-number`, which are already on this surface. `post-payout-entry.ts` is
// deliberately NOT here - it imports `@auxx/database`.
export {
  type BuildFulfillmentEntryInput,
  type BuiltFulfillmentEntry,
  buildFulfillmentEntry,
  CHANNEL_REVENUE_ROLE,
  extendRateToAmount,
  FULFILLMENT_SOURCE_TYPE,
  type FulfillmentShippedLine,
  fulfillmentPeriodKey,
  type OrderChannelKey,
  toAmountMinor,
  toChannelKey,
} from './build-fulfillment-entry'
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
export {
  DEFAULT_CHART_OF_ACCOUNTS,
  type DefaultChartAccount,
  GL_ACCOUNT_TYPES,
  type GlAccountTypeValue,
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
export {
  JOURNAL_ENTRY_POSTING_TYPE,
  type JournalEntryKindValue,
  type JournalEntryLine,
  type JournalEntryRecord,
  type JournalEntryStatusValue,
  type ListJournalEntriesFilters,
  type PostingSummary,
} from './journal-entries/client'
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
export {
  ENABLED_POSTING_TYPES,
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
  TRIAL_BALANCE_COLUMNS,
  toBalanceSheetRows,
  toProfitAndLossRows,
  toTrialBalanceRows,
} from './reports/adapters'
export type { BalanceSheet, BalanceSheetRow, BalanceSheetSnapshot } from './reports/balance-sheet'
export type { Completeness, CompletenessItem } from './reports/completeness'
export { fiscalYearStart, previousCalendarDay } from './reports/fiscal-year'
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
  type ClosePeriod,
  type EntryPreview,
  type GlPostingLineInput,
  NON_FAILURE_REFUSALS,
  POSTING_TYPES,
  type PostEntryInput,
  type PostEntryResult,
  type PostEntryStatus,
  type PostFailureClass,
  type PostingDetail,
  type PostingDetailLine,
  type PostingDirection,
  type PostingType,
  type PostResult,
  type PostResultStatus,
  type ProviderAccount,
  ProviderPostError,
  type ResolvedPostingLine,
  type RoleAssignmentRow,
  type RoleAssignmentState,
  type UnpostedPeriod,
} from './types'
