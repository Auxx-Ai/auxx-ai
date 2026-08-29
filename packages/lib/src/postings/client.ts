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
export {
  type BuiltMonthEndInventoryDraft,
  buildMonthEndInventoryEntry,
  type MonthEndInventoryInputs,
} from './build-month-end-inventory'
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
} from './regime'
export {
  ABSORPTION_RATE_SETTING_KEYS,
  FINALIZED_SETUP_STATE,
  isValidTimeZone,
  isWholeMinorUnits,
  minorUnitError,
  OPENING_BASELINE_SETTING_KEYS,
  openingDifference,
  openingDifferenceRows,
  type ReadinessRequirement,
  readSettingMinorUnits,
  readSettingText,
  resolveSetupReadiness,
  SETUP_READINESS_SETTING_KEYS,
  type SettingsRecord,
  type SetupReadiness,
} from './setup-readiness'
export {
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
  ProviderPostError,
  type ResolvedPostingLine,
  type RoleAssignmentRow,
  type RoleAssignmentState,
  type UnpostedPeriod,
} from './types'
