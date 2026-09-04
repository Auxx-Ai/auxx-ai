// packages/lib/src/field-hooks/pre/journal-entry-delete-guard.test.ts
//
// The guard that stops a journal entry being hard-deleted once it has reached
// the ledger (plans/accounting/tasks/09-discard-a-draft-entry.md §3.3, §4).
//
// 🛑 `discardJournalEntry` is not the only door. `journal_entry` is an
// `EntityInstance`, so the GENERIC `record.delete`, a bulk delete and any
// Kopilot or API caller reach the row by id without going near
// `postings/journal-entries/writes.ts` - and that path used to remove a POSTED
// entry with no complaint, leaving its `GlPosting` naming a `sourceId` that no
// longer resolves.
//
// ⚠️ The guard must not be a STRICTER rule than the procedure it backs up: an
// ordinary draft passes, because the product's own answer to an unwanted draft
// is to archive it, and a guard that refused one would make a discarded entry
// unpurgeable for no accounting reason.

import { describe, expect, it } from 'vitest'
import { ConflictError } from '../../errors'
import type { EntityPreDeleteEvent } from '../types'
import { guardJournalEntryDelete } from './journal-entry-delete-guard'

const DEF = 'jrnldef00000000000000001'
const ENTRY_ID = 'jrnl00000000000000000001'
const ORG = 'abgwpa1l81reht2zmwrcihfu'

/**
 * A pre-delete event as `captureEventData` actually produces one.
 *
 * ⚠️ `journal_entry_status` is a SINGLE_SELECT, and the capture chain ARRAYS
 * every `ARRAY_RETURN_FIELD_TYPES` member regardless of how many values are
 * stored - so it arrives as `['posted']`, never as `'posted'`. Building the
 * fixture from a bare string is exactly how two guards have shipped inert
 * (`resources/events/captured-values.ts`), so the array is the default here and
 * the bare-string case is a separate, explicit test.
 */
function event(values: Record<string, unknown> = {}): EntityPreDeleteEvent {
  return {
    recordId: `${DEF}:${ENTRY_ID}` as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: DEF,
    entityType: 'journal_entry',
    entitySlug: 'journal-entries',
    values: {
      journal_entry_number: 'JNL-0006',
      journal_entry_status: ['draft'],
      ...values,
    },
    organizationId: ORG,
    userId: 'usr_1',
    bypass: new Set(),
  }
}

describe('guardJournalEntryDelete', () => {
  it('refuses a posted entry, naming it and pointing at reversal', async () => {
    const refusal = guardJournalEntryDelete(
      event({ journal_entry_status: ['posted'], journal_entry_gl_posting_id: 'post_1' })
    )

    await expect(refusal).rejects.toBeInstanceOf(ConflictError)
    await expect(refusal).rejects.toThrow(/JNL-0006 is posted and cannot be deleted/)
    await expect(refusal).rejects.toThrow(/reversing it/i)
  })

  it('refuses a reversed entry the same way', async () => {
    await expect(
      guardJournalEntryDelete(
        event({ journal_entry_status: ['reversed'], journal_entry_gl_posting_id: 'post_1' })
      )
    ).rejects.toThrow(/reversed and cannot be deleted/)
  })

  // 🛑 The two facts are written at two different moments: `postJournalEntry`
  // claims the posting FIRST and stamps the record SECOND. A run that dies in
  // between leaves status `draft` with a posting id set, and that is the row
  // this second check exists for.
  it('refuses a draft that carries a posting id', async () => {
    await expect(
      guardJournalEntryDelete(event({ journal_entry_gl_posting_id: 'post_1' }))
    ).rejects.toThrow(/already has a posting/)
  })

  // ⚠️ The guard is not a second, stricter rule than `discardJournalEntry`.
  it('ALLOWS an ordinary draft, so it does not contradict the discard procedure', async () => {
    await expect(guardJournalEntryDelete(event())).resolves.toBeUndefined()
  })

  // `toRecord` in `reads.ts` reads a missing status the same way: the field
  // carries `defaultValue: 'draft'`, and a row written before the field existed
  // has no `FieldValue` at all. Reading absence as anything else would make such
  // a row claim to be posted and become undeletable.
  it('reads an absent status as draft and lets it through', async () => {
    await expect(
      guardJournalEntryDelete(event({ journal_entry_status: undefined }))
    ).resolves.toBeUndefined()
  })

  // Belt and braces on the shape trap above: `unwrapStatusValue` handles the
  // bare string too, so a caller on another chain is refused just as loudly.
  it('refuses a posted entry whose captured status is a bare string', async () => {
    await expect(
      guardJournalEntryDelete(event({ journal_entry_status: 'posted' }))
    ).rejects.toThrow(/cannot be deleted/)
  })

  // An entry whose number hook never fired still has to be nameable, or the
  // refusal says "Journal entry undefined".
  it('falls back to the instance id when there is no number', async () => {
    await expect(
      guardJournalEntryDelete(
        event({ journal_entry_number: null, journal_entry_status: ['posted'] })
      )
    ).rejects.toThrow(new RegExp(ENTRY_ID))
  })
})
