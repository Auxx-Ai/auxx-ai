// packages/lib/src/postings/journal-entries/index.ts
//
// Server entry point for the journal-entry draft - the record a bookkeeper
// types a posting into, and the holder of the opening trial balance
// (plans/accounting/tasks/02-manual-journal-entry.md, HANDOFF decision 6.7).
//
// Client code must import `@auxx/lib/postings/client`, never this barrel: the
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
  getJournalEntry,
  type JournalEntryFieldContext,
  listJournalEntries,
  loadJournalEntryFieldContext,
  parseLines,
  requireJournalEntry,
  requireJournalEntryFieldContext,
} from './reads'
export {
  type CreateJournalEntryInput,
  createJournalEntry,
  type PreviewJournalEntryInput,
  postJournalEntry,
  previewJournalEntry,
  reverseJournalEntry,
  type UpdateJournalEntryInput,
  updateJournalEntry,
} from './writes'
