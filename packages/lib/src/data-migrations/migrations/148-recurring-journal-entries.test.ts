// packages/lib/src/data-migrations/migrations/148-recurring-journal-entries.test.ts
//
// Migration 148 is two writes over a registry that already exists, so what can
// silently go wrong is never the write itself - it is the wiring:
//
//  - the id must be unique across a space shared with `data-migrations/`, which
//    has already collided once at 103;
//  - a registry field the migration names by hand must exist, or the migration
//    throws on every org at once;
//  - a new `systemAttribute` that is not in `SYSTEM_ATTRIBUTES` does not
//    typecheck, but a field whose attribute is in the union and whose key the
//    migration misspells creates one field fewer than it claims to;
//  - the appended option must preserve every stored one, because
//    `FieldValue.optionId` stores the `value` key and an org's existing
//    `manual` rows point at it by name.

import { describe, expect, it } from 'vitest'
import { JOURNAL_ENTRY_POSTING_TYPE } from '../../postings/journal-entries/client'
import {
  RECURRING_JOURNAL_DOC_PREFIX,
  RECURRING_JOURNAL_SUBJECT_TYPE,
} from '../../postings/recurring-journals/client'
import { JournalEntryKind } from '../../resources/registry/enum-values'
import { JOURNAL_ENTRY_FIELDS } from '../../resources/registry/resources/journal-entry-fields'
import { PER_ORG_MIGRATIONS } from '../registry'
import { migration148RecurringJournalEntries } from './148-recurring-journal-entries'

const MIGRATION_ID = '148-recurring-journal-entries'

describe('migration 148 registration', () => {
  it('is registered exactly once, and after 125 created the def it edits', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(ids.indexOf(MIGRATION_ID)).toBeGreaterThan(ids.indexOf('125-accounting-books'))
    expect(migration148RecurringJournalEntries.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 148 in the shared space', () => {
    const claiming = PER_ORG_MIGRATIONS.map((m) => m.id).filter((id) => id.startsWith('148-'))
    expect(claiming).toEqual([MIGRATION_ID])
  })
})

describe('what the migration writes exists in the registry', () => {
  // The migration reads these two by key. A rename in the registry with no
  // rename here throws `registry is missing ...` on every org in the batch,
  // which is loud - but only because this check exists in the migration at all.
  it('names both pointer fields by a key the registry actually has', () => {
    expect(JOURNAL_ENTRY_FIELDS.recurrenceRuleId).toBeDefined()
    expect(JOURNAL_ENTRY_FIELDS.occurrenceDate).toBeDefined()
    expect(JOURNAL_ENTRY_FIELDS.recurrenceRuleId?.systemAttribute).toBe(
      'journal_entry_recurrence_rule_id'
    )
    expect(JOURNAL_ENTRY_FIELDS.occurrenceDate?.systemAttribute).toBe(
      'journal_entry_occurrence_date'
    )
  })

  it('appends the option rather than replacing the set', () => {
    // 🛑 `FieldValue.optionId` stores the `value` key, so a rewrite that
    // dropped or renamed `manual` would orphan every existing entry's kind.
    const values = JournalEntryKind.values.map((option) => option.value)
    expect(values.slice(0, 3)).toEqual(['manual', 'opening_balance', 'recurring_template'])
    expect(values).toContain('recurring')
  })

  it('gives the new option a colour nothing else uses', () => {
    const colors = JournalEntryKind.values.map((option) => option.color)
    expect(new Set(colors).size).toBe(colors.length)
  })
})

describe('the shape the migration exists to enable', () => {
  it('maps the generated kind to its own posting type, never to manual_journal', () => {
    // The reason for the whole migration: `recurring` posts as
    // `recurring_journal`, whose `periodKey` is a fold of the rule and the
    // slot rather than the record number. Two drafts of one occurrence then
    // contend on one claim tuple; two `manual` drafts would post twice.
    expect(JOURNAL_ENTRY_POSTING_TYPE.recurring).toBe('recurring_journal')
  })

  it('schedules journal templates under their own subject type', () => {
    // A third value on a column that already carries `work_order_visits` and
    // `invoice_drafts`. Sharing one would put a visit schedule in the
    // accounting sweep's query.
    expect(RECURRING_JOURNAL_SUBJECT_TYPE).toBe('journal_entries')
    expect(RECURRING_JOURNAL_SUBJECT_TYPE).not.toBe('work_order_visits')
    expect(RECURRING_JOURNAL_SUBJECT_TYPE).not.toBe('invoice_drafts')
  })

  it('keeps the doc prefix off every one already taken', () => {
    expect(RECURRING_JOURNAL_DOC_PREFIX).toBe('RJE')
    expect(['INV', 'JNL', 'PMT', 'DPA']).not.toContain(RECURRING_JOURNAL_DOC_PREFIX)
  })
})
