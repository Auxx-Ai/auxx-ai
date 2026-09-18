// packages/lib/src/accounting/journals/entries/index.ts
//
// Server entry point for the journal-entry draft - the record a bookkeeper
// types a posting into, and the holder of the opening trial balance
// (plans/accounting/tasks/done/02-manual-journal-entry.md, HANDOFF decision 6.7).
//
// Client code must import `@auxx/lib/accounting/journals/client`, never this barrel: the
// writes pull `UnifiedCrudHandler` and the whole server graph behind it.

export {
  JOURNAL_ENTRY_POSTING_TYPE,
  type JournalEntryKindValue,
  type JournalEntryLine,
  type JournalEntryRecord,
  type JournalEntryStatusValue,
  type ListJournalEntriesFilters,
  type PostingSummary,
} from './client'
export {
  JOURNAL_ENTRY_ATTRIBUTES,
  type JournalEntryAttribute,
  type JournalEntryFieldContext,
  loadJournalEntryFieldContext,
  requireJournalEntryFieldContext,
} from './fields'
export {
  getJournalEntry,
  linesFromBuilt,
  listJournalEntries,
  type RecurrenceIdentity,
  readRecurrenceIdentities,
  requireJournalEntry,
} from './reads'
export {
  assertJournalEntryIsDraft,
  type JournalEntryRefusalSubject,
} from './refusals'
export {
  type CreateJournalEntryInput,
  createJournalEntry,
  discardJournalEntry,
  type PreviewJournalEntryInput,
  postJournalEntry,
  previewJournalEntry,
  reverseJournalEntry,
  type UpdateJournalEntryInput,
  updateJournalEntry,
} from './writes'
