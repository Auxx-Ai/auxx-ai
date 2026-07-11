// packages/lib/src/recurrence/constants.ts
//
// Recurrence engine constants shared by the pure core and its consumers (dispatch visit
// materializer, MI2 invoice-draft scheduler).

/**
 * Rolling materialization horizon, in days: how far ahead a `RecurrenceRule` is expanded into
 * concrete rows by the daily sweep + on-write regeneration
 * (plans/dispatch/06-recurring-engine.md §1, §4.4). Fixed — no org-level override in v1.
 */
export const RECURRENCE_HORIZON_DAYS = 56
