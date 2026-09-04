// packages/lib/src/postings/journal-entries/writes.ts

/**
 * Every WRITE over the journal-entry draft: create it, edit it while it is a
 * draft, post it, reverse it, throw it away.
 *
 * Writes only. The reads live in `reads.ts` (`docs/lib-module-guide.md` §5).
 *
 * ## The one rule the whole file is arranged around
 *
 * 🛑 **A posted entry is corrected by REVERSAL, never by edit** (ground rule 6).
 * `GlPostingLine` has no update path at all, so an "edit" of a posted entry
 * could only ever mean editing this record's JSON while the ledger keeps the
 * numbers it actually posted - two documents claiming to be the same entry, and
 * the one a bookkeeper reads would be the wrong one. So {@link updateJournalEntry}
 * refuses anything but a `draft`.
 *
 * No permission checks. The router asserts `ledgerPost`
 * (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import { buildManualEntry, type ManualPostingType } from '../build-manual-entry'
import { resolvePeriodLock } from '../period-lock'
import { postEntry, previewEntry } from '../post-entry'
import { reverseEntry } from '../reverse-entry'
import type { EntryPreview, PostResult } from '../types'
import {
  JOURNAL_ENTRY_POSTING_TYPE,
  type JournalEntryKindValue,
  type JournalEntryLine,
  type JournalEntryLinesEnvelope,
  type JournalEntryRecord,
} from './client'
import { guard } from './guard'
import { requireJournalEntry, requireJournalEntryFieldContext } from './reads'
import { assertJournalEntryHasNoPosting, assertJournalEntryIsDraft } from './refusals'

const logger = createScopedLogger('postings:journal-entries')

export interface CreateJournalEntryInput {
  /** Defaults to `manual`. Set once - the field is `updatable: false`. */
  kind?: JournalEntryKindValue
  /** `YYYY-MM-DD`. The accounting date. */
  date: string
  memo?: string
  /** May be empty: a person opens the drawer before they have typed anything. */
  lines?: JournalEntryLine[]
}

export interface UpdateJournalEntryInput {
  journalEntryId: string
  date?: string
  memo?: string
  /** Replaced WHOLESALE when present. A draft's lines have no identity. */
  lines?: JournalEntryLine[]
}

/** What a preview may try before anything is saved. See {@link previewJournalEntry}. */
export interface PreviewJournalEntryInput {
  journalEntryId: string
  date?: string
  memo?: string
  lines?: JournalEntryLine[]
}

/**
 * Raise a draft. Always lands `draft`, with a number.
 *
 * The number is issued by `JOURNAL_ENTRY_HOOKS` on create and is not optional:
 * it becomes the posting's `periodKey`, so an entry without one cannot be
 * posted at all. Issuing it here rather than at post time is what makes the
 * draft addressable - the drawer needs an id and a name the moment it opens.
 *
 * Lines may be empty. A person opens the drawer, picks a date, and starts
 * typing; refusing an empty draft would mean the drawer could not save until it
 * balanced, which is exactly when a half-finished entry most wants saving.
 * `buildManualEntry` is the gate, at post time, and it names the row.
 */
export async function createJournalEntry(
  db: Database,
  organizationId: string,
  userId: string,
  input: CreateJournalEntryInput
): Promise<Result<JournalEntryRecord, Error>> {
  return guard(
    async () => {
      const ctx = await requireJournalEntryFieldContext(organizationId)
      const kind = input.kind ?? 'manual'

      const values: Record<string, unknown> = {
        journal_entry_status: 'draft',
        journal_entry_kind: kind,
        journal_entry_date: toStoredDate(input.date),
        journal_entry_lines: linesEnvelope(input.lines ?? []),
      }
      if (input.memo) values.journal_entry_memo = input.memo

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const created = await crud.create(ctx.journalEntryDefId, values)

      logger.info('Raised journal entry', {
        organizationId,
        journalEntryId: created.instance.id,
        kind,
        lineCount: (input.lines ?? []).length,
      })

      return requireJournalEntry(db, organizationId, created.instance.id)
    },
    'Failed to create journal entry',
    { organizationId }
  )
}

