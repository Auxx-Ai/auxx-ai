// packages/lib/src/postings/journal-entries/refusals.ts

/**
 * The two sentences a journal entry is refused with, and nothing else.
 *
 * 🛑 **They live in their own leaf so there is exactly one of each.** Two doors
 * reach the same rule from opposite sides of the app: `writes.ts`, which is the
 * product's own edit/post/discard path, and
 * `field-hooks/pre/journal-entry-delete-guard.ts`, which catches the GENERIC
 * `record.delete` that bypasses `writes.ts` entirely. If each wrote its own
 * refusal the product would say the same thing two ways, and the wording a
 * bookkeeper met would depend on which button they happened to press.
 *
 * This file imports `../../errors` and nothing else on purpose: the guard must
 * not pull `UnifiedCrudHandler` and the whole posting graph in behind a
 * sentence.
 */

import { ConflictError } from '../../errors'

/**
 * The minimum a refusal needs in order to name the row.
 *
 * Structural rather than `JournalEntryRecord`, because the pre-delete guard
 * assembles its subject from the values `deleteEntity` captured, not from a
 * hydrated record, and widening the guard to load one would make the archived
 * rows this same guard has to let through unreadable.
 */
export interface JournalEntryRefusalSubject {
  id: string
  /** `'JNL-0007'`, or `null` on a row whose number hook never fired. */
  number: string | null
  status: string
  /** The `GlPosting` this record became. Null while it is genuinely a draft. */
  glPostingId: string | null
}

/** `JNL-0007` when there is a number, the raw id when there is not. */
function label(entry: JournalEntryRefusalSubject): string {
  return entry.number ?? entry.id
}

/**
 * Refuse anything but a draft, naming what was attempted.
 *
 * `verb` is a past participle - `'edited'`, `'posted'`, `'discarded'`,
 * `'deleted'` - and it is an argument rather than a fixed word precisely so a
 * new caller reuses this sentence instead of writing a second one.
 *
 * `ConflictError` rather than `ForbiddenError`: the caller is allowed to do
 * this, the record is in the wrong state for it, and the remedy is named in the
 * message.
 */
export function assertJournalEntryIsDraft(entry: JournalEntryRefusalSubject, verb: string): void {
  if (entry.status === 'draft') return
  throw new ConflictError(
    `Journal entry ${label(entry)} is ${entry.status} and cannot be ${verb}. ` +
      'A posted entry is corrected by reversing it and posting a new one - the ledger has no ' +
      'update path.',
    { journalEntryId: entry.id, status: entry.status }
  )
}

/**
 * Refuse a record that carries a posting id, EVEN WHEN its status reads `draft`.
 *
 * 🛑 **This is not a restatement of {@link assertJournalEntryIsDraft}.** Status
 * and posting id are two facts written at two different moments:
 * `postJournalEntry` claims the posting first and stamps the record second, so a
 * row that is `draft` and carries a `glPostingId` is either mid-flight or the
 * wreckage of a post whose second half failed. Archiving one would leave a
 * `GlPosting` whose `sourceId` resolves to a record no read path returns, which
 * A/R aging then carries under "Unapplied and adjustments" forever.
 */
export function assertJournalEntryHasNoPosting(
  entry: JournalEntryRefusalSubject,
  verb: string
): void {
  if (!entry.glPostingId) return
  throw new ConflictError(
    `Journal entry ${label(entry)} already has a posting in the ledger and cannot be ${verb}, ` +
      'even though its status still reads draft - it was posted, or a post was interrupted ' +
      'part way through stamping it. Reverse the posting instead.',
    { journalEntryId: entry.id, glPostingId: entry.glPostingId }
  )
}
