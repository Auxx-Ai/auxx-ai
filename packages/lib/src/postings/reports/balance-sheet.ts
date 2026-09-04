// packages/lib/src/postings/reports/balance-sheet.ts
//
// The balance sheet: the trial balance filtered to asset/liability/equity,
// cumulative from the beginning of time to `asOf`, with the retained-earnings
// roll-forward folded in - see `statement-math.ts` for why that roll-forward
// cannot be a posted balance.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import { loadRoleAccountCodes } from '../resolve-roles'
import { listChartAccounts } from '../role-map'
import type { ChartAccountRow } from '../types'
import { fiscalYearStart, previousCalendarDay } from './fiscal-year'
import { netIncome, type RetainedEarnings, retainedEarnings } from './statement-math'
import { readTrialBalance, type TrialBalanceRow } from './trial-balance'

const logger = createScopedLogger('postings:reports:balance-sheet')

/** One balance-sheet account line - a `TrialBalanceRow` narrowed to the three balance-sheet types. */
export interface BalanceSheetRow {
  accountCode: string
  accountName: string
  accountType: 'asset' | 'liability' | 'equity'
  balanceMinor: number
  inChart: boolean
}

/** One point-in-time balance sheet. `readBalanceSheet` returns one or two of these (primary + compare). */
export interface BalanceSheetSnapshot {
  asOf: string
  assets: BalanceSheetRow[]
  liabilities: BalanceSheetRow[]
  /**
   * Every live equity account's own posted balance, AS POSTED - the
   * `equity_retained_earnings` role account's row is included here unchanged
   * when it carries one. The two computed retained-earnings figures below are
   * ADDITIONAL to this list, never a replacement for it.
   */
  equity: BalanceSheetRow[]
  totalAssetsMinor: number
  totalLiabilitiesMinor: number
  /**
   * `sum(equity) + retainedEarnings.priorYearsMinor + retainedEarnings.currentPeriodMinor`.
   *
   * Both computed figures, unconditionally - `postedPriorYearsMinor` is the one
   * that is NOT added, because it is already one of the `equity` rows above.
   */
  totalEquityMinor: number
  retainedEarnings: RetainedEarnings & {
    /** The role's account code, or `null` when `equity_retained_earnings` is unmapped. */
    accountCode: string | null
  }
  /** `totalAssetsMinor === totalLiabilitiesMinor + totalEquityMinor`. */
  verdict: boolean
}

export interface BalanceSheet extends BalanceSheetSnapshot {
  organizationId: string
  /** The second snapshot, when `compareAsOf` was given. */
  compare: BalanceSheetSnapshot | null
}

export interface ReadBalanceSheetOptions {
  organizationId: string
  /** `YYYY-MM-DD`. */
  asOf: string
  /** `YYYY-MM-DD`. Renders a second, independent snapshot for comparison. */
  compareAsOf?: string
}

function toBalanceSheetRow(row: TrialBalanceRow): BalanceSheetRow {
  // Only ever called on a row whose accountType is already known to be one of
  // the three balance-sheet types - see the filter above every call site.
  return {
    accountCode: row.accountCode,
    accountName: row.accountName,
    accountType: row.accountType as BalanceSheetRow['accountType'],
    balanceMinor: row.balanceMinor,
    inChart: row.inChart,
  }
}

/**
 * One balance sheet as of `asOf`: assets, liabilities and equity, cumulative
 * from the beginning of time, plus the computed retained-earnings
 * roll-forward.
 *
 * ## How the roll-forward folds into the section without double-counting
 *
 * Three trial-balance reads, all cumulative-from-the-beginning bounds:
 *
 * 1. **`asOf`** - the primary read. Its equity rows are shown AS POSTED,
 *    `equity_retained_earnings`'s own row included unchanged.
 * 2. **the day before the fiscal year started** - two independent numbers come
 *    off this one read. Its revenue/expense balance is `priorYearsNetIncome`,
 *    the net income of everything before the fiscal year, which no year-end
 *    close has swept anywhere. Its `equity_retained_earnings` balance decides
 *    {@link RetainedEarnings.priorYearsSource} and becomes
 *    `postedPriorYearsMinor` - a CAPTION, not an alternative to the first
 *    number.
 * 3. **`asOf`, activity-only from the fiscal year start** - the current
 *    period's net income. Nothing posts current-year P&L into retained
 *    earnings mid-year (`statement-math.ts`).
 *
 * The identity this preserves: `assets = liabilities + equity accounts (as
 * posted) + all-time net income`, which is `Σdebit = Σcredit` rearranged and
 * therefore holds unconditionally. All-time net income is (2)'s P&L balance
 * plus (3)'s, so BOTH are added to the total, in both branches.
 *
 * 🛑 **`priorYearsNetIncome` used to be dropped in the `posted` branch**, on
 * the reasoning that `equity_retained_earnings`'s own row already embodied it.
 * It does not: that would require a year-end close, and this pass has none. The
 * sheet was off by exactly one fiscal year's net income from an org's second
 * year onward. See `__tests__/balance-sheet.test.ts`, which walks an org across
 * a year boundary with a posted opening retained-earnings balance and a full
 * prior year of trading.
 */
