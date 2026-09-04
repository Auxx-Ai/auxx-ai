// packages/lib/src/postings/reports/statement-math.ts
//
// PURE. Statement arithmetic that has to be right and has to be testable with no
// database: natural-balance signing and the retained-earnings roll-forward.
// Mirrors the pure/impure split `build-month-end-inventory.ts` /
// `gather-month-end-inventory.ts` already use - an arithmetic failure here is a
// bug, so this throws `AuxxError` subclasses rather than returning a `Result`,
// per `docs/lib-module-guide.md`.
//
// See `plans/bank-connection/04-reporting.md` §3 for the traps this file exists
// to encode as tests: retained earnings is not a posted balance, and a contra
// account (1190) must render as a negative asset rather than being reclassified.

import { UnprocessableEntityError } from '../../errors'
import type { GlAccountTypeValue } from '../default-chart'
import type { PostingDirection } from '../types'

/**
 * Which side of a line INCREASES each of the five statement classifications.
 *
 * Asset and expense are debit-natural; liability, equity and revenue are
 * credit-natural. This is the one fact {@link signedBalance} turns into a sign,
 * and it is declared here rather than derived, for the same reason
 * `ROLE_ACCOUNT_TYPES` in `build-entry.ts` is declared rather than derived: a
 * table that could disagree with the chart is exactly the check this file
 * exists to run.
 */
export const NATURAL_BALANCE_DIRECTION: Record<GlAccountTypeValue, PostingDirection> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
}

function assertFiniteInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new UnprocessableEntityError(
      `${label} must be an integer number of minor units, got ${String(value)}`,
      { value: String(value) }
    )
  }
}

/**
 * The natural-sign balance of one account, in minor units.
 *
 * `debitMinor` and `creditMinor` are the two SUMs a trial balance groups by
 * account code - always non-negative, never signed themselves (decision G2:
 * `direction` is the only carrier of sign). This turns that pair into ONE
 * signed number the way a statement actually reads: positive when the account
 * sits on its natural side, negative when it does not.
 *
 * 🛑 **A contra account is never reclassified here.** `1190 Allowance for
 * Doubtful Accounts` is an `ASSET` with a natural credit balance
 * (`default-chart.ts`), so a org that has ever reserved anything against it
 * gets `creditMinor > debitMinor` and this returns a NEGATIVE number - which is
 * exactly right. The chart's own comment is explicit that contra is a
 * presentation attribute, not a posting rule, and signing by the account's
 * DECLARED type rather than by whichever side happens to be bigger is what
 * keeps that true here too.
 *
 * @throws {UnprocessableEntityError} on a non-integer sum. Both sums come from
 * a `SUM(amountMinor)` over rows `GlPostingLine`'s own check constraint already
 * guarantees are positive integers, so a non-integer here is a caller bug, not a
 * runtime condition.
 */
export function signedBalance(
  debitMinor: number,
  creditMinor: number,
  accountType: GlAccountTypeValue
): number {
  assertFiniteInteger(debitMinor, 'debitMinor')
  assertFiniteInteger(creditMinor, 'creditMinor')
  const natural = NATURAL_BALANCE_DIRECTION[accountType]
  return natural === 'debit' ? debitMinor - creditMinor : creditMinor - debitMinor
}

/** One revenue or expense account's already-signed balance, as {@link netIncome} consumes it. */
export interface NetIncomeRow {
  accountType: 'revenue' | 'expense'
  /** Natural-sign balance, from {@link signedBalance} - positive under ordinary activity. */
  balanceMinor: number
}

/**
 * Net income: total revenue minus total expense, over whatever rows are handed
 * in.
 *
 * Takes ALREADY-SIGNED balances rather than raw debit/credit pairs, so this
 * file has exactly one place that turns a debit/credit pair into a sign
 * ({@link signedBalance}) and exactly one place that turns a set of signed
 * balances into a bottom line. A revenue row's signed balance is already
 * "credits minus debits", so summing revenue and subtracting expense here reads
 * the same as the income statement it is computing.
 *
 * @throws {UnprocessableEntityError} on a non-integer balance, or on a row
 * whose `accountType` is neither `revenue` nor `expense` - the P&L reader must
 * never hand this function a balance-sheet row, and a caller that did has a
 * bug this function is the one place positioned to catch.
 */
export function netIncome(rows: readonly NetIncomeRow[]): number {
  let total = 0
  for (const row of rows) {
    assertFiniteInteger(row.balanceMinor, `balanceMinor for a ${row.accountType} row`)
    if (row.accountType === 'revenue') total += row.balanceMinor
    else if (row.accountType === 'expense') total -= row.balanceMinor
    else {
      throw new UnprocessableEntityError(
        `netIncome only accepts revenue and expense rows, got accountType "${String(row.accountType)}"`,
        { accountType: String(row.accountType) }
      )
    }
  }
  return total
}

