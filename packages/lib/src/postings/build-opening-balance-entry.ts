// packages/lib/src/postings/build-opening-balance-entry.ts

/**
 * The opening trial balance: what every account in the chart was worth on the
 * day auxx.ai took the books over, as ONE balanced double-entry posting.
 *
 * PURE. No database, no clock, no chart. Same input in, same `BuiltEntry` out,
 * which is what lets the date arithmetic and the refusals below be tested
 * exhaustively rather than driven.
 *
 * ## Why this is a third builder and not an argument to `buildManualEntry`
 *
 * It calls `buildManualEntry` for everything a hand-authored entry already
 * owns - the two-line minimum, `Σ Dr = Σ Cr` with the difference named, a
 * positive integer amount per row, the same-account-both-sides warning - and
 * restates none of it. What lives HERE is the set of rules that are true of an
 * opening entry and false of every other one:
 *
 * - **The date is derived, never supplied.** An opening entry is dated the last
 *   day of `accounting.cutoffPeriod`, which is the day before the first month
 *   auxx.ai values. A caller passing its own `txnDate` could date it inside the
 *   first open month, where it would be double counted by everything that
 *   measures activity from the cutover.
 * - **`periodKey` is that same date**, not an entry number. `doc-number.ts`
 *   declares it: an org has exactly ONE opening entry, so keying on the cutover
 *   date makes a double post unrepresentable at the claim's
 *   `(organizationId, postingType, periodKey, revision)` unique index rather
 *   than merely detected afterwards. Every other hand-authored type keys on the
 *   record's own number because many of them can post in one day.
 * - **Zero rows are dropped.** The screen is a grid over the WHOLE chart, so
 *   most rows are legitimately zero and `buildEntry` refuses a zero-amount
 *   line. Dropping them here is what lets the grid post what it has.
 * - **An empty trial balance is refused**, and refused separately from the
 *   two-line minimum, because "you have not entered anything" and "you have
 *   entered one side" are different mistakes with different repairs.
 *
 * ## 🛑 Why this is NOT an inventory writer, even though it names 1310/1320/1330
 *
 * It looks wrong, so it is written down. An opening entry MUST carry the three
 * inventory accounts: without them the ledger's inventory starts at zero, and
 * the first close would then report the whole opening stock as a movement.
 *
 * It does not double count, because the month-end inventory entry never reads
 * this entry. `gather-month-end-inventory.ts` takes its prior assertion from
 * `readOpeningBaseline`, which reads the `accounting.opening*` SETTINGS, and
 * posts `target − baseline`. So after the first close the ledger holds
 * `opening + (target − opening) = target`, exactly once.
 *
 * And the two numbers cannot disagree, because the wizard prefills the three
 * inventory rows FROM those settings and locks them (`FrozenLock`, "set on the
 * previous page"). The settings are the single source; this entry is their
 * ledger form.
 *
 * That is also why `SINGLE_WRITER_ROLES_BY_POSTING_TYPE.opening_balance` is
 * `[]` in `regime.ts`: an opening entry drives no ROLE at all, so
 * `findWriterConflicts` has nothing to see, and the by-name refusal in
 * `post-entry.ts` is scoped to `manual_journal` for the same reason.
 *
 * @see plans/accounting/tasks/03-opening-balances.md
 * @see plans/accounting/HANDOFF.md slot 1C
 */

import { UnprocessableEntityError } from '../errors'
import { buildManualEntry, type ManualEntryLine } from './build-manual-entry'
import { parsePeriodKey } from './periods'
import { isValidTimeZone } from './setup-readiness'
import type { BuiltEntry } from './types'

/** One row of the trial-balance grid, as a person entered it. */
export type OpeningBalanceLine = ManualEntryLine

export interface BuildOpeningBalanceEntryInput {
  /**
   * `accounting.cutoffPeriod` - the last month the PREVIOUS system closed,
   * `'2026-12'`. Always a `YYYY-MM` month key.
   */
  cutoffPeriod: string
  /**
   * `accounting.bookTimeZone`.
   *
   * ⚠️ It performs no conversion here and that is deliberate. The cutover date
   * is a WALL-CLOCK date in the book zone - "December 31" means the last day of
   * December wherever the books are kept - and a `YYYY-MM-DD` accounting date
   * carries no instant to convert. What the zone is for is the refusal: every
   * period boundary in the system derives from it, so an entry built against an
   * unset or bogus zone would post fine and then sit in a ledger whose months
   * are drawn somewhere else. `periods.ts` states the same rule for every
   * per-event key, where the conversion IS real.
   */
  bookTimeZone: string
  /** One row per account with a balance. Zero rows are dropped, not refused. */
  lines: OpeningBalanceLine[]
  /** The entry's memo. Carried onto every line that has none of its own. */
  memo?: string
  /**
   * The `journal_entry` record of kind `opening_balance` this was typed into.
   * Becomes every line's `sourceId`.
   */
  sourceId: string
}

