// packages/lib/src/accounting/journals/entries/index.ts
//
// Server entry point for the journal-entry document - the record a bookkeeper
// types a posting into, with its `journal_entry_line` children, and the holder of
// the opening trial balance (91 D5).
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
  JOURNAL_ENTRY_LINE_ATTRIBUTES,
  type JournalEntryAttribute,
  type JournalEntryFieldContext,
  type JournalEntryLineAttribute,
  type JournalEntryLineFieldContext,
  loadJournalEntryFieldContext,
  loadJournalEntryLineFieldContext,
  requireJournalEntryFieldContext,
  requireJournalEntryLineFieldContext,
} from './fields'
export {
  getJournalEntry,
  listJournalEntries,
  type RecurrenceIdentity,
  readJournalEntryLines,
  readRecurrenceIdentities,
  requireJournalEntry,
} from './reads'
export {
  assertJournalEntryIsDraft,
  type JournalEntryRefusalSubject,
} from './refusals'
export {
  buildEntryForJournalEntry,
  type CreateJournalEntryInput,
  createJournalEntry,
  discardJournalEntry,
  type PreviewJournalEntryInput,
  postBuiltJournalEntry,
  postJournalEntry,
  previewJournalEntry,
  reverseJournalEntry,
  type UpdateJournalEntryInput,
  updateJournalEntry,
} from './writes'
