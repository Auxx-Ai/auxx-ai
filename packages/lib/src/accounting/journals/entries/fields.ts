// packages/lib/src/accounting/journals/entries/fields.ts

/**
 * The def-and-field contexts every journal-entry read and write resolves before
 * it touches a row, picked from the registry rather than re-typed here. No
 * permission checks (`docs/lib-module-guide.md` §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { JOURNAL_ENTRY_FIELDS } from '../../../resources/registry/resources/journal-entry-fields'
import { JOURNAL_ENTRY_LINE_FIELDS } from '../../../resources/registry/resources/journal-entry-line-fields'
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
 * Resolve the `journal_entry` def and its fields, or `null` when the org lacks
 * them - a list on an unmigrated org renders empty. Writes use
 * {@link requireJournalEntryFieldContext}.
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
  required: ['journal_entry_date'],
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

/** Every `journal_entry_line` attribute a line is read from and written to. */
export const JOURNAL_ENTRY_LINE_ATTRIBUTES = pickSystemAttributes(JOURNAL_ENTRY_LINE_FIELDS, [
  'journal_entry_line_journal_entry',
  'journal_entry_line_gl_account',
  'journal_entry_line_side',
  'journal_entry_line_amount',
  'journal_entry_line_memo',
  'journal_entry_line_counterparty_type',
  'journal_entry_line_counterparty',
  'journal_entry_line_sort_order',
] as const)

export type JournalEntryLineAttribute = (typeof JOURNAL_ENTRY_LINE_ATTRIBUTES)[number]
export type JournalEntryLineFieldContext = SystemFieldContext<JournalEntryLineAttribute>

const JOURNAL_ENTRY_LINE = {
  required: [
    'journal_entry_line_journal_entry',
    'journal_entry_line_gl_account',
    'journal_entry_line_side',
    'journal_entry_line_amount',
  ],
  message:
    'Journal entry lines are not available until the journal_entry_line entity is provisioned. ' +
    'Run entity migration 187.',
} as const

/** The line def and its fields, or `null` on an org short of migration 187 - its entries read with no lines. */
export function loadJournalEntryLineFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<JournalEntryLineFieldContext | null> {
  return systemFields(
    db,
    organizationId,
    'journal_entry_line',
    JOURNAL_ENTRY_LINE_ATTRIBUTES,
    JOURNAL_ENTRY_LINE
  )
}

/** {@link loadJournalEntryLineFieldContext}, as the refusal a write path needs. */
export function requireJournalEntryLineFieldContext(
  db: ReadDb,
  organizationId: string
): Promise<JournalEntryLineFieldContext> {
  return requireSystemFields(
    db,
    organizationId,
    'journal_entry_line',
    JOURNAL_ENTRY_LINE_ATTRIBUTES,
    JOURNAL_ENTRY_LINE
  )
}
