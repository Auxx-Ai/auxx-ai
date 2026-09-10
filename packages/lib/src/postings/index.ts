// packages/lib/src/postings/index.ts
//
// Server entry point for the postings module - our own double-entry ledger
// (plans/purchasing/README.md decisions P1/P2, build plan section 7).
//
// The accounting system is an exporter. Postings are built here, balanced here,
// keyed on account CODES here, and only then handed to whichever
// `AccountingProvider` an organization has connected - possibly none.
//
// Client code must import `@auxx/lib/postings/client`, never this barrel.

export {
  type AccountIdentityMap,
  confirmSuggestedIdentities,
  listAccountIdentities,
  resolveProviderAccountIds,
  type SetAccountIdentityOptions,
  setAccountIdentity,
} from './account-identities'
export { accountLabel, compareAccountsByCodeThenName, type NamedAccount } from './account-label'
export {
  accountSubtypeLabel,
  GL_ACCOUNT_SUBTYPES,
  type GlAccountSubtypeValue,
} from './account-subtype'
// ── plans/accounting/tasks/10: credit memos, one document for "you owe us less" ──
export {
  type BuildCreditMemoEntryInput,
  type BuiltCreditMemoEntry,
  buildCreditMemoEntry,
  CREDIT_MEMO_POSTING_TYPE,
  CREDIT_MEMO_SOURCE_TYPE,
  type CreditMemoSettlement,
} from './build-credit-memo-entry'
// ── plans/accounting/tasks/07: customer deposits are a liability ────────────
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
} from './build-fulfillment-entry'
// ── plans/accounting/tasks/08: the receivable nothing debits ────────────────
export {
  type BuildInvoiceEntryInput,
  type BuiltInvoiceEntry,
  buildInvoiceEntry,
  INVOICE_ISSUED_POSTING_TYPE,
  INVOICE_SOURCE_TYPE,
} from './build-invoice-entry'
// ── HANDOFF slot 1A: manual journal entries ───────────────────────────────
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
// ── HANDOFF slot 2K (accountant profile, 1099/W-9, write-off) ──────────────
export {
  type BuildWriteOffEntryInput,
  buildWriteOffEntry,
  MAX_WRITE_OFF_ATTEMPT,
  WRITE_OFF_SOURCE_TYPE,
  writeOffPeriodKey,
} from './build-write-off-entry'
// ── plans/accounting/tasks/16: the chart import ─────────────────────────────
export { type ImportChartOptions, importChartFromProvider } from './chart-import'
export {
  PROVIDER_ACCOUNT_TYPE_SUBTYPE,
  planChartImport,
  ROLE_IMPORT_MATCH,
} from './chart-import-plan'
export {
  type CreateChartAccountOptions,
  createChartAccount,
  type RemoveChartAccountOptions,
  removeChartAccount,
  restoreChartAccount,
  type UpdateChartAccountOptions,
  updateChartAccount,
} from './chart-write'
export {
  type PostMonthEndOptions,
  type PreviewMonthEndOptions,
  postMonthEnd,
  previewMonthEnd,
} from './close-month'
export { listClosePeriods } from './close-periods'
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
  buildPostingDraft,
  type MonthEndInventorySnapshot,
  POSTING_DRAFT_VERSION,
  type PostingAssertions,
  type PostingDraftV1,
  parsePostingDraft,
  requiresAssertions,
  reverseAssertions,
} from './draft'
// ── plans/accounting/tasks/18: two feeds, one author, unit 1 ───────────────
export {
  type DuplicateMovementEntry,
  type DuplicateMovementFinding,
  type FindDuplicateBankMovementsOptions,
  findDuplicateBankMovements,
} from './duplicate-movements'
export { gatherMonthEndInventoryInputs } from './gather-month-end-inventory'
export {
  type CreateJournalEntryInput,
  createJournalEntry,
  discardJournalEntry,
  getJournalEntry,
  JOURNAL_ENTRY_POSTING_TYPE,
  type JournalEntryKindValue,
  type JournalEntryLine,
  type JournalEntryRecord,
  type JournalEntryStatusValue,
  type ListJournalEntriesFilters,
  listJournalEntries,
  type PostingSummary,
  type PreviewJournalEntryInput,
  postJournalEntry,
  previewJournalEntry,
  reverseJournalEntry,
  type UpdateJournalEntryInput,
  updateJournalEntry,
} from './journal-entries'
export { listPostings, listPostingsForSource } from './list-postings'
export {
  FINALIZED_SETUP_STATE,
  OPENING_BASELINE_SETTING_KEYS,
  type OpeningBaseline,
  readOpeningBaseline,
} from './opening-baseline'
// ── plans/accounting/tasks/19: opening balances from the provider, pure half ──
export {
  type ProviderOpeningFillInput,
  type ProviderOpeningFillPlan,
  planProviderOpeningFill,
} from './opening-fill-plan'
export {
  fillOpeningTrialBalanceFromProvider,
  findOpeningTrialBalanceEntry,
  OPENING_TRIAL_BALANCE_FREEZE_KEY,
  OPENING_TRIAL_BALANCE_KIND,
  type OpeningTrialBalancePosting,
  type OpeningTrialBalanceRow,
  type OpeningTrialBalanceView,
  type ProviderOpeningFillOutcome,
  postOpeningTrialBalance,
  previewOpeningTrialBalance,
  readOpeningTrialBalance,
  requireCutoverDate,
  rowsToJournalEntryLines,
  type SaveOpeningTrialBalanceInput,
  saveOpeningTrialBalance,
  sortChartAccountsForStatement,
} from './opening-trial-balance'
export {
  assertCompactablePeriodKey,
  hashedPeriodKey,
  MAX_COMPACT_PERIOD_KEY,
} from './period-key'
export { PERIOD_LOCK_SETTING_KEY, resolvePeriodLock } from './period-lock'
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
  type EntryPreview,
  LEDGER_CURRENCY,
  type PostEntryOptions,
  type PreviewEntryOptions,
  postEntry,
  previewEntry,
} from './post-entry'
export { type PostPayoutEntryOptions, postPayoutEntry } from './post-payout-entry'
export {
  type AccountingProvider,
  type AccountingProviderFactory,
  type ConnectedProviderResolver,
  getAccountingProvider,
  listAccountingProviderIds,
  NONE_ACCOUNTING_PROVIDER,
  NONE_PROVIDER_ID,
  registerAccountingProvider,
  resolveAccountingProvider,
  setConnectedProviderResolver,
} from './provider'
export { getPosting, readPostingLineSourceIds } from './read-posting'
export {
  ENABLED_POSTING_TYPES,
  EXPORT_ROUTE_BY_POSTING_TYPE,
  type ExportRoute,
  findInventoryWriterConflicts,
  findWriterConflicts,
  INVENTORY_ROLES,
  INVENTORY_ROLES_BY_POSTING_TYPE,
  type InventoryWriterConflict,
  SINGLE_WRITER_ROLES,
  SINGLE_WRITER_ROLES_BY_POSTING_TYPE,
  type WriterConflict,
} from './regime'
// ── Statements (HANDOFF slot 1E, wave 1) ────────────────────────────────────
export {
  type AccountLineRow,
  type AccountLines,
  type ReadAccountLinesOptions,
  readAccountLines,
} from './reports/account-lines'
export {
  balanceSheetColumns,
  TRIAL_BALANCE_COLUMNS,
  toBalanceSheetRows,
  toProfitAndLossRows,
  toTrialBalanceRows,
} from './reports/adapters'
// ── Aging (HANDOFF slot 2H, wave 2) ─────────────────────────────────────────
export {
  AGING_BUCKET_LABELS,
  AGING_COLUMNS,
  AGING_UNAPPLIED_GROUP_ID,
  type Aging,
  type AgingBucketKey,
  type AgingDocument,
  type AgingGroup,
  type AgingSide,
  agingBucket,
  type ReadAgingOptions,
  readAging,
  toAgingRows,
} from './reports/aging'
export {
  type BalanceSheet,
  type BalanceSheetRow,
  type BalanceSheetSnapshot,
  type ReadBalanceSheetOptions,
  readBalanceSheet,
} from './reports/balance-sheet'
export {
  type Completeness,
  type CompletenessItem,
  type ReadCompletenessOptions,
  readCompleteness,
} from './reports/completeness'
export {
  type DimensionBreakdownRow,
  type ReadDimensionBreakdownOptions,
  readDimensionBreakdown,
} from './reports/dimension-breakdown'
export { fiscalYearStart, previousCalendarDay } from './reports/fiscal-year'
export {
  type RenderStatementPdfOptions,
  type RenderStatementPdfParamsByKind,
  type RenderStatementPdfResult,
  renderStatementPdf,
  type StatementKind,
} from './reports/pdf/render-statement-pdf'
export {
  type ProfitAndLoss,
  type ProfitAndLossRow,
  type ProfitAndLossSnapshot,
  type ReadProfitAndLossOptions,
  readProfitAndLoss,
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
export {
  type ReadTrialBalanceOptions,
  readTrialBalance,
  type TrialBalance,
  type TrialBalanceRow,
} from './reports/trial-balance'
export {
  type ReadVendor1099SummaryOptions,
  readVendor1099Summary,
  toVendor1099CsvRows,
  toVendor1099Rows,
  VENDOR_1099_COLUMNS,
  VENDOR_1099_THRESHOLD_MINOR,
  type Vendor1099Row,
  type Vendor1099Summary,
} from './reports/vendor-1099'
export {
  loadRoleAccountCodes,
  type ResolvedAccount,
  resolveAccountLines,
  resolveRoles,
} from './resolve-roles'
export { retryExport } from './retry-export'
export { type ReverseEntryOptions, reverseEntry } from './reverse-entry'
export {
  listChartAccounts,
  listChartAccountUsage,
  listRoleMap,
  type SetRoleAssignmentOptions,
  setRoleAssignment,
} from './role-map'
export { assertAccountingSetupUnfrozen, FROZEN_SETUP_SETTING_KEYS } from './settled-periods'
export {
  type OpeningTrialBalanceSummary,
  openingTrialBalanceDifference,
  resolveSetupReadiness,
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
  type BuiltEntry,
  type ChartAccountRow,
  type ChartImportPlan,
  type ChartImportResult,
  type ClosePeriod,
  type CounterpartyType,
  type GlPostingLineInput,
  NON_FAILURE_REFUSALS,
  POSTING_STATUSES,
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
  type ProviderBalanceRow,
  type ProviderBalanceSheet,
  ProviderPostError,
  type ResolvedPostingLine,
  type RoleAssignmentRow,
  type RoleAssignmentState,
} from './types'
export {
  type BooksBalanceDiscrepancy,
  type BooksBalanceReport,
  type FailedExport,
  listFailedExports,
  verifyBooksBalance,
} from './verify-balance'
