// packages/lib/src/recurrence/index.ts
//
// The generic recurrence core (plans/dispatch/06-recurring-engine.md §2) plus the
// `RecurrenceRule` table it is stored in. Consumers: the dispatch visit materializer
// (`packages/lib/src/dispatch/recurring/`), MI2's invoice-draft scheduler, the recurring
// journal sweep.
//
// `./rules` touches `@auxx/database`, so this barrel is server-only; `./client` re-exports
// the pure half for client code.

export { RECURRENCE_HORIZON_DAYS } from './constants'
export type { DescribeRecurrenceOptions, RecurrenceDescriptionParts } from './describe'
export { describeRecurrence, describeRecurrenceParts } from './describe'
export type { ExpandOccurrencesOptions, RecurrenceOccurrence } from './expand'
export { expandOccurrences, localDateStartUtc } from './expand'
export type {
  RecurrenceRuleRow,
  RecurrenceSubject,
  UpsertRecurrenceRuleInput,
} from './rules'
export {
  advanceRecurrenceCursor,
  deleteRecurrenceRule,
  getRecurrenceRule,
  getRecurrenceRuleById,
  listDueRecurrenceRules,
  listRecurrenceRules,
  updateRecurrencePattern,
  upsertRecurrenceRule,
} from './rules'
export type { NthWeekdayOrdinal, RecurrencePattern, Weekday } from './types'
export { recurrencePatternSchema } from './types'
