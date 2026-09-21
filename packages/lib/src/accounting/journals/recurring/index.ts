// packages/lib/src/accounting/journals/recurring/index.ts
//
// Server entry point for recurring journal templates - the stencil, its
// schedule, and the daily sweep that copies it into drafts
// (plans/accounting/tasks/21-the-books-stand-alone.md §1).
//
// Client code must import `@auxx/lib/accounting/journals/recurring/client`, never
// this barrel: the writes pull `UnifiedCrudHandler` and the whole server graph
// behind it.

export {
  planRecurringOccurrences,
  RECURRING_JOURNAL_DOC_PREFIX,
  RECURRING_JOURNAL_SUBJECT_TYPE,
  type RecurringJournalIdentity,
  type RecurringJournalPlan,
  type RecurringJournalWindow,
  recurringJournalPeriodKey,
  recurringJournalSourceId,
} from './client'
export {
  type MaterializeRecurringJournalsResult,
  materializeRecurringJournals,
} from './materialize'
export {
  findGeneratedEntryIds,
  listRecurringJournalTemplates,
  planForRule,
  type RecurringJournalTemplate,
} from './reads'
export { type RecurringJournalSweepSummary, sweepRecurringJournals } from './sweep'
export {
  clearRecurringJournalSchedule,
  type SetRecurringJournalScheduleInput,
  setRecurringJournalSchedule,
} from './writes'
