// packages/lib/src/field-hooks/pre/journal-entry-delete-guard.ts

import { database } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { assertJournalEntryIsDraft } from '../../accounting/journals/entries/refusals'
import { readPostingHeader } from '../../accounting/ledger/reads/read-posting'
import { unwrapStatusValue } from '../../resources/events/captured-values'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `journal-entries`
 * (plans/accounting/tasks/done/09-discard-a-draft-entry.md §3.3), modelled on
 * `invoice-delete-guard.ts`, which exists for this exact reason.
 *
 * 🛑 **`discardJournalEntry` is not the only door.** A journal entry is an
 * `EntityInstance`, so the generic `record.delete`, a bulk delete, and any
 * future Kopilot or API caller can reach the row without going near
 * `postings/journal-entries/writes.ts` at all - and before this guard, that path
 * hard-deleted a POSTED entry with no complaint, leaving its `GlPosting` in the
 * books pointing at a `sourceId` that no longer resolves.
 *
 * The status is the stamped posting's, read directly; no pointer (or a pointer
 * to a posting that is gone) reads as `draft`. An unposted entry is ALLOWED
 * through - it is what `discardJournalEntry` deletes - and its
 * `journal_entry_line` children go with it through the `lines` cascade (91 D5).
 *
 * No admin gate, following `parts`: the per-row `record.delete` rule the
 * mutation already asserts is the whole authorization story, and the accounting
 * rule below is about the record's state, not the caller's rank.
 */
export const guardJournalEntryDelete: EntityPreDeleteHandler = async (event) => {
  const { entityInstanceId } = parseRecordId(event.recordId)
  const glPostingId = readText(event.values.journal_entry_gl_posting_id)
  const status = glPostingId ? await readPostingStatus(event.organizationId, glPostingId) : 'draft'

  assertJournalEntryIsDraft(
    { id: entityInstanceId, number: readText(event.values.journal_entry_number), status },
    'deleted'
  )
}

/** The linked `GlPosting`'s status, or `'draft'` when the row is somehow gone. */
async function readPostingStatus(organizationId: string, glPostingId: string): Promise<string> {
  const header = await readPostingHeader(database, organizationId, glPostingId)
  return header?.status ?? 'draft'
}

/**
 * One captured value, reduced to a non-empty string or `null`.
 *
 * `unwrapStatusValue` first because the capture chain ARRAYS every
 * `ARRAY_RETURN_FIELD_TYPES` member regardless of how many values are stored -
 * `journal_entry_gl_posting_id` is TEXT and arrives as `['post_1']`, so a bare
 * `typeof === 'string'` test on it is always false. That mistake has shipped
 * twice; see `resources/events/captured-values.ts`.
 */
function readText(raw: unknown): string | null {
  const value = unwrapStatusValue(raw)
  return typeof value === 'string' && value.length > 0 ? value : null
}
