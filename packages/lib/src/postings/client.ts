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
export type {
  AcceptedPostingResult,
  PostingReplanResult,
  PreparedEffectMember,
  PreparedEffectPosting,
} from './accept-entry'
export { accountLabel, compareAccountsByCodeThenName, type NamedAccount } from './account-label'
export {
  accountSubtypeLabel,
  GL_ACCOUNT_SUBTYPES,
  type GlAccountSubtypeValue,
} from './account-subtype'
// ── plans/accounting/tasks/25 4: one credit memo entry per period ───────────
export {
  type BuildCreditMemoBatchEntryInput,
  type BuiltCreditMemoBatchEntry,
  buildCreditMemoBatchEntry,
  CREDIT_MEMO_CONTACT_SOURCE_TYPE,
  type CreditMemoBatchSource,
  creditMemoBatchPeriodKey,
  MAX_COMPACT_CREDIT_MEMO_BATCH_KEY,
  MAX_CREDIT_MEMO_BATCH_ATTEMPT,
} from './build-credit-memo-batch-entry'
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
  type CreditMemoSettlement,
  computeCreditMemoAmounts,
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
  roleAcceptsManualSource,
  roleScopeAxis,
  SCOPABLE_ROLES,
  type ScopeAxis,
  type VendorBillEntryInput,
} from './build-entry'
// ── plans/accounting/tasks/21 §3.2: the standalone company's A/P bill ───────
// PURE - reaches nothing but `errors`, `build-entry`, `build-fulfillment-entry`
// and `period-key`, all of which are already on this surface.
export {
  type BuildExpenseBillEntryInput,
  type BuiltExpenseBillEntry,
  buildExpenseBillEntry,
  EXPENSE_BILL_POSTING_TYPE,
  EXPENSE_BILL_SOURCE_TYPE,
  type ExpenseBillLineInput,
} from './build-expense-bill-entry'
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
  PAYOUT_SOURCE_TYPE,
} from './build-payout-entry'
// ── plans/accounting/tasks/16: the chart import, pure half ─────────────────
// PURE. The two declared tables and the planner reach nothing but types.
export {
  PROVIDER_ACCOUNT_TYPE_SUBTYPE,
  planChartImport,
  ROLE_IMPORT_MATCH,
} from './chart-import-plan'
// ── One refusal, as the pieces of work it is made of ────────────────────────
// PURE - no database, no logger, no clock. On this surface because the close
// console renders the items as rows and the counts as badges, and a
// count-to-sentence function that ran only on the server would have to be
// written a second time in the browser. See close-blockers.ts's own header for
// why the sentence is derived from the items rather than beside them.
export {
  type CloseBlockerItem,
  type CloseBlockerItemKey,
  closeBlockerMessage,
  describeIncompleteRevenue,
  describeUnmappedRoles,
  type IncompleteRevenueCounts,
  incompleteRevenueLead,
  monthLabel,
} from './close-blockers'
export {
  type AccountCodeBand,
  CHART_PACK_KEYS,
  CHART_PACKS,
  type ChartPack,
  type ChartPackKey,
  CLEARING_ACCOUNT_CODE_BAND,
  DEFAULT_CHART_OF_ACCOUNTS,
  type DefaultChartAccount,
  GL_ACCOUNT_TYPES,
  type GlAccountTypeValue,
  MERCHANT_FEE_ACCOUNT_CODE_BAND,
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
  type AcceptedDocumentEffectBasisV1,
  acceptedDocumentEffectBasisSchema,
  DOCUMENT_EFFECT_FAMILIES,
  DOCUMENT_EFFECT_FAMILY_SPEC,
  type DocumentAccountingBasisV1,
  type DocumentEffectFamily,
  type DocumentEffectPostingType,
  type DocumentWorkBasisInput,
  documentAccountingBasisSchema,
  documentEffectFamilySchema,
  documentRoleScope,
  documentWorkBasisSchema,
  isDocumentEffectFamily,
} from './document-effect-types'
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
  type AcceptedAccountingEffectBasisV1,
  type AcceptedCustomerReceiptEffectBasisV1,
  type AcceptedFulfillmentEffectBasisV1,
  type AccountingWorkBasisInput,
  type AccountingWorkBasisInputV1,
  acceptedCustomerReceiptEffectBasisSchema,
  acceptedFulfillmentEffectBasisSchema,
  accountingWorkBasisSchema,
  accountingWorkBasisSchemaV1,
  type CustomerReceiptAccountingBasisV1,
  type CustomerReceiptWorkBasisInput,
  customerReceiptAccountingBasisSchema,
  customerReceiptWorkBasisSchema,
  type FulfillmentAccountingBasisV1,
  fulfillmentAccountingBasisSchema,
} from './effect-types'
// The gate's prose and vocabulary. PURE - the queue panel renders findings as
// rows, and a label that only existed on the server would have to be written a
// second time in the browser. See `export-gate/findings.ts`'s own header.
export {
  CLAIMED_SOURCE_STREAMS,
  claimedSourceStreams,
  describeBankCoverageGap,
  describeUnbalancedEntry,
  describeUnreviewedBankLines,
  EXPORT_GATE_CHECKS,
  type ExportGateCheck,
  type ExportGateFinding,
  type ExportGateFindingKey,
  type ExportGateReport,
  type ExportGateSeverity,
  type ExportGateStatus,
  type ExportGateVerdict,
  exportGateLead,
  exportGateMessage,
  exportGateStatus,
  liftCloseBlockerItem,
} from './export-gate/client'
export type { PostingDeliveryIntent } from './insert-posting'
export {
  JOURNAL_ENTRY_POSTING_TYPE,
  type JournalEntryKindValue,
  type JournalEntryLine,
  type JournalEntryRecord,
  type JournalEntryStatusValue,
  type ListJournalEntriesFilters,
  type PostingSummary,
} from './journal-entries/client'
export { didLedgerAccept, isExpectedPostOutcome } from './ledger-accepted'
export { LEDGER_CURRENCY } from './ledger-currency'
// ── plans/accounting/tasks/26 §7.1: the code allocator ──────────────────────
// PURE - reaches `errors` and the band constants in `default-chart`, both of
// which are already on this surface. `mint-rail-accounts.ts` is the write half
// and stays server-only: it imports `@auxx/database`.
export { type CodedAccount, nextAccountCode } from './next-account-code'
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
// ── plans/accounting/tasks/26 §6: billed fees, shown and never accrued ───────
// Types only. `readRailFeeStatus` makes three database reads and stays
// server-only, exported from `./index`; the close console's Processor fees
// block renders this shape.
// ── plans/accounting/tasks/28 §2: the declared posting policy ────────────────
// PURE. What triggers each posting type, its entry as roles, the settings that
// change it and the sentences the Posting page and the guides render. The four
// regime tables below are derived views of it. `ExportRoute` is re-exported
// through `./regime` and is not repeated here.
export {
  LEDGER_WIDE_SETTING_KEYS,
  POSTING_POLICIES,
  POSTING_POLICY,
  type PostingParameter,
  type PostingPolicy,
  type PostingRecordLink,
  type PostingSettingCopy,
  type PostingTemplateLine,
  type PostingTrigger,
} from './policy'
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
  describeProviderSyncCoverage,
  isOurs,
  OUR_PROVIDER_TXN_TYPE,
  type OurEntryCheck,
  type OurEntryVerdict,
  type OurPostedEntry,
  type OurPostedLine,
  PROVIDER_SYNC_POSTING_TYPE,
  PROVIDER_SYNC_SCHEDULE_SETTING_KEY,
  PROVIDER_SYNC_SOURCE_TYPE,
  PROVIDER_SYNC_STATE_SETTING_KEY,
  PROVIDER_SYNCED_THROUGH_SETTING_KEY,
  type ProviderLedger,
  type ProviderLedgerEntry,
  type ProviderLedgerLine,
  type ProviderSyncCoverage,
  type ProviderSyncMarker,
  type ProviderSyncPlan,
  type ProviderSyncRange,
  type ProviderSyncReading,
  type ProviderSyncRunRecord,
  type ProviderSyncRunStatus,
  type ProviderSyncScheduleConfig,
  type ProviderSyncStateBlob,
  providerDisplayName,
} from './provider-sync/client'
export {
  groupProviderLedgerEntries,
  invertAccountMap,
  type PlanProviderSyncInput,
  planProviderSync,
  resolveProviderSyncLines,
} from './provider-sync/plan'
export {
  firstDayAfterMonth,
  type PlanSyncChunksInput,
  planSyncChunks,
  providerSyncFloor,
} from './provider-sync/range'
export type { RailFeeAccount, RailFeeStatus } from './rail-fee-status'
export {
  ENABLED_POSTING_TYPES,
  EXPORT_ROUTE_BY_POSTING_TYPE,
  type ExportRoute,
  INVENTORY_ROLES,
  SINGLE_WRITER_ROLES,
  SINGLE_WRITER_ROLES_BY_POSTING_TYPE,
} from './regime'
// ── plans/accounting/tasks/53 §7.3 (D16): the register, level A ─────────────
// PURE. `register.ts` reaches nothing but `zod` and two type-only imports from
// `types`, which is already on this surface. The db half is `read-register.ts`
// and stays server-only, exported from `./index`.
export {
  type PostingRegister,
  projectRegisterEntry,
  type RegisterAccountLabel,
  type RegisterContributionLine,
  type RegisterDocumentRef,
  type RegisterEffectRow,
  type RegisterEntry,
  registerTiesToPosting,
  registerTotalMinor,
} from './register'
// ── Statements (HANDOFF slot 1E, wave 1) - pure pieces only. The reads
// (`readTrialBalance`, `readBalanceSheet`, `readProfitAndLoss`,
// `readCompleteness`, `readGeneralLedger`) and the PDF render touch a database
// or react-pdf/S3 and stay server-only, exported from `./index` only. ────────
export {
  balanceSheetColumns,
  GENERAL_LEDGER_COLUMNS,
  TRIAL_BALANCE_COLUMNS,
  toBalanceSheetRows,
  toGeneralLedgerRows,
  toProfitAndLossRows,
  toTrialBalanceRows,
  toTrialBalanceStatementRows,
} from './reports/adapters'
export type { BalanceSheet, BalanceSheetRow, BalanceSheetSnapshot } from './reports/balance-sheet'
export type { Completeness, CompletenessItem } from './reports/completeness'
export {
  DEFAULT_FISCAL_YEAR_START_MONTH,
  FISCAL_YEAR_START_MONTH_OPTIONS,
  FISCAL_YEAR_START_MONTH_SETTING_KEY,
  fiscalYearStart,
  normalizeFiscalYearStartMonth,
  previousCalendarDay,
} from './reports/fiscal-year'
// The general ledger (task 21 §5). Types only: `readGeneralLedger` and its
// `GENERAL_LEDGER_MAX_LINES` guard are a db read and a server policy, and stay
// on `./index`. `toGeneralLedgerRows`/`GENERAL_LEDGER_COLUMNS` are pure and
// come through the adapters block above, like every other statement's.
export type { AccountLineRow, GeneralLedger, GeneralLedgerAccount } from './reports/general-ledger'
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
export type {
  TrialBalanceRetainedEarnings,
  TrialBalanceStatement,
} from './reports/trial-balance-statement'
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
  describeUnscopedSources,
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
  type UnscopedSourceConnection,
  type UnscopedSourceRole,
  type UnscopedSourceWarning,
} from './setup-readiness'
// The shared `FinancialSourceAccount` label: `name` first, then a
// provider-aware derivation, so every renderer - and `source-scope.ts`'s
// `RoleSourceRow.name` - agrees on one answer instead of five copies of
// `providerKey · externalAccountId`.
export {
  isManualSource,
  type SourceAccountSubject,
  sourceAccountLabel,
  sourceAccountTooltip,
  sourceProviderLabel,
} from './source-account-label'
export {
  type AccountSuggestion,
  isMappableTo,
  SUBTYPE_PROVIDER_ACCOUNT_TYPES,
  suggestAccountIdentities,
  validateProviderMapping,
} from './suggest-account-identities'
// The manual bucket's identity, for screens that render a source account and
// have to tell the sentinel row apart from a connected one (`source-scope.ts`).
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
  MANUAL_SOURCE_EXTERNAL_ID,
  MANUAL_SOURCE_LABEL,
  MANUAL_SOURCE_PROVIDER_KEY,
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
  type RoleRailAssignmentRow,
  type RoleSourceAssignmentRow,
  type RoleSourceRow,
  type RoleSourceScope,
  SYNC_QUEUE_STATES,
  type SyncQueueRow,
  type SyncQueueState,
  syncQueueState,
  type UnsyncOutcome,
  type UnsyncResult,
} from './types'
