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
export { type ResolvedAccount, resolveRoles } from './resolve-roles'
export {
  type BuiltEntry,
  type GlPostingLineInput,
  POSTING_TYPES,
  type PostEntryInput,
  type PostEntryResult,
  type PostEntryStatus,
  type PostingDirection,
  type PostingType,
  type ResolvedPostingLine,
} from './types'
