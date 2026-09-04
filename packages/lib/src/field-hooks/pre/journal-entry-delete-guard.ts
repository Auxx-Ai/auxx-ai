// packages/lib/src/field-hooks/pre/journal-entry-delete-guard.ts

import { parseRecordId } from '@auxx/types/resource'
import {
  assertJournalEntryHasNoPosting,
  assertJournalEntryIsDraft,
} from '../../postings/journal-entries/refusals'
import { unwrapStatusValue } from '../../resources/events/captured-values'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `journal-entries`
 * (plans/accounting/tasks/09-discard-a-draft-entry.md §3.3), modelled on
 * `invoice-delete-guard.ts`, which exists for this exact reason.
 *
 * 🛑 **`discardJournalEntry` is not the only door.** A journal entry is an
 * `EntityInstance`, so the generic `record.delete`, a bulk delete, and any
 * future Kopilot or API caller can reach the row without going near
 * `postings/journal-entries/writes.ts` at all - and before this guard, that path
 * hard-deleted a POSTED entry with no complaint, leaving its `GlPosting` in the
 * books pointing at a `sourceId` that no longer resolves.
 *
 * The rule is exactly the product's own, in the same two halves and the same two
 * sentences (`journal-entries/refusals.ts`): refuse anything that is not a
 * `draft`, then refuse a row that carries a `glPostingId` even when its status
 * still reads `draft`.
 *
 * ⚠️ **A draft is ALLOWED through.** The guard must not become a second,
 * stricter rule than the procedure it backs up: an unposted draft is a record a
 * person may throw away, and the product's own answer is to archive it. Anyone
 * who reaches the hard delete instead has said something more deliberate, and
 * the accounting invariant this file protects is untouched by it.
 *
 * ⚠️ **It reads the CAPTURED values, not a hydrated record.** `requireJournalEntry`
 * filters `archivedAt IS NULL`, so loading through it would make an already
 * DISCARDED draft - the common case for a later hard delete - read as "not
 * found" and refuse. `captureEventData` has the values on the event already.
 *
 * No admin gate, following `parts` and `tariff-codes`: the per-row
 * `record.delete` rule the mutation already asserts is the whole authorization
 * story, and the accounting rule below is about the record's state, not the
 * caller's rank.
 */
export const guardJournalEntryDelete: EntityPreDeleteHandler = async (event) => {
  const { entityInstanceId } = parseRecordId(event.recordId)

  const subject = {
    id: entityInstanceId,
    number: readText(event.values.journal_entry_number),
    // 🛑 Absence reads as `draft`, matching `reads.ts`'s `toRecord`: the field
    // carries `defaultValue: 'draft'` and a row written before the field existed
    // has no value row at all. Reading absence as anything else would let such a
    // row claim to be posted and become undeletable.
    status: readText(event.values.journal_entry_status) ?? 'draft',
    glPostingId: readText(event.values.journal_entry_gl_posting_id),
  }

  assertJournalEntryIsDraft(subject, 'deleted')
  assertJournalEntryHasNoPosting(subject, 'deleted')
}

/**
 * One captured value, reduced to a non-empty string or `null`.
 *
 * `unwrapStatusValue` first because the capture chain ARRAYS every
 * `ARRAY_RETURN_FIELD_TYPES` member regardless of how many values are stored -
 * `journal_entry_status` is a SINGLE_SELECT and arrives as `['posted']`, so a
 * bare `typeof === 'string'` test on it is always false. That mistake has
 * shipped twice; see `resources/events/captured-values.ts`.
 */
function readText(raw: unknown): string | null {
  const value = unwrapStatusValue(raw)
  return typeof value === 'string' && value.length > 0 ? value : null
}
