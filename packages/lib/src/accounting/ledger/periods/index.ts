// packages/lib/src/accounting/ledger/periods/index.ts

export { listClosePeriods } from './close-periods'
// ── plans/accounting/tasks/28 §6: the ledger sidebar's "This month" group ────
export {
  type MonthActivity,
  type PostingTypeActivity,
  type ReadMonthActivityOptions,
  readMonthActivity,
} from './month-activity'
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
  monthDateRange,
  type ParsedPeriodKey,
  type PeriodGranularity,
  type PeriodLock,
  parsePeriodKey,
  periodKeyForDate,
  periodMonth,
} from './periods'
export { type CloseBlockersResult, readCloseBlockers } from './read-close-blockers'
export { type SetLockedThroughInput, setLockedThrough } from './set-locked-through'
export { assertAccountingSetupUnfrozen, FROZEN_SETUP_SETTING_KEYS } from './settled-periods'
