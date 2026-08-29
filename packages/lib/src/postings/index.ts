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
export {
  type BuiltMonthEndInventoryDraft,
  buildMonthEndInventoryEntry,
  type MonthEndInventoryInputs,
} from './build-month-end-inventory'
export {
  type PostMonthEndOptions,
  type PreviewMonthEndOptions,
  postMonthEnd,
  previewMonthEnd,
} from './close-month'
export { listClosePeriods } from './close-periods'
export {
  DEFAULT_CHART_OF_ACCOUNTS,
  type DefaultChartAccount,
  type GlAccountTypeValue,
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
export { gatherMonthEndInventoryInputs } from './gather-month-end-inventory'
export {
  FINALIZED_SETUP_STATE,
  OPENING_BASELINE_SETTING_KEYS,
  type OpeningBaseline,
  readOpeningBaseline,
} from './opening-baseline'
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
export { getPosting } from './read-posting'
export {
  ENABLED_POSTING_TYPES,
  findInventoryWriterConflicts,
  INVENTORY_ROLES,
  INVENTORY_ROLES_BY_POSTING_TYPE,
  type InventoryWriterConflict,
} from './regime'
export { type ResolvedAccount, resolveRoles } from './resolve-roles'
export { type ReverseEntryOptions, reverseEntry } from './reverse-entry'
export {
  listChartAccounts,
  listRoleMap,
  type SetRoleAssignmentOptions,
  setRoleAssignment,
} from './role-map'
export {
  type BuiltEntry,
  type ChartAccountRow,
  type ClosePeriod,
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
  ProviderPostError,
  type ResolvedPostingLine,
  type RoleAssignmentRow,
  type RoleAssignmentState,
} from './types'
export {
  type BooksBalanceDiscrepancy,
  type BooksBalanceReport,
  listUnpostedPeriods,
  type UnpostedPeriod,
  verifyBooksBalance,
} from './verify-balance'
