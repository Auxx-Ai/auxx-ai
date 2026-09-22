// packages/lib/src/accounting/journals/entries/writes.ts

/**
 * Every WRITE over the journal-entry document (91 D5): create it with its
 * `journal_entry_line` children, edit it while unposted, post it (build from the
 * lines, `postEntry`, stamp `journal_entry_gl_posting_id`), reverse it, delete it.
 * A posted entry changes only by reversal or through edit-in-place
 * (`documents/edit-in-place/spec.ts`). Balance is checked at Post and preview,
 * never at save. No permission checks; the router asserts `ledgerPost`.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { readEditStamp } from '../../../entity-instances/edit-snapshot'
import { ConflictError, UnprocessableEntityError } from '../../../errors'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { type RecordId, toRecordId } from '../../../resources/resource-id'
import { documentEntryKey } from '../../documents/document-entry-key'
import {
  type BuiltManualEntry,
  buildManualEntry,
  MANUAL_ENTRY_SOURCE_TYPE,
  type ManualPostingType,
} from '../../ledger/builders/manual'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { postEntry, previewEntry } from '../../ledger/post/post-entry'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { readPostingLineSourceIds } from '../../ledger/reads/read-posting'
import type { EntryPreview, GlPostingSourceInput, PostResult } from '../../ledger/types'
import { recurringJournalPeriodKey } from '../recurring/client'
import {
  JOURNAL_ENTRY_POSTING_TYPE,
  type JournalEntryKindValue,
  type JournalEntryLine,
  type JournalEntryRecord,
} from './client'
import { requireJournalEntryFieldContext, requireJournalEntryLineFieldContext } from './fields'
import { guard } from './guard'
import { readRecurrenceIdentities, requireJournalEntry } from './reads'
import { assertJournalEntryIsDraft } from './refusals'

const logger = createScopedLogger('postings:journal-entries')

export interface CreateJournalEntryInput {
  /** Defaults to `manual`. Set once - the field is `updatable: false`. */
  kind?: JournalEntryKindValue
  /** `YYYY-MM-DD`. The accounting date. */
  date: string
  memo?: string
  /** Written as child records in this order. `id` is ignored. Unbalanced is fine until Post. */
  lines?: JournalEntryLine[]
  /**
   * Only the recurring-journal materializer passes these, and always both: they
   * are what the posting's `periodKey` and claim are keyed on.
   * {@link assertRecurrenceIdentity} refuses half a pair.
   */
  recurrenceRuleId?: string
  occurrenceDate?: string
}

