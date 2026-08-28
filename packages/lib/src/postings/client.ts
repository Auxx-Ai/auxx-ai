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
