// packages/lib/src/postings/opening-trial-balance/writes.ts

/**
 * Every WRITE over the opening trial balance: save the draft, preview it, post
 * it once.
 *
 * Writes only. The reads live in `reads.ts` (`docs/lib-module-guide.md` §5).
 * No permission checks; the router asserts `ledgerPost` (§6).
 *
 * ## Why this is not `journal-entries/writes.ts` with a flag
 *
 * 🛑 **The opening entry's `periodKey` is the CUTOVER DATE, not the record's
 * number.** `postJournalEntry` builds through `buildManualEntry` with
 * `number: entry.number` (`'JNL-0009'`), which is exactly right for a manual
 * adjusting entry - many can post in one day, so keying on the date would make
 * the second collide with the first on the claim's
 * `(organizationId, postingType, periodKey, revision)` unique index and come
 * back `already_posted`. An opening entry is the opposite case: an org has
 * exactly ONE, `doc-number.ts` declares that it keys on the cutover date, and
 * that key is what makes a double post unrepresentable rather than merely
 * unlikely. Two entries, two keying rules, and neither is a special case of the
 * other.
 *
 * So {@link postOpeningTrialBalance} runs the same three steps
 * `postJournalEntry` does - build, `postEntry`, stamp the record - over
 * `buildOpeningBalanceEntry` instead. The duplication is thirty lines and it is
 * deliberate; the alternative was a `builder` parameter on `postJournalEntry`,
 * which would have made the manual path carry a branch it never takes.
 *
 * ## The freeze
 *
 * Saving the draft goes through `assertAccountingSetupUnfrozen`, the SAME
 * server guard `setting.batchUpdate` uses for `accounting.opening*`. The trial
 * balance is not a setting, but it is the same baseline: every posted entry was
 * computed against it, and a freeze with a door in it is not a freeze. See
 * `OPENING_TRIAL_BALANCE_FREEZE_KEY` for why a non-existent key is the right
 * thing to hand that guard.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import { buildOpeningBalanceEntry } from '../build-opening-balance-entry'
import type { JournalEntryLine, JournalEntryRecord } from '../journal-entries/client'
import { requireJournalEntryFieldContext } from '../journal-entries/reads'
import { createJournalEntry, updateJournalEntry } from '../journal-entries/writes'
import { resolvePeriodLock } from '../period-lock'
import { postEntry, previewEntry } from '../post-entry'
import { assertAccountingSetupUnfrozen } from '../settled-periods'
import type { EntryPreview, PostResult } from '../types'
import {
  findLockedRowDivergences,
  OPENING_TRIAL_BALANCE_FREEZE_KEY,
  OPENING_TRIAL_BALANCE_KIND,
  type OpeningTrialBalanceRow,
} from './client'
import { guard } from './guard'
import { findOpeningTrialBalanceEntry, readOpeningTrialBalance } from './reads'

const logger = createScopedLogger('postings:opening-trial-balance')

export interface SaveOpeningTrialBalanceInput {
  /** The whole trial balance, replaced wholesale. Zero rows need not be sent. */
  lines: JournalEntryLine[]
  memo?: string
}

/**
 * Create or replace the draft.
 *
 * Wholesale, never a patch: a trial balance's rows have no identity, and a row
 * a person CLEARED has to be able to disappear. A patch protocol would need row
 * ids the stored JSON does not carry.
 *
 * The date is derived from `accounting.cutoffPeriod` on every save rather than
 * taken from the caller, so an org that corrects its cutoff before finalizing
 * gets a draft that follows it instead of one silently dated to the old month.
 *
 * @throws {ConflictError} once the ledger holds a standing entry - the baseline
 *   is frozen, and the message names the reversal path.
 * @throws {UnprocessableEntityError} when the cutoff or the book timezone is
 *   unset, because the entry has no date without them.
 */
