// packages/lib/src/field-hooks/pre/journal-entry-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { assertJournalEntryIsDraft } from '../../postings/journal-entries/refusals'
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
 * `journal_entry_status` no longer exists (TARGET §1): the record is a pointer
 * and its status is the linked `GlPosting`'s, read here directly rather than off
 * a captured field value. No `journal_entry_gl_posting_id` at all reads as
 * `draft` - a record whose companion draft failed to write has nothing posted to
 * protect.
 *
 * ⚠️ **A draft is ALLOWED through.** The guard must not become a second,
 * stricter rule than the procedure it backs up: an unposted draft is a record a
 * person may throw away, and the product's own answer is to archive it.
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
  const [row] = await database
    .select({ status: schema.GlPosting.status })
    .from(schema.GlPosting)
    .where(
      and(eq(schema.GlPosting.id, glPostingId), eq(schema.GlPosting.organizationId, organizationId))
    )
    .limit(1)
  return row?.status ?? 'draft'
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
