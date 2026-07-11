// packages/lib/src/recurrence/index.ts
//
// The generic recurrence core (plans/dispatch/06-recurring-engine.md §2) — pure, client-safe,
// no DB/server deps. First consumer: the dispatch visit materializer
// (`packages/lib/src/dispatch/recurring/`); MI2's invoice-draft scheduler is the second.
// Same barrel is re-exported by `./client` since the whole module is already client-safe.

export { RECURRENCE_HORIZON_DAYS } from './constants'
export type { DescribeRecurrenceOptions } from './describe'
export { describeRecurrence } from './describe'
export type { ExpandOccurrencesOptions, RecurrenceOccurrence } from './expand'
export { expandOccurrences } from './expand'
export type { NthWeekdayOrdinal, RecurrencePattern, Weekday } from './types'
export { recurrencePatternSchema } from './types'
