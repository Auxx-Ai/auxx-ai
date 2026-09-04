// packages/lib/src/postings/build-manual-entry.ts

/**
 * The bookkeeper's entry: "debit this, credit that, because I said so."
 *
 * PURE. No database, no clock, no chart. Same input in, same `BuiltEntry` out,
 * forever - the property every other builder in this folder has and the reason
 * they are all testable without a fixture.
 *
 * ## Why this is a second builder and not an argument to `buildEntry`
 *
 * `buildEntry` is the shared arithmetic - positive integer minor units, `Σ Dr =
 * Σ Cr`, at least one line - and this function calls it rather than restating
 * any of it. What lives HERE is the set of rules that are true of a
 * HAND-AUTHORED entry and false of every builder-produced one:
 *
 * - **Two lines minimum.** A one-line entry is impossible in double entry, but
 *   `buildEntry` allows it because a one-line entry is not what it guards
 *   against: it would fail the balance check anyway. Saying it directly gives
 *   the person a sentence they can act on ("add the other side") instead of
 *   "debits 5000 != credits 0".
 * - **The difference, in minor units, named.** `buildEntry`'s imbalance message
 *   prints both totals; a bookkeeper at 11pm wants the number to type.
 * - **The same account on both sides is a WARNING, not a refusal.** It is legal
 *   and occasionally correct - reclassifying between two sub-uses of one
 *   account, or a wash entry a provider asked for. Refusing it would be this
 *   module deciding it knows the org's books better than the person keeping
 *   them. So it comes back beside the entry and the screen shows it.
 *
 * ## What is deliberately NOT here
 *
 * **The inventory refusal.** A line names `1310` by CODE, and this function has
 * no chart, so it cannot know which code carries `inventory_raw_materials` in
 * THIS org - and the whole point of `G8` is that the number differs per org.
 * The refusal therefore lives in `post-entry.ts`'s `prepareEntry`, which has
 * already resolved every line against the chart, and it fires for `preview` and
 * `post` alike as `blockedBy: { status: 'inventory_role_refused' }`. Putting a
 * hardcoded `['1310','1320','1330']` here would be correct for exactly the orgs
 * that never renumbered.
 *
 * **Anything about periods being open.** `resolvePeriodLock` and
 * `assertPeriodOpen` own that, and the poster surfaces it as `period_closed`.
 *
 * @see plans/accounting/tasks/02-manual-journal-entry.md
 */

import { UnprocessableEntityError } from '../errors'
import { buildEntry } from './build-entry'
import type { BuiltEntry, GlPostingLineInput, PostingDirection, PostingType } from './types'

/**
 * The two posting types a human authors by hand, line by line.
 *
 * Both name accounts by CODE and neither drives a role, which is why
 * `SINGLE_WRITER_ROLES_BY_POSTING_TYPE` declares `[]` for both and why the
 * inventory guard for them is by NAME rather than by role.
 */
export type ManualPostingType = Extract<PostingType, 'manual_journal' | 'opening_balance'>

/** One line as a person entered it: an account code, a side, and an amount. */
export interface ManualEntryLine {
  /** An account CODE out of this org's own chart, e.g. `'6300'`. */
  accountCode: string
  direction: PostingDirection
  /** Integer minor units, > 0. `direction` is the only carrier of sign. */
  amountMinor: number
  /** The line's own memo. Optional; the entry's memo covers the common case. */
  memo?: string
}

export interface BuildManualEntryInput {
  postingType: ManualPostingType
  /**
   * The `journal_entry` record's own number - `'JNL-0007'`.
   *
   * 🛑 **This becomes `periodKey`, and that is not a mistake.** `doc-number.ts`
   * declares that `manual_journal` keys its document number on the record
   * number rather than on a date, for the reason a `build` does: many entries
   * can be posted on one day, and a date key would make the second collide with
   * the first on `(organizationId, postingType, periodKey, revision)` - the
   * claim's unique index - so the second would silently come back
   * `already_posted`. A cuid is 24 characters and blows the 21-character
   * document-number cap outright.
   *
   * `opening_balance` is the exception: an org has exactly one, so it keys on
   * the cutover DATE and the caller passes that here instead. Both flow through
   * `buildDocNumber`, which strips hyphens.
   */
  number: string
  /** `YYYY-MM-DD`. The accounting date, and what the period lock is read against. */
  txnDate: string
  /** The entry's memo. Carried onto every line that has none of its own. */
  memo?: string
  lines: ManualEntryLine[]
  /**
   * The `journal_entry` record id. Becomes every line's `sourceId`, so "what
   * did this entry post to" and "what posted this line" are both answerable
   * without joining a provider.
   */
  sourceId: string
}

/** What a manual entry produced: the entry, and anything worth saying about it. */
export interface BuiltManualEntry {
  entry: BuiltEntry
  /**
   * Non-fatal observations, in the order they were found. Empty is the ordinary
   * answer. A screen shows these; it must not block Post on them.
   */
  warnings: string[]
}

/** The `sourceType` every manual line carries. The `journal_entry` record. */
export const MANUAL_ENTRY_SOURCE_TYPE = 'journal_entry'

/**
 * Dollars to integer minor units. **The only conversion in this subsystem.**
 *
 * 🛑 `FieldValue.valueNumber` is a double and every currency input in the app
 * hands back one, so `12.3` arrives as `12.299999999999999` often enough to
 * matter. `Math.round(dollars * 100)` on that gives `1230`, which is right, but
 * only because the rounding happens at the LAST step - `Math.trunc` or a
 * `toFixed` round trip through a string do not, and both have shipped elsewhere
 * in this repo's history. There is one function so there is one behaviour, and
 * it is tested against the doubles that actually break.
 *
 * Rejects a non-finite input rather than returning `NaN`: a `NaN` amount passes
 * every `>` comparison as false, so it would flow all the way to a ledger line
 * that reads as zero.
 *
 * @throws {UnprocessableEntityError} on `NaN`, `Infinity`, or a value whose
 *   minor-unit form is not an integer (sub-cent precision, which no ledger line
 *   can hold and which must not be silently discarded).
 */
