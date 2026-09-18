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
  GL_ACCOUNT_TYPE_META,
  type GlAccountTypeMeta,
  glAccountTypeMeta,
} from '../resources/registry/gl-account-type-meta'
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
export { withAccountingCommitLock } from './accounting-commit-lock'
export {
  type AccountingBasisDimension,
  reservedAccountingBasis,
} from './basis-dimension'
export {
  type ActivateAccountingBookConnectionInput,
  accountingOpeningPolicySchema,
  activateAccountingBookConnection,
  activateAccountingBookConnectionInTx,
  type PinnedAccountingConnection,
  readAccountingBookConnectionStatus,
  readActiveBookConnection,
  readPinnedAccountingConnection,
  readPinnedAccountingConnectionInTx,
  repairAccountingBookConnection,
} from './book-connections'
export { readBookTimeZone, readBookTimeZoneOrUtc, todayInBookTimeZone } from './book-time-zone'
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
  type CreditMemoSettlement,
  computeCreditMemoAmounts,
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
  buildVendorBillEntry,
  ROLE_ACCOUNT_TYPES,
  roleAcceptsManualSource,
  roleScopeAxis,
  SCOPABLE_ROLES,
  type ScopeAxis,
  type VendorBillEntryInput,
} from './build-entry'
// ── plans/accounting/tasks/21 §3.2: the standalone company's A/P bill ───────
export {
  type BuildExpenseBillEntryInput,
  type BuiltExpenseBillEntry,
  buildExpenseBillEntry,
  EXPENSE_BILL_POSTING_TYPE,
  EXPENSE_BILL_SOURCE_TYPE,
  type ExpenseBillLineInput,
} from './build-expense-bill-entry'
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
export {
  type BuiltInventoryMovementEntry,
  buildInventoryMovementEntry,
  type InventoryDocumentKind,
  type InventoryMovementEntryInput,
  type InventoryMovementLine,
} from './build-inventory-movement-entry'
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
export { listClosePeriods } from './close-periods'
export {
  type CreateAndLinkOptions,
  type CreateAndLinkResult,
  createAndLinkProviderAccount,
} from './create-provider-account'
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
  buildPostingDraft,
  type MonthEndInventorySnapshot,
  POSTING_DRAFT_VERSION,
  type PostingAssertions,
  type PostingDraftV1,
  parsePostingDraft,
  reverseAssertions,
} from './draft'
export {
  discardDraftPosting,
  type UpdateDraftLinesInput,
  updateDraftLines,
} from './draft-lines'
// ── plans/accounting/tasks/18: two feeds, one author, unit 1 ───────────────
export {
  type DuplicateMovementEntry,
  type DuplicateMovementFinding,
  type FindDuplicateBankMovementsOptions,
  findDuplicateBankMovements,
} from './duplicate-movements'
// TARGET §3: the export batch - build, send, roll back, release, sweep.
export {
  type BuildExportBatchesInput,
  type BuildExportBatchesResult,
  buildExportBatches,
  countOutstandingExportBatches,
  EXPORT_OBJECT_TYPES,
  type ExportBatchMember,
  type ExportBatchRow,
  type ExportJournalPayload,
  type ExportObjectType,
  enqueueExportBatch,
  exportJournalSchema,
  hashExportPayload,
  JOURNAL_OBJECT_TYPE,
  type ListExportBatchesInput,
  listExportBatches,
  MAX_AUTO_ATTEMPTS,
  parseExportJournal,
  parseExportPayload,
  type ReleaseExportBatchesResult,
  type RollbackExportBatchResult,
  releaseExportBatches,
  retryExportBatch,
  rollbackExportBatch,
  type SendExportBatchResult,
  type SendExportBatchStatus,
  type ShapedPosting,
  type ShapeForPostingInput,
  type SweepExportBatchesInput,
  sendExportBatch,
  shapeForPosting,
  sweepExportBatches,
} from './export'
// TARGET §3: the export batch's settings, beside `autoPost`.
export {
  avenueOfPostingType,
  EXPORT_AVENUES,
  type ExportAvenue,
  type ExportSettings,
  SUMMARY_GRAIN_AVENUES,
  type SummaryGrain,
  type SummaryGrainAvenue,
} from './export-settings'
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
// ── plans/accounting/tasks/28 §3.2: the newest posting of each type ─────────
export { type LatestPostingByType, readLatestPostingsByType } from './latest-by-type'
export { didLedgerAccept, isExpectedPostOutcome } from './ledger-accepted'
export { listPostings, listPostingsForSource, type SourcePosting } from './list-postings'
// ── plans/accounting/tasks/26 §7: a clearing account per rail ───────────────
export {
  type MintedRailAccounts,
  type MintRailAccountsInput,
  mintRailAccounts,
} from './mint-rail-accounts'
// ── plans/accounting/tasks/28 §6: the ledger sidebar's "This month" group ────
export {
  type MonthActivity,
  type PostingTypeActivity,
  type ReadMonthActivityOptions,
  readMonthActivity,
} from './month-activity'
export { type CodedAccount, nextAccountCode } from './next-account-code'
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
// ── plans/accounting/tasks/28 §2: the declared posting policy ────────────────
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
export {
  type EntryPreview,
  LEDGER_CURRENCY,
  type PostDraftOptions,
  type PostEntryOptions,
  type PreviewEntryOptions,
  postDraft,
  postEntry,
  previewEntry,
} from './post-entry'
export {
  exportInventoryMovement,
  type InventoryDocumentSubject,
  inventoryTxnDate,
  linkMovementsToPosting,
  postInventoryMovementInTx,
  reverseInventoryMovementPosting,
  reversePostingForMovement,
} from './post-inventory-movement'
export { type PostPayoutEntryOptions, postPayoutEntry } from './post-payout-entry'
export {
  type AccountingProvider,
  type AccountingProviderFactory,
  type ConnectedProviderResolver,
  type CreateProviderAccountInput,
  type CreateProviderAccountResult,
  getAccountingProvider,
  listAccountingProviderIds,
  NONE_ACCOUNTING_PROVIDER,
  NONE_PROVIDER_ID,
  registerAccountingProvider,
  resolveAccountingProvider,
  setConnectedProviderResolver,
  supportsCreatingProviderAccounts,
} from './provider'
// ── plans/accounting/tasks/20 §8: do our books and theirs agree, pure ───────
export {
  type PlanProviderAgreementInput,
  type ProviderAgreement,
  type ProviderAgreementRow,
  type ProviderAgreementStatus,
  planProviderAgreement,
} from './provider-agreement'
// ── plans/accounting/tasks/20 §5-§7: the inbound half of the seam ───────────
// Read their general ledger, drop everything auxx authored, check those against
// our own copies, and write the remainder as our own rows.
export {
  createProviderSyncRunLedger,
  createProviderSyncStateStore,
  type DeferredEntry,
  describeProviderSyncCoverage,
  enqueueProviderSync,
  groupProviderLedgerEntries,
  invertAccountMap,
  isOurs,
  type MirrorChunkOutcome,
  type MirrorEntry,
  OUR_PROVIDER_TXN_TYPE,
  type OurEntryCheck,
  type OurEntryVerdict,
  type OurLedgerIdentity,
  type OurPostedEntry,
  type OurPostedLine,
  type PlanProviderSyncInput,
  type PlanSyncChunksInput,
  PROVIDER_SYNC_POSTING_TYPE,
  PROVIDER_SYNC_RUN_STALE_MS,
  PROVIDER_SYNC_SCHEDULE_SETTING_KEY,
  PROVIDER_SYNC_SCHEDULED_JOB_NAME,
  PROVIDER_SYNC_SOURCE_TYPE,
  PROVIDER_SYNC_STATE_SETTING_KEY,
  PROVIDER_SYNCED_THROUGH_SETTING_KEY,
  type ProviderLedger,
  type ProviderLedgerEntry,
  type ProviderLedgerLine,
  type ProviderSyncChunkOutcome,
  type ProviderSyncCoverage,
  type ProviderSyncMarker,
  type ProviderSyncOutcome,
  type ProviderSyncPlan,
  type ProviderSyncRange,
  type ProviderSyncReading,
  type ProviderSyncRunRecord,
  type ProviderSyncRunStatus,
  type ProviderSyncScheduleConfig,
  type ProviderSyncStateBlob,
  type ProviderSyncTrigger,
  planProviderSync,
  planSyncChunks,
  providerDisplayName,
  providerSyncFloor,
  type ReadOurPostedEntriesInput,
  readActiveBookId,
  readMirrorForTranslation,
  readOurDocNumbers,
  readOurPostedEntries,
  readOurProviderEntryIds,
  readProviderSyncMarker,
  readProviderSyncRunState,
  reconcileProviderSyncSchedulers,
  recordProviderSyncedThrough,
  removeProviderSyncScheduler,
  resolveProviderSyncLines,
  type SyncProviderLedgerInput,
  syncProviderLedger,
  syncProviderSyncScheduler,
  type TranslateMirrorInput,
  type TranslateMirrorOutcome,
  translateMirrorRange,
  upsertMirrorChunk,
} from './provider-sync'
// ── plans/accounting/tasks/26 §6: billed fees, shown and never accrued ───────
export {
  type RailFeeAccount,
  type RailFeeStatus,
  type ReadRailFeeStatusOptions,
  readRailFeeStatus,
} from './rail-fee-status'
export { type CloseBlockersResult, readCloseBlockers } from './read-close-blockers'
export { readExportSettings } from './read-export-settings'
export { getPosting, readPostingLineSourceIds } from './read-posting'
// TARGET §6: the summarised view over the detail ledger.
export {
  type LedgerSummaryLine,
  type LedgerSummaryRow,
  type ReadLedgerSummaryOptions,
  readLedgerSummary,
} from './reads/ledger-summary'
export {
  ENABLED_POSTING_TYPES,
  EXPORT_ROUTE_BY_POSTING_TYPE,
  type ExportRoute,
  findInventoryWriterConflicts,
  findWriterConflicts,
  INVENTORY_ROLES,
  type InventoryWriterConflict,
  SINGLE_WRITER_ROLES,
  SINGLE_WRITER_ROLES_BY_POSTING_TYPE,
  type WriterConflict,
} from './regime'
// ── Statements (HANDOFF slot 1E, wave 1) ────────────────────────────────────
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
export {
  DEFAULT_FISCAL_YEAR_START_MONTH,
  FISCAL_YEAR_START_MONTH_OPTIONS,
  FISCAL_YEAR_START_MONTH_SETTING_KEY,
  fiscalYearStart,
  normalizeFiscalYearStartMonth,
  previousCalendarDay,
} from './reports/fiscal-year'
export { resolveFiscalYearStartMonth } from './reports/fiscal-year-setting'
// ── The general ledger (task 21 §5): the sixth statement ────────────────────
export {
  type AccountLineRow,
  GENERAL_LEDGER_MAX_LINES,
  type GeneralLedger,
  type GeneralLedgerAccount,
  type ReadGeneralLedgerOptions,
  readGeneralLedger,
} from './reports/general-ledger'
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
  type ReadTrialBalanceStatementOptions,
  readTrialBalanceStatement,
  type TrialBalanceRetainedEarnings,
  type TrialBalanceStatement,
} from './reports/trial-balance-statement'
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
  type RoleSourceScope,
  resolveAccountLines,
  resolveRoles,
} from './resolve-roles'
export {
  type ReverseEntriesOptions,
  type ReverseEntryOptions,
  reverseEntries,
  reverseEntry,
} from './reverse-entry'
export {
  listChartAccounts,
  listChartAccountUsage,
  listRoleMap,
  type SaveMappingRow,
  type SetRoleAssignmentOptions,
  saveRoleAssignments,
  setRoleAssignment,
} from './role-map'
export { type SetLockedThroughInput, setLockedThrough } from './set-locked-through'
export { assertAccountingSetupUnfrozen, FROZEN_SETUP_SETTING_KEYS } from './settled-periods'
export {
  type OpeningTrialBalanceSummary,
  openingTrialBalanceDifference,
  resolveSetupReadiness,
  type SetupReadiness,
  type SetupReadinessContext,
  summariseOpeningTrialBalance,
} from './setup-readiness'
// ── task 47: the sources a role map may be scoped to ────────────────────────
export {
  ensureManualSourceAccount,
  listRoleSources,
  MANUAL_SOURCE_EXTERNAL_ID,
  MANUAL_SOURCE_LABEL,
  MANUAL_SOURCE_PROVIDER_KEY,
  type RoleSourceRow,
  readManualSourceAccountId,
} from './source-scope'
export {
  type AccountSuggestion,
  isMappableTo,
  SUBTYPE_PROVIDER_ACCOUNT_TYPES,
  suggestAccountIdentities,
  validateProviderMapping,
} from './suggest-account-identities'
export { summaryGrainKey } from './summary-grain'
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
  type ReverseManyResult,
  type ReverseOutcome,
  type RoleAssignmentRow,
  type RoleAssignmentState,
  type RoleRailAssignmentRow,
  type WithdrawResult,
} from './types'
export {
  type BooksBalanceDiscrepancy,
  type BooksBalanceReport,
  verifyBooksBalance,
} from './verify-balance'
