// packages/lib/src/accounting/journals/index.ts
//
// Server entry point for journals: the hand-authored entry (`./entries`) and the
// template the sweep copies into one (`./recurring`).
//
// Client code must import `@auxx/lib/accounting/journals/client`, never this
// barrel: the writes pull `UnifiedCrudHandler` and the whole server graph.

export {
  type CreateJournalEntryInput,
  createJournalEntry,
  discardJournalEntry,
  getJournalEntry,
  JOURNAL_ENTRY_POSTING_TYPE,
  type JournalEntryKindValue,
  type JournalEntryLine,
  type JournalEntryRecord,
  type JournalEntryStatusValue,
  type ListJournalEntriesFilters,
  listJournalEntries,
  type PostingSummary,
  type PreviewJournalEntryInput,
  postJournalEntry,
  previewJournalEntry,
  reverseJournalEntry,
  type UpdateJournalEntryInput,
  updateJournalEntry,
} from './entries'
export {
  clearRecurringJournalSchedule,
  findGeneratedEntryIds,
  getRecurringJournalRule,
  listRecurringJournalTemplates,
  type MaterializeRecurringJournalsResult,
  materializeRecurringJournals,
  planForRule,
  planRecurringOccurrences,
  RECURRING_JOURNAL_DOC_PREFIX,
  RECURRING_JOURNAL_SUBJECT_TYPE,
  type RecurrenceRuleRow,
  type RecurringJournalIdentity,
  type RecurringJournalPlan,
  type RecurringJournalSweepSummary,
  type RecurringJournalTemplate,
  type RecurringJournalWindow,
  recurringJournalPeriodKey,
  recurringJournalSourceId,
  type SetRecurringJournalScheduleInput,
  setRecurringJournalSchedule,
  sweepRecurringJournals,
} from './recurring'