export function toMinorUnits(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new UnprocessableEntityError(`Amount ${String(dollars)} is not a finite number`, {
      amount: String(dollars),
    })
  }
  const minor = Math.round(dollars * 100)
  // The round above hides sub-cent precision, which is exactly what must not be
  // hidden: 12.345 is a person typing a number this ledger cannot hold, and
  // silently booking 12.35 makes their entry not tie to the document it came
  // from. The tolerance is the double's own noise floor, not a rounding budget.
  if (Math.abs(dollars * 100 - minor) > 1e-6) {
    throw new UnprocessableEntityError(
      `Amount ${dollars} has sub-cent precision. A ledger line is whole cents; round it first.`,
      { amount: String(dollars) }
    )
  }
  return minor
}

/**
 * Build one hand-authored entry, or throw naming the row that stopped it.
 *
 * Throws rather than returning a `Result` for the reason ground rule 3 gives:
 * an arithmetic impossibility is not a read failure a caller can recover from,
 * and `postEntry` above it converts the throw into a status. Every message
 * names the ROW by its 1-based position, because that is what the person is
 * looking at.
 *
 * @throws {UnprocessableEntityError} on fewer than two lines, an imbalance
 *   (naming the difference in minor units), or a zero, negative, non-integer or
 *   non-finite amount (naming the row).
 */
export function buildManualEntry(input: BuildManualEntryInput): BuiltManualEntry {
  const { postingType, number, txnDate, memo, lines, sourceId } = input

  if (lines.length < 2) {
    throw new UnprocessableEntityError(
      `A journal entry needs at least two lines - one debit and one credit. This one has ${lines.length}.`,
      { postingType, number, lineCount: String(lines.length) }
    )
  }

  let totalDebit = 0
  let totalCredit = 0

  for (const [index, line] of lines.entries()) {
    const row = index + 1
    if (!line.accountCode || line.accountCode.trim().length === 0) {
      throw new UnprocessableEntityError(`Row ${row} has no account. Choose one from the chart.`, {
        postingType,
        number,
      })
    }
    if (!Number.isFinite(line.amountMinor) || !Number.isInteger(line.amountMinor)) {
      throw new UnprocessableEntityError(
        `Row ${row} (${line.accountCode}) has amount ${String(line.amountMinor)}, which is not a whole number of cents.`,
        { postingType, number, row: String(row) }
      )
    }
    if (line.amountMinor <= 0) {
      throw new UnprocessableEntityError(
        `Row ${row} (${line.accountCode}) has amount ${line.amountMinor}. An amount is always positive - the debit/credit column carries the sign.`,
        { postingType, number, row: String(row) }
      )
    }
    if (line.direction === 'debit') totalDebit += line.amountMinor
    else totalCredit += line.amountMinor
  }

  if (totalDebit !== totalCredit) {
    const difference = totalDebit - totalCredit
    const side = difference > 0 ? 'credit' : 'debit'
    throw new UnprocessableEntityError(
      `This entry does not balance: debits ${totalDebit} vs credits ${totalCredit}, off by ${Math.abs(difference)} ` +
        `(in cents). Add ${Math.abs(difference)} to the ${side} side.`,
      {
        postingType,
        number,
        totalDebit: String(totalDebit),
        totalCredit: String(totalCredit),
        difference: String(Math.abs(difference)),
      }
    )
  }

  const postingLines: GlPostingLineInput[] = lines.map((line, index) => ({
    accountCode: line.accountCode.trim(),
    direction: line.direction,
    amount: line.amountMinor,
    memo: line.memo ?? memo,
    sourceType: MANUAL_ENTRY_SOURCE_TYPE,
    sourceId,
    sortOrder: index,
  }))

  // Through `buildEntry` on purpose, not around it: the balance check, the
  // minor-unit assertion and the both-sides-zero assertion are the ledger's,
  // and a second copy of them here is the drift this module is meant to avoid.
  // Everything above only exists to name the row FIRST, in the words a person
  // typed it in.
  const entry = buildEntry({
    postingType,
    periodKey: number,
    txnDate,
    lines: postingLines,
  })

  return { entry, warnings: findWarnings(lines) }
}

/**
 * What is odd about this entry without being wrong.
 *
 * One rule today. Kept as a list because the second one is coming (an entry
 * dated far outside the period being viewed is the obvious next), and because a
 * screen rendering `warnings.map(...)` needs no change when it does.
 */
function findWarnings(lines: ManualEntryLine[]): string[] {
  const warnings: string[] = []

  const bothSides = new Set<string>()
  const debited = new Set(
    lines.filter((l) => l.direction === 'debit').map((l) => l.accountCode.trim())
  )
  for (const line of lines) {
    if (line.direction === 'credit' && debited.has(line.accountCode.trim())) {
      bothSides.add(line.accountCode.trim())
    }
  }
  if (bothSides.size > 0) {
    warnings.push(
      `${[...bothSides].join(', ')} ${bothSides.size === 1 ? 'appears' : 'appear'} on both sides of this entry. ` +
        'That is legal and sometimes right, but it nets to nothing in the account - check it is what you meant.'
    )
  }

  return warnings
}
