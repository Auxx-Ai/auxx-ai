// packages/lib/src/accounting/ledger/periods/client.ts

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