export async function saveOpeningTrialBalance(
  db: Database,
  organizationId: string,
  userId: string,
  input: SaveOpeningTrialBalanceInput
): Promise<Result<JournalEntryRecord, Error>> {
  return guard(
    async () => {
      await assertAccountingSetupUnfrozen(organizationId, [OPENING_TRIAL_BALANCE_FREEZE_KEY])

      const cutoverDate = await requireCutoverDate(db, organizationId)
      const existing = await findOpeningTrialBalanceEntry(db, organizationId)

      if (!existing) {
        const created = await createJournalEntry(db, organizationId, userId, {
          kind: OPENING_TRIAL_BALANCE_KIND,
          date: cutoverDate,
          memo: input.memo,
          lines: input.lines,
        })
        if (created.isErr()) throw created.error
        logger.info('Raised the opening trial balance', {
          organizationId,
          journalEntryId: created.value.id,
          cutoverDate,
          lineCount: input.lines.length,
        })
        return created.value
      }

      // `updateJournalEntry` refuses anything but a draft with its own
      // `ConflictError` naming the reversal path, so a posted opening entry is
      // already covered without a second check here.
      const updated = await updateJournalEntry(db, organizationId, userId, {
        journalEntryId: existing.id,
        date: cutoverDate,
        ...(input.memo === undefined ? {} : { memo: input.memo }),
        lines: input.lines,
      })
      if (updated.isErr()) throw updated.error
      return updated.value
    },
    'Failed to save the opening trial balance',
    { organizationId }
  )
}

/**
 * What the opening entry WOULD post. Persists nothing.
 *
 * `lines` overrides the stored draft so the wizard's Finalize page and the
 * settings twin can preview what is on screen without saving first. Everything
 * `previewEntry` returns is renderable: a closed period, an account that has
 * left the chart, a document number that will not fit. What THROWS is the
 * arithmetic - an unbalanced or empty trial balance never becomes a
 * `BuiltEntry`, and the message names the difference.
 */
export async function previewOpeningTrialBalance(
  db: Database,
  organizationId: string,
  input: { lines?: JournalEntryLine[]; memo?: string } = {}
): Promise<Result<EntryPreview, Error>> {
  return guard(
    async () => {
      const { entry, cutoffPeriod, bookTimeZone, rows } = await requireDraftContext(
        db,
        organizationId
      )
      const lines = input.lines ?? entry.lines
      assertLockedRowsMatchSettings(organizationId, rows, lines)
      const built = buildOpeningBalanceEntry({
        cutoffPeriod,
        bookTimeZone,
        lines,
        memo: input.memo ?? entry.memo ?? undefined,
        sourceId: entry.id,
      })
      const lock = await resolvePeriodLock(organizationId)
      return previewEntry(db, { organizationId, entry: built.entry, lock })
    },
    'Failed to preview the opening trial balance',
    { organizationId }
  )
}

/**
 * Post the opening entry and stamp the record.
 *
 * Returns a `PostResult` verbatim rather than collapsing it into an error, for
 * `postJournalEntry`'s reason: a closed period, an account that is not in the
 * chart and a provider refusal are all things the wizard's Finalize page
 * RENDERS as an `EntryBlockers` card, and flattening them would throw away
 * `docNumber`, `failureClass` and `retryable`.
 *
 * 🛑 The record is stamped only on a status that actually wrote a posting.
 * `not_connected` and `disabled` DO write one - an org with no accounting
 * system has nothing in flight - and `already_posted` found one that was
 * already there, which is a converged re-run rather than a failure. A refusal
 * leaves the record `draft`, which is exactly what "fix it and press Finalize
 * again" needs.
 */