/** What {@link retainedEarnings} needs to roll the balance forward across a fiscal-year boundary. */
export interface RetainedEarningsInput {
  /**
   * Net income for every period strictly BEFORE the fiscal year containing the
   * report date - the trial balance's revenue/expense balance, cumulative from
   * the beginning of time through the day before the fiscal year started.
   */
  priorYearsNetIncome: number
  /**
   * Net income from the beginning of the CURRENT fiscal year through the
   * report date. Always added on top: nothing posts current-year P&L into
   * retained earnings until a formal year-end close does, and this pass has
   * none.
   */
  currentPeriodNetIncome: number
  /**
   * What is actually POSTED to the `equity_retained_earnings` role account for
   * periods before the fiscal year, or `null` when nothing is. A non-null value
   * means a person has already put a real number there - an opening trial
   * balance entry, a manual sweep from opening-balance-equity, a correction.
   *
   * 🛑 **It decides the LABEL, never the arithmetic.** It is reported back as
   * {@link RetainedEarnings.postedPriorYearsMinor} and as
   * {@link RetainedEarnings.priorYearsSource}, and it is NOT a substitute for
   * `priorYearsNetIncome`: the posted number is already inside the equity
   * section's own account rows, and the unclosed prior-year P&L is not. See
   * {@link retainedEarnings} for why both are added.
   */
  postedRetainedEarningsBalance: number | null
}

/** The retained-earnings figure a balance sheet renders, and how it was built. */
export interface RetainedEarnings {
  /**
   * `postedPriorYearsMinor + priorYearsMinor + currentPeriodMinor` - the whole
   * retained-earnings story: what a person put in the account, plus every
   * period's net income that no year-end close has ever swept into it.
   */
  balanceMinor: number
  /**
   * Whether a person has already put a prior-years number in the role account.
   * 🛑 **A display label only.** It selects which caption the equity section
   * shows; it selects nothing in the arithmetic. See {@link retainedEarnings}.
   */
  priorYearsSource: 'posted' | 'rolled_forward'
  /**
   * Prior-period net income that is NOT posted anywhere - the roll-forward.
   *
   * 🛑 This is what the balance sheet must ADD to its posted equity rows, in
   * both `priorYearsSource` branches. It is `priorYearsNetIncome` verbatim.
   */
  priorYearsMinor: number
  /**
   * What the `equity_retained_earnings` role account already carries for prior
   * years, or `0`. 🛑 **Already inside the balance sheet's equity account
   * rows** - reported here for the caption, never added to the total a second
   * time.
   */
  postedPriorYearsMinor: number
  currentPeriodMinor: number
}

/**
 * The retained-earnings roll-forward. 🛑 **This is the single most common way a
 * first balance sheet is wrong** (`04-reporting.md` §2): nothing posts to
 * retained earnings during the year, so a balance sheet that reads the role
 * account's own posted balance and stops there is missing the current period's
 * entire net income, and it will not balance - and it will look like a ledger
 * bug rather than a report bug.
 *
 * The fix is this function: retained earnings is *prior-period retained
 * earnings plus current-period net income*, computed, never merely read.
 *
 * ## 🛑 The three figures are DISJOINT, and all three are added
 *
 * `postedRetainedEarningsBalance` used to SUPPRESS `priorYearsNetIncome`, on
 * the reasoning that a posted retained-earnings balance already embodies the
 * prior years' result. That is only true after a year-end close, and **this
 * pass has no year-end close** - nothing ever debits revenue and credits
 * retained earnings. So the two are different money:
 *
 * - `postedPriorYearsMinor` is a number a person put in the account. It is
 *   already inside the balance sheet's own equity rows, so the reader must not
 *   add it again.
 * - `priorYearsMinor` is prior-period revenue minus expense that sits, unclosed,
 *   in the P&L accounts. Nothing on the balance sheet carries it, so the reader
 *   must add it - in BOTH branches.
 * - `currentPeriodMinor` is the same thing for the current fiscal year.
 *
 * Suppressing the middle one made the sheet miss exactly one year's net income
 * from an org's second fiscal year onward, because
 * `assets = liabilities + equity(as posted) + net income(all time)` is
 * `Σdebit = Σcredit` rearranged and therefore holds unconditionally. After a
 * real year-end close lands, the swept accounts read zero cumulatively and
 * `priorYearsMinor` becomes 0 on its own - so adding it stays correct then too.
 *
 * @throws {UnprocessableEntityError} on a non-integer minor-unit input.
 */
export function retainedEarnings(input: RetainedEarningsInput): RetainedEarnings {
  assertFiniteInteger(input.priorYearsNetIncome, 'priorYearsNetIncome')
  assertFiniteInteger(input.currentPeriodNetIncome, 'currentPeriodNetIncome')
  if (input.postedRetainedEarningsBalance !== null) {
    assertFiniteInteger(input.postedRetainedEarningsBalance, 'postedRetainedEarningsBalance')
  }

  const priorYearsSource: RetainedEarnings['priorYearsSource'] =
    input.postedRetainedEarningsBalance !== null ? 'posted' : 'rolled_forward'
  const postedPriorYearsMinor = input.postedRetainedEarningsBalance ?? 0

  return {
    balanceMinor: postedPriorYearsMinor + input.priorYearsNetIncome + input.currentPeriodNetIncome,
    priorYearsSource,
    priorYearsMinor: input.priorYearsNetIncome,
    postedPriorYearsMinor,
    currentPeriodMinor: input.currentPeriodNetIncome,
  }
}
