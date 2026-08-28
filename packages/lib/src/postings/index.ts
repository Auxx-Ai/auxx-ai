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
  ACCOUNT_ROLES,
  type AccountRole,
  type BuildEntryInput,
  buildEntry,
  buildReceiptEntry,
  buildVendorBillEntry,
  type ReceiptEntryInput,
  type VendorBillEntryInput,
} from './build-entry'
export {
  DEFAULT_CHART_OF_ACCOUNTS,
  type DefaultChartAccount,
} from './default-chart'
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
