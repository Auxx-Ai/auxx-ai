// packages/lib/src/accounting/journals/client.ts
//
// The client-safe half of `accounting/journals/`: the entry's shapes and the
// recurrence keyspace and window (docs/lib-module-guide.md §7).
//
// NOTE: no 'use client' directive - server code imports this file too, and the
// directive would turn every export into a client-reference proxy there.

export {
  JOURNAL_ENTRY_POSTING_TYPE,
  type JournalEntryKindValue,
  type JournalEntryLine,
  type JournalEntryRecord,
  type JournalEntryStatusValue,
  type ListJournalEntriesFilters,
  type PostingSummary,
} from './entries/client'
export {
  planRecurringOccurrences,
  RECURRING_JOURNAL_DOC_PREFIX,
  RECURRING_JOURNAL_SUBJECT_TYPE,
  type RecurringJournalIdentity,
  type RecurringJournalPlan,
  type RecurringJournalWindow,
  recurringJournalPeriodKey,
  recurringJournalSourceId,
} from './recurring/client'