/**
 * Edit a DRAFT. Refused on anything else.
 *
 * `ConflictError` rather than `ForbiddenError`: the caller is allowed to do
 * this, the record is in the wrong state for it, and the remedy is named in the
 * message. See the file header for why there is no edit-after-post.
 */
export async function updateJournalEntry(
  db: Database,
  organizationId: string,
  userId: string,
  input: UpdateJournalEntryInput
): Promise<Result<JournalEntryRecord, Error>> {
  return guard(
    async () => {
      const ctx = await requireJournalEntryFieldContext(organizationId)
      const entry = await requireJournalEntry(db, organizationId, input.journalEntryId)
      assertJournalEntryIsDraft(entry, 'edited')

      const values: Record<string, unknown> = {}
      if (input.date !== undefined) values.journal_entry_date = toStoredDate(input.date)
      // An empty string CLEARS the memo; `undefined` leaves it alone. Collapsing
      // the two would make a memo unremovable.
      if (input.memo !== undefined) values.journal_entry_memo = input.memo || null
      if (input.lines !== undefined) values.journal_entry_lines = linesEnvelope(input.lines)

      if (Object.keys(values).length === 0) return entry

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      await crud.update(toRecordId(ctx.journalEntryDefId, input.journalEntryId) as RecordId, values)

      return requireJournalEntry(db, organizationId, input.journalEntryId)
    },
    'Failed to update journal entry',
    { organizationId, journalEntryId: input.journalEntryId }
  )
}

/**
 * What posting this draft WOULD write. Persists nothing.
 *
 * Takes optional overrides so the drawer can preview what is on screen without
 * saving it first - the totals strip and the `EntryBlockers` card both want an
 * answer for the entry as it is being typed, and forcing a save to get one
 * would write a draft on every keystroke. The overrides are used for the
 * preview and thrown away.
 *
 * 🛑 The refusals arrive on `blockedBy` rather than as a throw, exactly as
 * `previewMonthEnd`'s do - a closed period, an account that is not in the
 * chart, an inventory account named by code. All three are things the screen
 * RENDERS. What DOES throw is the arithmetic: an unbalanced entry or a
 * zero-amount row never becomes a `BuiltEntry` at all, so there is nothing to
 * preview and the message names the row.
 */
export async function previewJournalEntry(
  db: Database,
  organizationId: string,
  input: PreviewJournalEntryInput
): Promise<Result<EntryPreview, Error>> {
  return guard(
    async () => {
      const stored = await requireJournalEntry(db, organizationId, input.journalEntryId)
      const draft = { ...stored, ...pickOverrides(input) }
      const { entry } = buildDraftEntry(draft)
      const lock = await resolvePeriodLock(organizationId)
      return previewEntry(db, { organizationId, entry, lock })
    },
    'Failed to preview journal entry',
    { organizationId, journalEntryId: input.journalEntryId }
  )
}

/**
 * Post a draft: build it, claim the period, persist it, stamp the record.
 *
 * ## Why this returns a `PostResult` and not a `Result`
 *
 * `postEntry` never throws. A closed period, an account that is not in the
 * chart, an inventory account named by code and a provider that refused the
 * push all come back as a typed status, and every one of them is something the
 * screen renders rather than a 500 to swallow. Collapsing them into an error
 * would throw away `docNumber`, `failureClass` and `retryable` - the whole of
 * what the operator needs to decide what to do next.
 *
 * The arithmetic still throws: `buildManualEntry` refuses an unbalanced or
 * zero-amount entry before anything is claimed, and there is no status for
 * "this is not an entry".
 *
 * 🛑 **The record is stamped only on a status that actually wrote a posting.**
 * `not_connected` and `disabled` DO write one - `postEntry` marks those rows
 * `posted`, because an org with no accounting system has nothing in flight -
 * and `already_posted` found one that was already there. A refusal leaves the
 * record `draft` with nothing stamped, which is exactly what "fix it and press
 * Post again" needs.
 */