export interface UpdateJournalEntryInput {
  journalEntryId: string
  date?: string
  memo?: string
  /**
   * The entry's lines after the edit, in order. A line whose `id` names one of
   * this entry's lines updates it; one without (or with a foreign id) is created;
   * an existing line not named is deleted.
   */
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
 * Create the record and its lines. Always lands `draft`; nothing touches the
 * ledger until {@link postJournalEntry}. The number is issued by
 * `JOURNAL_ENTRY_HOOKS` on create.
 */
export async function createJournalEntry(
  db: Database,
  organizationId: string,
  userId: string,
  input: CreateJournalEntryInput
): Promise<Result<JournalEntryRecord, Error>> {
  return guard(
    async () => {
      const ctx = await requireJournalEntryFieldContext(db, organizationId)
      const kind = input.kind ?? 'manual'
      assertRecurrenceIdentity(kind, input)
      const lines = input.lines ?? []
      assertLineShapes(lines)
      const date = toStoredDate(input.date)

      const values: Record<string, unknown> = {
        journal_entry_kind: kind,
        journal_entry_date: date,
      }
      if (input.memo) values.journal_entry_memo = input.memo
      if (input.recurrenceRuleId && input.occurrenceDate) {
        values.journal_entry_recurrence_rule_id = input.recurrenceRuleId
        values.journal_entry_occurrence_date = input.occurrenceDate
      }

      const lineCtx =
        lines.length > 0 ? await requireJournalEntryLineFieldContext(db, organizationId) : null
      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const created = await crud.create(ctx.defId, values)
      const journalEntryId = created.instance.id

      if (lineCtx) {
        await createLines(
          crud,
          lineCtx.defId,
          toRecordId(ctx.defId, journalEntryId),
          lines.map((line, sortOrder) => ({ line, sortOrder }))
        )
      }

      logger.info('Created journal entry', {
        organizationId,
        journalEntryId,
        kind,
        lineCount: lines.length,
      })

      return requireJournalEntry(db, organizationId, journalEntryId)
    },
    'Failed to create journal entry',
    { organizationId }
  )
}

/**
 * Edit an unposted entry, or a posted one while edit-in-place holds it open
 * (Save then reverses and reposts). `ConflictError` otherwise, naming reversal.
 */
export async function updateJournalEntry(
  db: Database,
  organizationId: string,
  userId: string,
  input: UpdateJournalEntryInput
): Promise<Result<JournalEntryRecord, Error>> {
  return guard(
    async () => {
      const ctx = await requireJournalEntryFieldContext(db, organizationId)
      const entry = await requireJournalEntry(db, organizationId, input.journalEntryId)
      await assertJournalEntryEditable(db, organizationId, entry)
      if (input.lines) assertLineShapes(input.lines)

      const values: Record<string, unknown> = {}
      if (input.date !== undefined) values.journal_entry_date = toStoredDate(input.date)
      // An empty string CLEARS the memo; `undefined` leaves it alone.
      if (input.memo !== undefined) values.journal_entry_memo = input.memo || null

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const recordId = toRecordId(ctx.defId, entry.id)
      if (Object.keys(values).length > 0) await crud.update(recordId, values)

      if (input.lines) {
        const lineCtx = await requireJournalEntryLineFieldContext(db, organizationId)
        await syncLines(crud, lineCtx.defId, recordId, entry.lines, input.lines)
      }

      return requireJournalEntry(db, organizationId, input.journalEntryId)
    },
    'Failed to update journal entry',
    { organizationId, journalEntryId: input.journalEntryId }
  )
}

/**
 * What this entry WOULD post. Persists nothing; the overrides let the drawer
 * preview what is on screen without saving it. Refusals arrive on `blockedBy`;
 * the arithmetic (an unbalanced entry, a bad row) throws, naming the row.
 */
export async function previewJournalEntry(
  db: Database,
  organizationId: string,
  input: PreviewJournalEntryInput
): Promise<Result<EntryPreview, Error>> {
  return guard(
    async () => {
      const stored = await requireJournalEntry(db, organizationId, input.journalEntryId)
      const { entry } = buildEntryForJournalEntry({ ...stored, ...pickOverrides(input) })
      const lock = await resolvePeriodLock(organizationId)
      return previewEntry(db, { organizationId, entry, lock })
    },
    'Failed to preview journal entry',
    { organizationId, journalEntryId: input.journalEntryId }
  )
}

/**
 * Build the entry from the lines, post it, and stamp the record's pointer.
 *
 * The outer `Result` carries only the refusals made before the ledger is asked
 * (a template, an opening entry, a bad row, an unbalanced entry); everything the
 * ledger says - `period_closed`, `account_invalid`, a provider refusal - comes
 * back as the `PostResult` for the screen to render. A refusal leaves the record
 * `draft`, so "fix it and press Post again" needs nothing cleared.
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
      return postBuiltJournalEntry(db, {
        organizationId,
        actorUserId: userId,
        entry,
        built: buildEntryForJournalEntry(entry),
        memo: input.memo,
      })
    },
    'Failed to post journal entry',
    { organizationId, journalEntryId: input.journalEntryId }
  )
}

/**
 * Put an already-built journal entry in the books and stamp the pointer - the one
 * poster behind Post and edit-in-place Save. Never throws for a ledger outcome.
 */
export async function postBuiltJournalEntry(
  db: Database,
  input: {
    organizationId: string
    actorUserId: string
    entry: JournalEntryRecord
    built: BuiltManualEntry
    memo?: string
  }
): Promise<PostResult> {
  const { organizationId, actorUserId, entry } = input
  const lock = await resolvePeriodLock(organizationId)
  const result = await postEntry(db, {
    organizationId,
    entry: input.built.entry,
    lock,
    actorUserId,
    memo: input.memo ?? entry.memo ?? undefined,
    sources: [journalEntrySubject(entry)],
  })

  // A collision wrote nothing for THIS entry; stamping it would claim another occurrence's posting.
  const collision = await findRecurringKeyCollision(db, organizationId, entry, result)
  if (collision) return collision

  if (didLedgerAccept(result) && result.glPostingId && result.glPostingId !== entry.glPostingId) {
    const ctx = await requireJournalEntryFieldContext(db, organizationId)
    const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
    await crud.update(toRecordId(ctx.defId, entry.id), {
      journal_entry_gl_posting_id: result.glPostingId,
    })
  }

  logger.info('Posted journal entry', {
    organizationId,
    journalEntryId: entry.id,
    number: entry.number,
    status: result.status,
    glPostingId: result.glPostingId,
  })
  return result
}

/**
 * The claim a journal entry posts under. A generated entry claims its rule's
 * occurrence, so two records raised for one slot converge to `already_posted`
 * instead of colliding on the document number.
 */
function journalEntrySubject(entry: JournalEntryRecord): GlPostingSourceInput {
  if (entry.kind === 'recurring') {
    const { recurrenceRuleId, occurrenceDate } = requireRecurrenceIdentity(entry)
    return {
      sourceKind: 'recurring_journal',
      sourceId: recurrenceRuleId,
      occurrence: occurrenceDate,
      linkRole: 'subject',
    }
  }
  return { sourceKind: 'journal_entry', sourceId: entry.id, linkRole: 'subject' }
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
 * because two records of one occurrence are a convergence rather than a clash.
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
 * Void: back a posted entry out with a second, opposite one. `reverseEntry`
 * flips the posting to `reversed`, and the record's status is read off it.
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
            'Only a posted entry can be reversed - an unposted one is simply edited.',
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
 * Delete an unposted entry; its lines go with it through the `journal_entry.lines`
 * cascade. The number is not reused - `RecordSequence` leaves the hole. A second
 * discard is a `NotFoundError`.
 */
export async function discardJournalEntry(
  db: Database,
  organizationId: string,
  userId: string,
  input: { journalEntryId: string }
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      const ctx = await requireJournalEntryFieldContext(db, organizationId)
      const entry = await requireJournalEntry(db, organizationId, input.journalEntryId)
      assertJournalEntryIsDraft(entry, 'discarded')

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      await crud.delete(toRecordId(ctx.defId, entry.id))

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
 * The entry this journal's CURRENT lines produce at `generation` - pure, persists
 * nothing - or a throw naming the row. Refuses `recurring_template` and
 * `opening_balance` BY NAME: neither posts through this door. Generation N > 1 is
 * an edit-in-place repost, keyed past the reversed original (`documentEntryKey`).
 */
export function buildEntryForJournalEntry(
  entry: Pick<
    JournalEntryRecord,
    'id' | 'date' | 'memo' | 'kind' | 'number' | 'recurrenceRuleId' | 'occurrenceDate' | 'lines'
  >,
  generation = 1
): BuiltManualEntry {
  if (entry.kind === 'recurring_template') {
    throw new UnprocessableEntityError(
      'A recurring template is a stencil for future entries, not an entry. Copy it into a new ' +
        'journal entry and post that.',
      { journalEntryId: entry.id }
    )
  }
  // An opening entry keys on the cutover date, not this record's number; `opening/writes.ts` posts it.
  if (entry.kind === 'opening_balance') {
    throw new UnprocessableEntityError(
      'An opening trial balance posts from the accounting setup, never from the journal-entry ' +
        'drawer: it keys on the cutover date rather than on this record number, and that ' +
        'key is what makes a second opening balance impossible to post. Open Accounting settings ' +
        'and post it from the opening trial balance page (ledgerOpening.post).',
      { journalEntryId: entry.id, kind: entry.kind }
    )
  }
  if (!entry.date) {
    throw new UnprocessableEntityError(
      'This journal entry has no date. An entry has to name the day it posts on.',
      { journalEntryId: entry.id }
    )
  }

  const postingType: ManualPostingType = JOURNAL_ENTRY_POSTING_TYPE[entry.kind]

  // 🛑 A generated entry keys on the RULE and the SLOT, never on its own number:
  // that substitution IS the idempotency (task 21 §1.4).
  const base =
    entry.kind === 'recurring'
      ? recurringJournalPeriodKey(requireRecurrenceIdentity(entry))
      : entry.number

  if (!base) {
    throw new UnprocessableEntityError(
      'This journal entry has no number, so its posting cannot be built - the number is ' +
        "what the posting's document number is keyed on. Re-create the entry.",
      { journalEntryId: entry.id }
    )
  }

  return buildManualEntry({
    postingType,
    number: documentEntryKey(base, generation) ?? base,
    txnDate: entry.date,
    memo: entry.memo ?? undefined,
    lines: entry.lines,
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

/** Unposted, or posted and held open by edit-in-place; anything else is refused, naming reversal. */
async function assertJournalEntryEditable(
  db: Database,
  organizationId: string,
  entry: JournalEntryRecord
): Promise<void> {
  if (entry.status === 'posted' && (await readEditStamp(db, organizationId, entry.id))) return
  assertJournalEntryIsDraft(entry, 'edited')
}

/**
 * Refuse a line no row could hold. Deliberately not the posting rules - an
 * uncoded or unbalanced entry saves, and `buildManualEntry` refuses it at Post.
 */
function assertLineShapes(lines: readonly JournalEntryLine[]): void {
  lines.forEach((line, index) => {
    const row = index + 1
    if (line.direction !== 'debit' && line.direction !== 'credit') {
      throw new UnprocessableEntityError(`Row ${row} is neither a debit nor a credit.`, {
        row: String(row),
      })
    }
    if (!Number.isInteger(line.amountMinor) || line.amountMinor < 0) {
      throw new UnprocessableEntityError(
        `Row ${row} has amount ${String(line.amountMinor)}, which is not a whole number of cents.`,
        { row: String(row) }
      )
    }
  })
}

/** One line as `journal_entry_line` values. `clear` writes nulls, so an update can empty a field. */
function lineValues(
  journalEntryRecordId: RecordId,
  line: JournalEntryLine,
  sortOrder: number,
  clear: boolean
): Record<string, unknown> {
  const optional = (value: string | undefined) => (value ? value : clear ? null : undefined)
  const values: Record<string, unknown> = {
    journal_entry_line_journal_entry: journalEntryRecordId,
    journal_entry_line_gl_account: optional(line.glAccountId?.trim()),
    journal_entry_line_side: line.direction,
    journal_entry_line_amount: line.amountMinor,
    journal_entry_line_memo: optional(line.memo),
    journal_entry_line_counterparty_type: optional(
      line.counterpartyId ? line.counterpartyType : undefined
    ),
    journal_entry_line_counterparty: optional(
      line.counterpartyType ? line.counterpartyId : undefined
    ),
    journal_entry_line_sort_order: sortOrder,
  }
  for (const key of Object.keys(values)) if (values[key] === undefined) delete values[key]
  return values
}

/** Create each line under the entry at its sort order. */
async function createLines(
  crud: UnifiedCrudHandler,
  lineDefId: string,
  journalEntryRecordId: RecordId,
  lines: readonly { line: JournalEntryLine; sortOrder: number }[]
): Promise<void> {
  const items = lines.map(({ line, sortOrder }) =>
    lineValues(journalEntryRecordId, line, sortOrder, false)
  )
  const { errors } = await crud.bulkCreate(lineDefId, items)
  const first = errors[0]
  if (first) {
    const row = (lines[first.index]?.sortOrder ?? first.index) + 1
    throw new UnprocessableEntityError(`Row ${row} could not be saved: ${first.error}`, {
      row: String(row),
    })
  }
}

/** Make the entry's children match `next`: update named rows that changed, create the rest, delete the unnamed. */
async function syncLines(
  crud: UnifiedCrudHandler,
  lineDefId: string,
  journalEntryRecordId: RecordId,
  current: readonly JournalEntryLine[],
  next: readonly JournalEntryLine[]
): Promise<void> {
  const currentById = new Map(
    current.flatMap((line, index) => (line.id ? [[line.id, { line, index }] as const] : []))
  )
  const kept = new Set<string>()
  const created: { line: JournalEntryLine; sortOrder: number }[] = []

  for (const [sortOrder, line] of next.entries()) {
    const existing = line.id ? currentById.get(line.id) : undefined
    if (!existing || !line.id || kept.has(line.id)) {
      created.push({ line, sortOrder })
      continue
    }
    kept.add(line.id)
    if (existing.index === sortOrder && sameLine(existing.line, line)) continue
    await crud.update(
      toRecordId(lineDefId, line.id),
      lineValues(journalEntryRecordId, line, sortOrder, true)
    )
  }

  const removed = [...currentById.keys()].filter((id) => !kept.has(id))
  if (removed.length > 0) {
    const { errors } = await crud.bulkDelete(removed.map((id) => toRecordId(lineDefId, id)))
    if (errors[0])
      throw new UnprocessableEntityError(`A line could not be removed: ${errors[0].message}`)
  }
  if (created.length > 0) await createLines(crud, lineDefId, journalEntryRecordId, created)
}

function sameLine(a: JournalEntryLine, b: JournalEntryLine): boolean {
  return (
    (a.glAccountId ?? '').trim() === (b.glAccountId ?? '').trim() &&
    a.direction === b.direction &&
    a.amountMinor === b.amountMinor &&
    (a.memo ?? '') === (b.memo ?? '') &&
    (a.counterpartyType ?? '') === (b.counterpartyType ?? '') &&
    (a.counterpartyId ?? '') === (b.counterpartyId ?? '')
  )
}
