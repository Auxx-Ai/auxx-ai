// packages/lib/src/accounting/journals/entries/writes.ts

/**
 * Every WRITE over the journal-entry pointer: raise it (and its companion
 * draft), edit the draft while it stays one, post it, reverse it, throw it
 * away.
 *
 * Writes only. The reads live in `reads.ts` (`docs/lib-module-guide.md` §5).
 *
 * ## The one rule the whole file is arranged around
 *
 * 🛑 **A posted entry is corrected by REVERSAL, never by edit** (ground rule 6).
 * `GlPostingLine` has no update path at all, so {@link updateJournalEntry}
 * refuses anything but a `draft`.
 *
 * ## The record is a pointer (TARGET §1)
 *
 * There is no `journal_entry_status` or `journal_entry_lines` field.
 * `createJournalEntry` writes the `EntityInstance` AND a draft `GlPosting` in
 * the same call, through `postEntry({ mode: 'draft' })`, and stamps
 * `journal_entry_gl_posting_id` - every successfully created entry carries one
 * from the start. Status and lines are read back off that posting
 * (`reads.ts`); editing lines goes through `../draft-lines.ts`'s
 * `updateDraftLines`; posting goes through `postDraft`.
 *
 * 🛑 **This means an entry needs a balanced, two-line-minimum draft to exist at
 * all** - `buildManualEntry` refuses fewer than two lines or an imbalance, and
 * a `GlPosting` cannot represent zero lines either way (`prepareEntry`'s
 * balance check refuses an empty entry regardless of `mode`). The old "save an
 * empty draft, type into it later" flow is gone with the field it depended on;
 * `createJournalEntry` now refuses the same way `postJournalEntry` always did,
 * just earlier.
 *
 * No permission checks. The router asserts `ledgerPost`
 * (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import {
  type BuiltManualEntry,
  buildManualEntry,
  MANUAL_ENTRY_SOURCE_TYPE,
  type ManualPostingType,
} from '../../../postings/build-manual-entry'
import { discardDraftPosting, updateDraftLines } from '../../../postings/draft-lines'
import { resolvePeriodLock } from '../../../postings/period-lock'
import { postDraft, postEntry, previewEntry } from '../../../postings/post-entry'
import { readPostingLineSourceIds } from '../../../postings/read-posting'
import { reverseEntry } from '../../../postings/reverse-entry'
import type { EntryPreview, GlPostingSourceInput, PostResult } from '../../../postings/types'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { type RecordId, toRecordId } from '../../../resources/resource-id'
import { recurringJournalPeriodKey } from '../recurring/client'
import {
  JOURNAL_ENTRY_POSTING_TYPE,
  type JournalEntryKindValue,
  type JournalEntryLine,
  type JournalEntryRecord,
} from './client'
import { guard } from './guard'
import {
  readRecurrenceIdentities,
  requireJournalEntry,
  requireJournalEntryFieldContext,
} from './reads'
import { assertJournalEntryIsDraft } from './refusals'

const logger = createScopedLogger('postings:journal-entries')

export interface CreateJournalEntryInput {
  /** Defaults to `manual`. Set once - the field is `updatable: false`. */
  kind?: JournalEntryKindValue
  /** `YYYY-MM-DD`. The accounting date. */
  date: string
  memo?: string
  /** Balanced, two lines minimum - see the file header. */
  lines?: JournalEntryLine[]
  /**
   * Only the recurring-journal materializer passes these, and it passes BOTH.
   * Together they are what the posting's `periodKey` is hashed from, so a
   * half-set pair would produce an entry that posts under a key naming a rule
   * or a slot that does not exist - which is the one shape the claim index
   * cannot catch. {@link assertRecurrenceIdentity} refuses it.
   */
  recurrenceRuleId?: string
  occurrenceDate?: string
  /**
   * Override the draft's claim subject. Defaults to
   * `{ sourceKind: 'journal_entry', sourceId: <this record>, linkRole: 'subject' }`.
   *
   * Only the recurring-journal materializer passes one: a template's
   * occurrence, not the generated record, is what must not double-post.
   * Two draft records raised for the same occurrence (a materializer race)
   * are otherwise two independent claims - each promotes cleanly - and the
   * only thing that stops both is `GlPosting_org_docNumber_key`, a unique
   * constraint neither writer asked for and which surfaces as a raw SQL
   * error instead of `already_posted`.
   */
  subject?: GlPostingSourceInput
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
 * Raise the record AND its companion draft `GlPosting` in one call. Always
 * lands `draft`.
 *
 * The number is issued by `JOURNAL_ENTRY_HOOKS` on create and is not optional:
 * for `manual` and `opening_balance` it becomes the draft posting's
 * `periodKey`. A `recurring` entry keys on the rule and the slot instead
 * (`recurringJournalPeriodKey`), and a `recurring_template` never posts at all
 * - it still gets a draft, under the generic `manual_journal` shape, purely as
 * somewhere to hold the stencil's lines for `materializeRecurringJournals` to
 * copy.
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
      assertRecurrenceIdentity(kind, input)

      const values: Record<string, unknown> = {
        journal_entry_kind: kind,
        journal_entry_date: toStoredDate(input.date),
      }
      if (input.memo) values.journal_entry_memo = input.memo
      if (input.recurrenceRuleId && input.occurrenceDate) {
        values.journal_entry_recurrence_rule_id = input.recurrenceRuleId
        values.journal_entry_occurrence_date = input.occurrenceDate
      }

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const created = await crud.create(ctx.journalEntryDefId, values)
      const journalEntryId = created.instance.id

      const draft = await requireJournalEntry(db, organizationId, journalEntryId)
      const built = buildDraftStorageEntry(draft, input.lines ?? [])
      const lock = await resolvePeriodLock(organizationId)
      const posted = await postEntry(db, {
        organizationId,
        entry: built.entry,
        lock,
        mode: 'draft',
        sources: [
          input.subject ?? {
            sourceKind: 'journal_entry',
            sourceId: journalEntryId,
            linkRole: 'subject',
          },
        ],
      })
      if (posted.status !== 'drafted' || !posted.glPostingId) {
        throw new UnprocessableEntityError(
          `Could not raise the posting behind this journal entry: ${posted.error ?? posted.status}`,
          { journalEntryId }
        )
      }

      await crud.update(toRecordId(ctx.journalEntryDefId, journalEntryId) as RecordId, {
        journal_entry_gl_posting_id: posted.glPostingId,
      })

      logger.info('Raised journal entry', {
        organizationId,
        journalEntryId,
        glPostingId: posted.glPostingId,
        kind,
        lineCount: (input.lines ?? []).length,
      })

      return requireJournalEntry(db, organizationId, journalEntryId)
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

      if (Object.keys(values).length > 0) {
        const crud = new UnifiedCrudHandler(organizationId, userId, db)
        await crud.update(
          toRecordId(ctx.journalEntryDefId, input.journalEntryId) as RecordId,
          values
        )
      }

      // Lines, date and memo all live on the draft posting's `built` envelope
      // now (TARGET §1), so any of the three re-drives it, not only lines.
      if (input.date !== undefined || input.memo !== undefined || input.lines !== undefined) {
        if (!entry.glPostingId) {
          throw new UnprocessableEntityError(
            'This journal entry has no posting behind it to edit. Re-create the entry.',
            { journalEntryId: entry.id }
          )
        }
        const merged: JournalEntryRecord = {
          ...entry,
          date: input.date ?? entry.date,
          memo: input.memo !== undefined ? input.memo || null : entry.memo,
          lines: input.lines ?? entry.lines,
        }
        const built = buildDraftStorageEntry(merged, merged.lines)
        const lock = await resolvePeriodLock(organizationId)
        const updated = await updateDraftLines(db, {
          organizationId,
          glPostingId: entry.glPostingId,
          entry: built.entry,
          lock,
          memo: merged.memo ?? undefined,
        })
        if (updated.isErr()) throw updated.error
      }

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
 * saving it first. The overrides are used for the preview and thrown away.
 *
 * 🛑 The refusals arrive on `blockedBy` rather than as a throw, exactly as
 * `previewMonthEnd`'s do. What DOES throw is the arithmetic: an unbalanced
 * entry or a zero-amount row never becomes a `BuiltEntry` at all, so there is
 * nothing to preview and the message names the row.
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
 * Post the draft that already exists behind this record.
 *
 * ## Why this returns a `PostResult` and not a `Result`
 *
 * `postDraft` never throws. A closed period, an account that is not in the
 * chart and a provider that refused the push all come back as a typed status,
 * and every one of them is something the screen renders rather than a 500 to
 * swallow.
 *
 * `buildDraftEntry` is called first purely to reuse its by-NAME refusals - a
 * `recurring_template` (a stencil, never posted) or an `opening_balance` entry
 * (posted from its own route, keyed on the cutover date rather than this
 * record's number) - and its result is otherwise unused: `postDraft` posts the
 * lines already resolved onto the stored draft, never a rebuild.
 */
export async function postJournalEntry(
  db: Database,
  organizationId: string,
  userId: string,
  input: { journalEntryId: string; memo?: string }
): Promise<Result<PostResult, Error>> {
  return guard(
    async () => {
      const entry = await requireJournalEntry(db, organizationId, input.journalEntryId)
      assertJournalEntryIsDraft(entry, 'posted')
      buildDraftEntry(entry)
      if (!entry.glPostingId) {
        throw new UnprocessableEntityError(
          'This journal entry has no posting behind it. Re-create the entry.',
          { journalEntryId: entry.id }
        )
      }

      const lock = await resolvePeriodLock(organizationId)
      const result = await postDraft(db, {
        organizationId,
        glPostingId: entry.glPostingId,
        actorUserId: userId,
        lock,
      })

      // 🛑 A collision means nothing was written for THIS entry, so treating it
      // as ours would misreport a posting that belongs to a different occurrence.
      const collision = await findRecurringKeyCollision(db, organizationId, entry, result)
      if (collision) return collision

      logger.info('Posted journal entry', {
        organizationId,
        journalEntryId: entry.id,
        number: entry.number,
        status: result.status,
        glPostingId: result.glPostingId,
      })

      return result
    },
    'Failed to post journal entry',
    { organizationId, journalEntryId: input.journalEntryId }
  )
}

/**
 * Turn an `already_posted` on a generated entry into a refusal when the
 * posting that holds the key belongs to a DIFFERENT occurrence.
 *
 * 🛑 `hashedPeriodKey` folds into 36^6 = 2.2e9 (`period-key.ts:33-39`), so two
 * distinct `<ruleId>:<occurrenceDate>` pairs can mint one key. `already_posted`
 * is a SUCCESS status, so without this the loser's entry silently never reaches
 * the books - a whole month's depreciation missing, with a clean outcome
 * recorded. `postPaymentTransaction` is the reference implementation and this
 * differs from it in exactly one way, described in
 * {@link readRecurrenceIdentities}: ownership is by SLOT, not by record id,
 * because two drafts of one occurrence are a convergence rather than a clash.
 *
 * Returns `undefined` for every status but `already_posted`, and for a winner
 * that fills the same slot.
 */
async function findRecurringKeyCollision(
  db: Database,
  organizationId: string,
  entry: JournalEntryRecord,
  result: PostResult
): Promise<PostResult | undefined> {
  if (entry.kind !== 'recurring') return undefined
  if (result.status !== 'already_posted' || !result.glPostingId) return undefined

  const mine = requireRecurrenceIdentity(entry)
  const sources = await readPostingLineSourceIds(db, organizationId, {
    glPostingId: result.glPostingId,
    sourceType: MANUAL_ENTRY_SOURCE_TYPE,
  })
  // A read that FAILED leaves the status alone, and so does a posting with no
  // journal-entry lines at all. Turning an unreadable posting into an error
  // would refuse an ordinary converged re-post on a transient database fault,
  // which is the opposite of the trade this check is making.
  if (sources.isErr()) return undefined
  const ownerIds = sources.value
  if (ownerIds.length === 0) return undefined

  const identities = await readRecurrenceIdentities(db, organizationId, ownerIds)
  const sameSlot = [...identities.values()].some(
    (owner) =>
      owner.recurrenceRuleId === mine.recurrenceRuleId &&
      owner.occurrenceDate === mine.occurrenceDate
  )
  if (sameSlot) return undefined

  const heldBy =
    [...identities.values()]
      .map((owner) => `${owner.recurrenceRuleId}:${owner.occurrenceDate}`)
      .join(', ') || ownerIds.join(', ')

  logger.error('A recurring journal period key collided with another occurrence', {
    organizationId,
    journalEntryId: entry.id,
    recurrenceRuleId: mine.recurrenceRuleId,
    occurrenceDate: mine.occurrenceDate,
    glPostingId: result.glPostingId,
    docNumber: result.docNumber,
    heldBy,
  })

  return {
    status: 'error',
    failureClass: 'data',
    retryable: false,
    error:
      `This entry for ${mine.occurrenceDate} minted the document number ` +
      `${result.docNumber ?? '(unknown)'}, which is already held by a different occurrence ` +
      `(${heldBy}). That is a period-key hash collision, not a re-post: nothing was written ` +
      'for this entry. Re-date the occurrence or post it as a manual journal entry instead.',
  }
}

/**
 * Back a posted entry out with a second, opposite one.
 *
 * `reverseEntry` does the accounting and flips the posting to `reversed`
 * itself; there is nothing left on the record to stamp - its status is read
 * back off the posting (`reads.ts`).
 */
export async function reverseJournalEntry(
  db: Database,
  organizationId: string,
  userId: string,
  input: { journalEntryId: string; memo?: string }
): Promise<Result<PostResult, Error>> {
  return guard(
    async () => {
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
 * Throw a draft away: delete its `GlPosting` (lines, then header), then
 * ARCHIVE the record - never delete the row.
 *
 * ## Why archive the record but delete the posting
 *
 * `RecordSequence` issues `journal_entry_number` on CREATE, so an abandoned
 * `JNL-0006` leaves a hole in a gapless sequence forever - and that hole is
 * correct, the same reasoning `discardDraftPosting`'s callers everywhere else
 * apply. The posting, by contrast, never left `draft`: it holds no claim, no
 * doc number and nothing any report has read, so there is nothing to preserve
 * by keeping the row.
 *
 * A second discard of the same entry is a `NotFoundError`, not a silent
 * success: `requireJournalEntry` reads through the same `archivedAt IS NULL`
 * filter every other reader does.
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

      if (entry.glPostingId) {
        const discarded = await discardDraftPosting(db, {
          organizationId,
          glPostingId: entry.glPostingId,
        })
        if (discarded.isErr()) throw discarded.error
      }

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      await crud.archive(toRecordId(ctx.journalEntryDefId, entry.id) as RecordId)

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
 * Turn a stored draft into a `BuiltEntry` for PREVIEW/POST, or throw naming the
 * row. Refuses `recurring_template` and `opening_balance` BY NAME - neither
 * posts through this door.
 */
function buildDraftEntry(entry: JournalEntryRecord): BuiltManualEntry {
  if (entry.kind === 'recurring_template') {
    throw new UnprocessableEntityError(
      'A recurring template is a stencil for future entries, not an entry. Copy it into a new ' +
        'journal entry and post that.',
      { journalEntryId: entry.id }
    )
  }
  // 🛑 An opening entry keys on the CUTOVER DATE, and this path would key it on
  // the record's number. `doc-number.ts` declares the cutover-date rule because
  // an org has exactly one opening trial balance. `opening-trial-balance/writes.ts`
  // is the only route, posting `{ sourceKind: 'opening_balance', sourceId:
  // organizationId }` directly rather than through this record's own draft.
  if (entry.kind === 'opening_balance') {
    throw new UnprocessableEntityError(
      'An opening trial balance posts from the accounting setup, never from the journal-entry ' +
        'drawer: it keys on the cutover date rather than on this record number, and that ' +
        'key is what makes a second opening balance impossible to post. Open Accounting settings ' +
        'and post it from the opening trial balance page (ledgerOpening.post).',
      { journalEntryId: entry.id, kind: entry.kind }
    )
  }
  return buildDraftStorageEntry(entry, entry.lines)
}

/**
 * Build the entry behind a draft's `GlPosting`, for storage (create/edit) AND,
 * via {@link buildDraftEntry}, for `manual`/`recurring` post.
 *
 * `recurring_template` is deliberately NOT refused here - unlike
 * {@link buildDraftEntry} above, this is also the storage path a template's own
 * draft is kept in sync through, and a template is never handed to `postDraft`.
 */
function buildDraftStorageEntry(
  entry: Pick<
    JournalEntryRecord,
    'id' | 'date' | 'memo' | 'kind' | 'number' | 'recurrenceRuleId' | 'occurrenceDate'
  >,
  lines: JournalEntryLine[]
): BuiltManualEntry {
  if (!entry.date) {
    throw new UnprocessableEntityError(
      'This journal entry has no date. An entry has to name the day it posts on.',
      { journalEntryId: entry.id }
    )
  }

  const postingType: ManualPostingType =
    entry.kind === 'recurring_template' ? 'manual_journal' : JOURNAL_ENTRY_POSTING_TYPE[entry.kind]

  // 🛑 A generated entry keys on the RULE and the SLOT, never on its own
  // number, and that substitution IS the idempotency (task 21 §1.4). A
  // template and a hand-authored entry key on the record's own number instead -
  // the template's draft is never posted, and a manual entry's number is what
  // `doc-number.ts` declares for it.
  const number =
    entry.kind === 'recurring'
      ? recurringJournalPeriodKey(requireRecurrenceIdentity(entry))
      : entry.number

  if (!number) {
    throw new UnprocessableEntityError(
      'This journal entry has no number, so its draft posting cannot be built - the number is ' +
        "what the posting's document number is keyed on. Re-create the entry.",
      { journalEntryId: entry.id }
    )
  }

  return buildManualEntry({
    postingType,
    number,
    txnDate: entry.date,
    memo: entry.memo ?? undefined,
    lines,
    sourceId: entry.id,
  })
}

/**
 * Both halves of the recurrence identity, or a refusal naming the record.
 *
 * A `recurring` entry with half a pointer is not postable at all: the key
 * would name a rule or a slot that is not there, and every later occurrence of
 * the real one would fold to a different key. The materializer writes both in
 * one `create`, so reaching this means the row was hand-edited or written by
 * something that is not the materializer.
 */
function requireRecurrenceIdentity(
  entry: Pick<JournalEntryRecord, 'id' | 'recurrenceRuleId' | 'occurrenceDate'>
): {
  recurrenceRuleId: string
  occurrenceDate: string
} {
  if (!entry.recurrenceRuleId || !entry.occurrenceDate) {
    throw new UnprocessableEntityError(
      'This entry says it was generated from a recurring template but does not name both the ' +
        'rule and the occurrence it fills, so there is nothing to key its posting on. Discard ' +
        'it and let the next sweep generate the occurrence again.',
      { journalEntryId: entry.id }
    )
  }
  return { recurrenceRuleId: entry.recurrenceRuleId, occurrenceDate: entry.occurrenceDate }
}

/**
 * Refuse a recurrence identity that does not match the kind.
 *
 * Both directions are refused, because both are silent otherwise: a
 * `recurring` entry with no pointer cannot key its posting (above), and a
 * `manual` entry carrying one would key on its own number while claiming to
 * own a slot the sweep would then generate a second entry for.
 */
function assertRecurrenceIdentity(
  kind: JournalEntryKindValue,
  input: Pick<CreateJournalEntryInput, 'recurrenceRuleId' | 'occurrenceDate'>
): void {
  const hasRule = Boolean(input.recurrenceRuleId)
  const hasSlot = Boolean(input.occurrenceDate)
  if (hasRule !== hasSlot) {
    throw new UnprocessableEntityError(
      'A generated journal entry names both the recurrence rule and the occurrence date, or ' +
        'neither. One without the other has nothing to key its posting on.',
      { kind }
    )
  }
  if (hasRule && kind !== 'recurring') {
    throw new UnprocessableEntityError(
      `A ${kind} journal entry may not carry a recurrence rule. Only a generated entry ` +
        "(kind 'recurring') does, because the kind is what decides the posting type.",
      { kind }
    )
  }
  if (!hasRule && kind === 'recurring') {
    throw new UnprocessableEntityError(
      "A generated journal entry (kind 'recurring') has to name the rule and the occurrence " +
        'date it fills - they are what its posting is keyed on.',
      { kind }
    )
  }
}

/** The override keys a preview may supply, with `undefined` meaning "use what is stored". */
function pickOverrides(input: PreviewJournalEntryInput): Partial<JournalEntryRecord> {
  const overrides: Partial<JournalEntryRecord> = {}
  if (input.date !== undefined) overrides.date = input.date
  if (input.memo !== undefined) overrides.memo = input.memo
  if (input.lines !== undefined) overrides.lines = input.lines
  return overrides
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