export async function postJournalEntry(
  db: Database,
  organizationId: string,
  userId: string,
  input: { journalEntryId: string; memo?: string }
): Promise<Result<PostResult, Error>> {
  return guard(
    async () => {
      const ctx = await requireJournalEntryFieldContext(organizationId)
      const entry = await requireJournalEntry(db, organizationId, input.journalEntryId)
      assertJournalEntryIsDraft(entry, 'posted')

      const { entry: built, warnings } = buildDraftEntry(entry)
      const lock = await resolvePeriodLock(organizationId)

      const result = await postEntry(db, {
        organizationId,
        entry: built,
        actorUserId: userId,
        memo: input.memo ?? entry.memo ?? undefined,
        lock,
      })

      if (result.glPostingId) {
        const crud = new UnifiedCrudHandler(organizationId, userId, db)
        await crud.update(toRecordId(ctx.journalEntryDefId, entry.id) as RecordId, {
          journal_entry_status: 'posted',
          journal_entry_gl_posting_id: result.glPostingId,
        })
      }

      logger.info('Posted journal entry', {
        organizationId,
        journalEntryId: entry.id,
        number: entry.number,
        status: result.status,
        glPostingId: result.glPostingId,
        warnings: warnings.length,
      })

      return result
    },
    'Failed to post journal entry',
    { organizationId, journalEntryId: input.journalEntryId }
  )
}

/**
 * Back a posted entry out with a second, opposite one.
 *
 * `reverseEntry` does the accounting; this only finds the posting and flips the
 * record. The reversal is its own `GlPosting` row carrying `reversesId`, and
 * the original flips to `reversed` inside the same transaction - nothing here
 * edits or deletes anything.
 *
 * 🛑 The record is flipped only when the reversal actually landed. A refusal
 * (a locked period, a chart that moved under a role line) leaves the record
 * `posted`, because it still is.
 */
export async function reverseJournalEntry(
  db: Database,
  organizationId: string,
  userId: string,
  input: { journalEntryId: string; memo?: string }
): Promise<Result<PostResult, Error>> {
  return guard(
    async () => {
      const ctx = await requireJournalEntryFieldContext(organizationId)
      const entry = await requireJournalEntry(db, organizationId, input.journalEntryId)

      if (entry.status !== 'posted' || !entry.glPostingId) {
        throw new ConflictError(
          `Journal entry ${entry.number ?? entry.id} is ${entry.status}, not posted. ` +
            'Only a posted entry can be reversed - a draft is simply edited.',
          { journalEntryId: entry.id, status: entry.status }
        )
      }

      const lock = await resolvePeriodLock(organizationId)
      const result = await reverseEntry(db, {
        organizationId,
        glPostingId: entry.glPostingId,
        actorUserId: userId,
        lock,
        memo: input.memo,
      })

      // Only a reversal that reached the ledger changes what this record says.
      // `already_posted` counts: it means the reversal was already there, which
      // is a converged re-run and not a failure.
      const landed =
        result.status === 'posted' ||
        result.status === 'already_posted' ||
        result.status === 'healed' ||
        result.status === 'not_connected' ||
        result.status === 'disabled'

      if (landed) {
        const crud = new UnifiedCrudHandler(organizationId, userId, db)
        await crud.update(toRecordId(ctx.journalEntryDefId, entry.id) as RecordId, {
          journal_entry_status: 'reversed',
        })
      }

      logger.info('Reversed journal entry', {
        organizationId,
        journalEntryId: entry.id,
        number: entry.number,
        status: result.status,
      })

      return result
    },
    'Failed to reverse journal entry',
    { organizationId, journalEntryId: input.journalEntryId }
  )
}

