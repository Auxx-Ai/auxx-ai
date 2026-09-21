// packages/lib/src/accounting/journals/entries/fields.ts

/**
 * The def-and-field contexts every journal-entry read and write resolves before
 * it touches a row, picked from the registry rather than re-typed here.
 *
 * 🛑 `status` and `lines` are not `journal_entry` fields (TARGET §1): the record
 * is a pointer and both are read off the linked `GlPosting` row.
 *
 * Two slices rather than one: the recurrence identity is read on the poster's
 * collision path for records it already holds ids for, where the seven-field
 * list would fetch five values per record nothing on that path reads.
 *
 * No permission checks here or anywhere else in this module: the router asserts
 * (`docs/lib-module-guide.md` §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { JOURNAL_ENTRY_FIELDS } from '../../../resources/registry/resources/journal-entry-fields'
import { pickSystemAttributes } from '../../../resources/registry/system-attributes'
import {
  requireSystemFields,
  type SystemFieldContext,
  systemFields,
} from '../../../resources/system-records'

type ReadDb = Database | Transaction | undefined

/**
 * Every attribute a `JournalEntryRecord` is assembled from that is still a
 * `journal_entry` field.
 *
 * All optional below: entity migration 125 provisions them, and an org that has
 * not run it must read an empty list rather than 500.
 */
export const JOURNAL_ENTRY_ATTRIBUTES = pickSystemAttributes(JOURNAL_ENTRY_FIELDS, [
  'journal_entry_number',
  'journal_entry_date',
  'journal_entry_memo',
  'journal_entry_kind',
  'journal_entry_gl_posting_id',
  'journal_entry_recurrence_rule_id',
  'journal_entry_occurrence_date',
] as const)

export type JournalEntryAttribute = (typeof JOURNAL_ENTRY_ATTRIBUTES)[number]
export type JournalEntryFieldContext = SystemFieldContext<JournalEntryAttribute>

/** The rule-and-slot pair a generated entry is identified by; see {@link JOURNAL_ENTRY_ATTRIBUTES} for why it is its own slice. */
export const JOURNAL_ENTRY_RECURRENCE_ATTRIBUTES = pickSystemAttributes(JOURNAL_ENTRY_FIELDS, [
  'journal_entry_recurrence_rule_id',
  'journal_entry_occurrence_date',
] as const)

export type JournalEntryRecurrenceAttribute = (typeof JOURNAL_ENTRY_RECURRENCE_ATTRIBUTES)[number]
export type JournalEntryRecurrenceContext = SystemFieldContext<JournalEntryRecurrenceAttribute>

/**
 * Resolve the `journal_entry` def and its fields, or `null` when the org has
 * not run entity migration 125.
 *
 * `null` rather than a throw so a list surface on an unmigrated org renders
 * empty. The WRITE paths use {@link requireJournalEntryFieldContext} instead,
 * because a write that silently did nothing would be worse than a refusal.
 *
 * `journal_entry_gl_posting_id` is the one that makes the context usable at
 * all: without it there is no pointer to the posting that carries the entry's
 * status and lines.
 */
export function loadJournalEntryFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<JournalEntryFieldContext | null> {
  return systemFields(db, organizationId, 'journal_entry', JOURNAL_ENTRY_ATTRIBUTES, JOURNAL_ENTRY)
}

/** {@link loadJournalEntryFieldContext}, as the refusal a write path needs. */
export function requireJournalEntryFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<JournalEntryFieldContext> {
  return requireSystemFields(
    db,
    organizationId,
    'journal_entry',
    JOURNAL_ENTRY_ATTRIBUTES,
    JOURNAL_ENTRY
  )
}

const JOURNAL_ENTRY = {
  required: ['journal_entry_gl_posting_id', 'journal_entry_date'],
  message:
    'Journal entries are not available until the journal_entry entity and its fields are ' +
    'provisioned. Run the entity migrations.',
} as const

/** The recurrence slice, or `null` unless BOTH halves of the identity exist — half a pair names no slot. */
export function loadRecurrenceIdentityContext(
  db: ReadDb,
  organizationId: string
): Promise<JournalEntryRecurrenceContext | null> {
  return systemFields(db, organizationId, 'journal_entry', JOURNAL_ENTRY_RECURRENCE_ATTRIBUTES, {
    required: ['journal_entry_recurrence_rule_id', 'journal_entry_occurrence_date'],
  })
}