export async function readBalanceSheet(
  db: Database,
  options: ReadBalanceSheetOptions
): Promise<Result<BalanceSheet, Error>> {
  const { organizationId, asOf, compareAsOf } = options

  try {
    // Read the chart ONCE for every snapshot. Each `readTrialBalance` needs the
    // whole chart and would otherwise run `listChartAccounts` itself - three
    // times here, six with a compare, over a chart that cannot change mid-read.
    const chartResult = await listChartAccounts(db, organizationId)
    if (chartResult.isErr()) return err(chartResult.error)
    const chart = chartResult.value

    const primary = await computeSnapshot(db, organizationId, asOf, chart)
    if (primary.isErr()) return err(primary.error)

    let compare: BalanceSheetSnapshot | null = null
    if (compareAsOf) {
      const compared = await computeSnapshot(db, organizationId, compareAsOf, chart)
      if (compared.isErr()) return err(compared.error)
      compare = compared.value
    }

    return ok({ organizationId, ...primary.value, compare })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read the balance sheet', { error, organizationId, asOf, compareAsOf })
    return err(new AuxxError('Internal error'))
  }
}

async function computeSnapshot(
  db: Database,
  organizationId: string,
  asOf: string,
  chart: readonly ChartAccountRow[]
): Promise<Result<BalanceSheetSnapshot, Error>> {
  const fyStart = fiscalYearStart(asOf)
  const dayBeforeFyStart = previousCalendarDay(fyStart)

  const [asOfResult, priorYearsResult, currentFyResult, retainedEarningsAccounts] =
    await Promise.all([
      readTrialBalance(db, { organizationId, to: asOf, chart }),
      readTrialBalance(db, { organizationId, to: dayBeforeFyStart, chart }),
      readTrialBalance(db, { organizationId, from: fyStart, to: asOf, chart }),
      loadRoleAccountCodes(db, organizationId, [ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS]),
    ])
  if (asOfResult.isErr()) return err(asOfResult.error)
  if (priorYearsResult.isErr()) return err(priorYearsResult.error)
  if (currentFyResult.isErr()) return err(currentFyResult.error)

  const retainedEarningsCode =
    retainedEarningsAccounts.get(ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS)?.code ?? null

  const priorPostedRow = retainedEarningsCode
    ? priorYearsResult.value.rows.find((row) => row.accountCode === retainedEarningsCode)
    : undefined
  const postedRetainedEarningsBalance =
    priorPostedRow && priorPostedRow.balanceMinor !== 0 ? priorPostedRow.balanceMinor : null

  const priorYearsNetIncome = netIncome(
    priorYearsResult.value.rows
      .filter((row) => row.accountType === 'revenue' || row.accountType === 'expense')
      .map((row) => ({
        accountType: row.accountType as 'revenue' | 'expense',
        balanceMinor: row.balanceMinor,
      }))
  )
  const currentPeriodNetIncome = netIncome(
    currentFyResult.value.rows
      .filter((row) => row.accountType === 'revenue' || row.accountType === 'expense')
      .map((row) => ({
        accountType: row.accountType as 'revenue' | 'expense',
        balanceMinor: row.balanceMinor,
      }))
  )

  const re = retainedEarnings({
    priorYearsNetIncome,
    currentPeriodNetIncome,
    postedRetainedEarningsBalance,
  })

  const assets = asOfResult.value.rows
    .filter((row) => row.accountType === 'asset')
    .map(toBalanceSheetRow)
  const liabilities = asOfResult.value.rows
    .filter((row) => row.accountType === 'liability')
    .map(toBalanceSheetRow)
  const equity = asOfResult.value.rows
    .filter((row) => row.accountType === 'equity')
    .map(toBalanceSheetRow)

  const totalAssetsMinor = assets.reduce((sum, row) => sum + row.balanceMinor, 0)
  const totalLiabilitiesMinor = liabilities.reduce((sum, row) => sum + row.balanceMinor, 0)
  const postedEquityMinor = equity.reduce((sum, row) => sum + row.balanceMinor, 0)
  // Both computed figures, unconditionally: together they are all-time net
  // income, which no posted equity row carries while there is no year-end
  // close. `re.postedPriorYearsMinor` is deliberately NOT added - it is already
  // one of the `equity` rows summed above. See the JSDoc.
  const totalEquityMinor = postedEquityMinor + re.priorYearsMinor + re.currentPeriodMinor

  return ok({
    asOf,
    assets,
    liabilities,
    equity,
    totalAssetsMinor,
    totalLiabilitiesMinor,
    totalEquityMinor,
    retainedEarnings: { ...re, accountCode: retainedEarningsCode },
    verdict: totalAssetsMinor === totalLiabilitiesMinor + totalEquityMinor,
  })
}