export async function postOpeningTrialBalance(
  db: Database,
  organizationId: string,
  userId: string,
  input: { memo?: string } = {}
): Promise<Result<PostResult, Error>> {
  return guard(
    async () => {
      const ctx = await requireJournalEntryFieldContext(organizationId)
      const { entry, cutoffPeriod, bookTimeZone, rows } = await requireDraftContext(
        db,
        organizationId
      )

      if (entry.status !== 'draft') {
        throw new ConflictError(
          `The opening trial balance is already ${entry.status}. A posted opening balance is ` +
            'corrected by reversing the entry from the ledger and posting a new one, never by ' +
            'editing it - the ledger has no update path.',
          { journalEntryId: entry.id, status: entry.status }
        )
      }

      assertLockedRowsMatchSettings(organizationId, rows, entry.lines)

      const built = buildOpeningBalanceEntry({
        cutoffPeriod,
        bookTimeZone,
        lines: entry.lines,
        memo: input.memo ?? entry.memo ?? undefined,
        sourceId: entry.id,
      })

      const lock = await resolvePeriodLock(organizationId)
      const result = await postEntry(db, {
        organizationId,
        entry: built.entry,
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

      logger.info('Posted the opening trial balance', {
        organizationId,
        journalEntryId: entry.id,
        cutoverDate: built.cutoverDate,
        status: result.status,
        glPostingId: result.glPostingId,
        warnings: built.warnings.length,
      })

      return result
    },
    'Failed to post the opening trial balance',
    { organizationId }
  )
}

/** The draft plus the two settings the builder needs, or a refusal naming what is missing. */
async function requireDraftContext(db: Database, organizationId: string) {
  const view = await readOpeningTrialBalance(db, organizationId)
  if (view.isErr()) throw view.error
  const { entry, cutoffPeriod, bookTimeZone } = view.value

  if (!entry) {
    throw new UnprocessableEntityError(
      'This organization has no opening trial balance yet. Enter one in the accounting setup ' +
        'wizard, or on Accounting settings > Opening balances, before posting it.',
      { organizationId }
    )
  }
  if (!cutoffPeriod || !bookTimeZone) {
    throw new UnprocessableEntityError(
      'The opening entry is dated the last day of the accounting cutoff month, in the book ' +
        'timezone, and one of those is not set. Set both on the accounting period page - there ' +
        'is no UTC fallback and no default cutoff.',
      { organizationId, cutoffPeriod: cutoffPeriod ?? '', bookTimeZone: bookTimeZone ?? '' }
    )
  }
  return { entry, cutoffPeriod, bookTimeZone, rows: view.value.rows }
}

/**
 * Refuse when a locked inventory row's STORED amount disagrees with the setting
 * that owns it, naming the account.
 *
 * `readOpeningTrialBalance` shows the SETTINGS value for those three rows and
 * the builder posts the STORED one, so a divergence is a screen that says one
 * number and a post that writes another - and the settings are also what
 * `readOpeningBaseline` hands the first close, so the ledger would then be
 * contradicted by the very next month-end assertion.
 *
 * Refusing rather than substituting: see {@link findLockedRowDivergences}. The
 * grid's lock makes this unreachable through the UI, so reaching it means
 * something wrote around it and a person should look.
 */
function assertLockedRowsMatchSettings(
  organizationId: string,
  rows: readonly OpeningTrialBalanceRow[],
  lines: readonly JournalEntryLine[]
): void {
  // An EMPTY draft is not a divergence to report - it is an empty trial
  // balance, and `buildOpeningBalanceEntry` refuses it with the message that
  // actually helps ("nothing has been entered"). Reporting three locked rows as
  // disagreeing with their settings would bury that.
  if (lines.length === 0) return

  const divergences = findLockedRowDivergences(rows, lines)
  if (divergences.length === 0) return
  const named = divergences
    .map(
      (d) =>
        `${d.accountCode}${d.accountName ? ` ${d.accountName}` : ''} (${d.role}): the draft holds ` +
        `${d.storedMinor} and the setting says ${d.settingMinor}`
    )
    .join('; ')
  throw new ConflictError(
    `The opening trial balance disagrees with the opening inventory settings on ${named}. ` +
      'Those three rows are owned by the accounting.opening* settings - they are what the first ' +
      'month-end close measures its delta from - so posting this draft would put a number in the ' +
      'ledger that the next close contradicts. Re-open the opening balances page so the locked ' +
      'rows are rewritten from the settings, then post again.',
    { organizationId, accounts: divergences.map((d) => d.accountCode).join(',') }
  )
}

/** The date the draft carries, derived rather than supplied. See {@link saveOpeningTrialBalance}. */
async function requireCutoverDate(db: Database, organizationId: string): Promise<string> {
  const view = await readOpeningTrialBalance(db, organizationId)
  if (view.isErr()) throw view.error
  const { cutoverDate, cutoffPeriod, bookTimeZone } = view.value
  if (!cutoverDate || !bookTimeZone) {
    throw new UnprocessableEntityError(
      `The accounting cutoff month ${cutoffPeriod ? `("${cutoffPeriod}") ` : ''}and the book ` +
        'timezone both have to be set before an opening trial balance can be entered - the entry ' +
        'is dated the last day of that month, in that zone.',
      { organizationId, cutoffPeriod: cutoffPeriod ?? '', bookTimeZone: bookTimeZone ?? '' }
    )
  }
  return cutoverDate
}