export interface BuiltOpeningBalanceEntry {
  entry: BuiltEntry
  /** Non-fatal observations from {@link buildManualEntry}. Empty is ordinary. */
  warnings: string[]
  /** `YYYY-MM-DD`, the derived cutover date. Also the entry's `periodKey`. */
  cutoverDate: string
}

/** The `sourceType` every opening line carries, same as a manual entry's. */
export const OPENING_ENTRY_SOURCE_TYPE = 'journal_entry'

/**
 * The last day of a `YYYY-MM` month, as `YYYY-MM-DD`.
 *
 * The cutover date: the day before the first month auxx.ai values, and the date
 * the opening entry is posted on.
 *
 * `Date.UTC(year, month, 0)` is day zero of the FOLLOWING month, which
 * normalizes to the last day of this one - leap years included, with no table.
 * UTC throughout: the result is a wall-clock date, and reading it back through
 * any local getter is what puts December 31 into November for half the world.
 *
 * @throws {BadRequestError} when `cutoffPeriod` is not a real `YYYY-MM` month.
 */
export function cutoverDateFor(cutoffPeriod: string): string {
  const parsed = parsePeriodKey(cutoffPeriod)
  if (parsed.granularity !== 'month') {
    throw new UnprocessableEntityError(
      `The accounting cutoff is "${cutoffPeriod}", a day. It has to be a YYYY-MM month - the ` +
        'opening entry is dated the last day of it.',
      { cutoffPeriod }
    )
  }
  const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0))
  const month = String(lastDay.getUTCMonth() + 1).padStart(2, '0')
  const day = String(lastDay.getUTCDate()).padStart(2, '0')
  return `${String(lastDay.getUTCFullYear()).padStart(4, '0')}-${month}-${day}`
}

/**
 * Build the one opening entry, or throw naming what stopped it.
 *
 * Throws rather than returning a `Result` for the reason ground rule 3 gives:
 * an unbalanced trial balance is an arithmetic impossibility, not a read
 * failure a caller can recover from. `postEntry` above converts what it can
 * into a status.
 *
 * @throws {UnprocessableEntityError} on a cutoff that is not a month, an
 *   invalid book timezone, a trial balance with no amounts in it, or anything
 *   `buildManualEntry` refuses (fewer than two non-zero rows, an imbalance
 *   naming the difference, a negative or fractional amount naming the row).
 */
export function buildOpeningBalanceEntry(
  input: BuildOpeningBalanceEntryInput
): BuiltOpeningBalanceEntry {
  const { cutoffPeriod, bookTimeZone, lines, memo, sourceId } = input

  const cutoverDate = cutoverDateFor(cutoffPeriod)

  if (!bookTimeZone || !isValidTimeZone(bookTimeZone)) {
    throw new UnprocessableEntityError(
      `"${bookTimeZone}" is not a valid IANA timezone. Every period boundary in the books is ` +
        'drawn in the book timezone, so an opening entry cannot be dated without one. There is ' +
        'no UTC fallback.',
      { cutoffPeriod, bookTimeZone }
    )
  }

  if (lines.length === 0) {
    throw new UnprocessableEntityError(
      'The opening trial balance is empty. Enter what each account was worth on ' +
        `${cutoverDate} - the statement balance for every bank and card account, not the tax return.`,
      { cutoffPeriod, cutoverDate }
    )
  }

  // Dropped, not refused. The grid is the WHOLE chart and most of a chart has
  // no opening balance, so an untouched row arrives as zero. `buildEntry`
  // refuses a zero-amount line, which is right for a builder emitting legs it
  // computed and wrong for a form somebody typed three numbers into.
  const nonZero = lines.filter((line) => line.amountMinor !== 0)

  if (nonZero.length === 0) {
    throw new UnprocessableEntityError(
      `Every row of the opening trial balance is zero, so there is nothing to post on ${cutoverDate}. ` +
        'An organization that genuinely opened with nothing has no opening entry to make.',
      { cutoffPeriod, cutoverDate, rows: String(lines.length) }
    )
  }

  const { entry, warnings } = buildManualEntry({
    postingType: 'opening_balance',
    // 🛑 The DATE, not an entry number. See the file header.
    number: cutoverDate,
    txnDate: cutoverDate,
    memo: memo ?? `Opening balances as of ${cutoverDate}`,
    lines: nonZero,
    sourceId,
  })

  return { entry, warnings, cutoverDate }
}