/**
 * Throw a draft away: ARCHIVE the record, never delete the row.
 *
 * ## Why archive
 *
 * A journal entry is an accounting artefact before it posts. `RecordSequence`
 * issues `journal_entry_number` on CREATE, so an abandoned `JNL-0006` leaves a
 * hole in a gapless sequence forever - and that hole is correct. A bookkeeper
 * who reads `JNL-0005` then `JNL-0007` must be able to find out what happened to
 * the one in between, and a hard delete makes that question unanswerable.
 * `archivedAt` keeps the answer and takes the row out of every read:
 * `listJournalEntries` and `getJournalEntry` both filter `archivedAt IS NULL`,
 * so nothing else needs to learn a new state.
 *
 * 🛑 **There is no `discarded` status and there must not be one.** The entity
 * layer already answers "is this record gone"; a fourth value on
 * `journal_entry_status` would have to be handled by every switch that renders
 * one, for no information the archive flag does not already carry.
 *
 * ## Why TWO guards
 *
 * `assertJournalEntryIsDraft` is the status wall and
 * {@link assertJournalEntryHasNoPosting} is the posting-id wall, and the second
 * is not redundant - see its own docblock for the row it catches.
 *
 * ## What this deliberately does not do
 *
 * There is no un-archive here. `UnifiedCrudHandler.restore()` exists, but a
 * restore path needs a screen to restore FROM and there is no archived-entries
 * view, so somebody who needs one back is one script away. That is the right
 * cost for a rare case, and the confirm copy says so rather than implying the
 * action is reversible.
 *
 * A second discard of the same entry is a `NotFoundError`, not a silent success:
 * `requireJournalEntry` reads through the same `archivedAt IS NULL` filter every
 * other reader does, so the row is already gone as far as this module is
 * concerned. Pinned by test.
 */
export async function discardJournalEntry(
  db: Database,
  organizationId: string,
  userId: string,
  input: { journalEntryId: string }
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      const ctx = await requireJournalEntryFieldContext(organizationId)
      const entry = await requireJournalEntry(db, organizationId, input.journalEntryId)
      assertJournalEntryIsDraft(entry, 'discarded')
      assertJournalEntryHasNoPosting(entry, 'discarded')

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      await crud.archive(toRecordId(ctx.journalEntryDefId, entry.id) as RecordId)

      // The sequence gap this leaves is permanent and deliberate, so the log is
      // what makes it explainable six months later: this is the only record that
      // `JNL-0006` was raised and then abandoned rather than lost.
      logger.info('Discarded journal entry', {
        organizationId,
        journalEntryId: entry.id,
        number: entry.number,
      })
    },
    'Failed to discard journal entry',
    { organizationId, journalEntryId: input.journalEntryId }
  )
}

/**
 * Turn a stored draft into a `BuiltEntry`, or throw naming the row.
 *
 * The three things this has to get right, and each is a refusal rather than a
 * default:
 *
 * 1. **A number.** It IS the posting's `periodKey`. A record whose hook did not
 *    fire has none, and posting it would mint `AUXX-JNL-` with nothing after it.
 * 2. **A date.** `txnDate` is what the period lock reads and what a provider
 *    would otherwise replace with its own server date.
 * 3. **A postable kind.** `recurring_template` is a stencil, not an entry, and
 *    `opening_balance` posts through its own route - both are refused BY NAME
 *    rather than by a missing map entry, so the refusal carries a sentence.
 */
