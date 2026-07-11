// packages/lib/src/recurrence/client.ts
'use client'

// The recurrence core (plans/dispatch/06-recurring-engine.md §2) is already pure/client-safe —
// no `@auxx/database`/server deps — but per the repo's client-import convention (CLAUDE.md:
// "never import from `@auxx/lib/<module>` in client-side code, use the `/client` subpath"),
// client UI (the #7 schedule popover's Repeats row, the recurring Schedule section) imports
// from here rather than the bare `@auxx/lib/recurrence` barrel. Same barrel, re-exported (the
// `availability/client.ts` precedent).
export { RECURRENCE_HORIZON_DAYS } from './constants'
export type { DescribeRecurrenceOptions } from './describe'
export { describeRecurrence } from './describe'
export type { ExpandOccurrencesOptions, RecurrenceOccurrence } from './expand'
export { expandOccurrences } from './expand'
export type { NthWeekdayOrdinal, RecurrencePattern, Weekday } from './types'
export { recurrencePatternSchema } from './types'