function buildDraftEntry(entry: JournalEntryRecord) {
  if (entry.kind === 'recurring_template') {
    throw new UnprocessableEntityError(
      'A recurring template is a stencil for future entries, not an entry. Copy it into a new ' +
        'journal entry and post that.',
      { journalEntryId: entry.id }
    )
  }
  // 🛑 An opening entry keys on the CUTOVER DATE, and this path would key it on
  // the record's number. `doc-number.ts` declares the cutover-date rule because
  // an org has exactly one opening trial balance, and the claim's unique index
  // on `(organizationId, postingType, periodKey, revision)` is what makes a
  // SECOND one unrepresentable. Posting through here would key `AUXX-OPB-JNL0009`
  // instead, so a second opening trial balance would claim cleanly and the
  // ledger would carry two - which is the one thing the cutover-date key exists
  // to prevent. `opening-trial-balance/writes.ts` is the only route.
  if (entry.kind === 'opening_balance') {
    throw new UnprocessableEntityError(
      'An opening trial balance posts from the accounting setup, never from the journal-entry ' +
        'drawer: it keys on the cutover date rather than on this record number, and that ' +
        'key is what makes a second opening balance impossible to post. Open Accounting settings ' +
        'and post it from the opening trial balance page (ledgerOpening.post).',
      { journalEntryId: entry.id, kind: entry.kind }
    )
  }
  if (!entry.number) {
    throw new UnprocessableEntityError(
      'This journal entry has no number, so it cannot be posted - the number is what the ' +
        "posting's document number is keyed on. Re-create the entry.",
      { journalEntryId: entry.id }
    )
  }
  if (!entry.date) {
    throw new UnprocessableEntityError(
      'This journal entry has no date. An entry has to name the day it posts on.',
      { journalEntryId: entry.id }
    )
  }

  const postingType: ManualPostingType = JOURNAL_ENTRY_POSTING_TYPE[entry.kind]

  return buildManualEntry({
    postingType,
    number: entry.number,
    txnDate: entry.date,
    memo: entry.memo ?? undefined,
    lines: entry.lines,
    sourceId: entry.id,
  })
}

/** The override keys a preview may supply, with `undefined` meaning "use what is stored". */
function pickOverrides(input: PreviewJournalEntryInput): Partial<JournalEntryRecord> {
  const overrides: Partial<JournalEntryRecord> = {}
  if (input.date !== undefined) overrides.date = input.date
  if (input.memo !== undefined) overrides.memo = input.memo
  if (input.lines !== undefined) overrides.lines = normaliseLines(input.lines)
  return overrides
}

/**
 * Strip a draft line down to the four fields that are stored, and no others.
 *
 * A client sending extra keys - a React row id, a display label, a dollar
 * amount somebody forgot to convert - must not have them persisted into the
 * JSON, because the next reader would find a shape nothing declares and a
 * `amount` field beside `amountMinor` is exactly the ambiguity ground rule 2
 * exists to remove.
 *
 * 🛑 It does NOT validate. `buildManualEntry` owns every refusal and names the
 * row while doing it; a second authority here would give the same input two
 * error vocabularies and the worse one would win at save time, before the
 * person had finished typing.
 */
function normaliseLines(lines: JournalEntryLine[]): JournalEntryLine[] {
  return lines.map((line) => ({
    accountCode: line.accountCode,
    direction: line.direction,
    amountMinor: line.amountMinor,
    ...(line.memo ? { memo: line.memo } : {}),
  }))
}

/**
 * Wrap the lines in the envelope the JSON column actually stores.
 *
 * 🛑 **The wrapper is not decoration.** A `FieldValue` write treats a top-level
 * ARRAY as a multi-value write - one row per element - and
 * `journal_entry_lines` is single-value, so a bare array is rejected with
 * "single-value; received 2 values"... which `UnifiedCrudHandler.setFieldValues`
 * LOGS and swallows, leaving the update reporting success over an entry that
 * has no lines. This was found by driving the path, not by a test.
 */
function linesEnvelope(lines: JournalEntryLine[]): JournalEntryLinesEnvelope {
  return { lines: normaliseLines(lines) }
}

/**
 * Store the accounting date as midnight UTC.
 *
 * `FieldValue.valueDate` is a `timestamptz`, and the accounting date is a DATE:
 * it has no time and no zone. Writing "now" or a local midnight would push a
 * month-end entry into the previous month for any reader west of UTC. Midnight
 * UTC is the only value that reads back as the same `YYYY-MM-DD` everywhere,
 * and `reads.ts` slices it back off.
 */
function toStoredDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new UnprocessableEntityError(`A journal entry date must be YYYY-MM-DD, got '${date}'`, {
      date,
    })
  }
  return `${date}T00:00:00.000Z`
}
