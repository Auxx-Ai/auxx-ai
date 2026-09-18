// packages/lib/src/accounting/reports/trial-balance-statement.ts
//
// The trial balance AS A STATEMENT: balance-sheet accounts cumulative through
// `asOf`, revenue and expense reset at the fiscal-year boundary, and the
// difference parked in a computed retained-earnings row
// (`docs/accounting-architecture-guide.md` §12.1).
//
// 🛑 This composes `readTrialBalance`; it does not replace it. That function is
// the shared primitive five other readers compose - `readBalanceSheet` makes
// three raw calls to it, `readProfitAndLoss` one, `aging.ts` one for the A/R
// tie - so teaching IT the fiscal year would make the balance sheet apply the
// boundary twice. The split is the same one `balance-sheet.ts` already draws.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { ACCOUNT_ROLES } from '../../postings/build-entry'
import { loadRoleAccountCodes } from '../../postings/resolve-roles'
import { listChartAccounts } from '../../postings/role-map'
import { fiscalYearStart, previousCalendarDay } from './fiscal-year'
import { resolveFiscalYearStartMonth } from './fiscal-year-setting'
import { netIncome, type RetainedEarnings, retainedEarnings } from './statement-math'
import { compareTrialBalanceRows, readTrialBalance, type TrialBalanceRow } from './trial-balance'

const logger = createScopedLogger('postings:reports:trial-balance-statement')

/** The computed retained-earnings row, plus the role account's code for the label. */
export interface TrialBalanceRetainedEarnings extends RetainedEarnings {
  /** The `equity_retained_earnings` role account's current code, or null when the role is unmapped. */
  accountCode: string | null
  /** `priorYearsMinor` as a debit, when prior years lost money. Zero otherwise. */
  plugDebitMinor: number
  /** `priorYearsMinor` as a credit, when prior years made money. Zero otherwise. */
  plugCreditMinor: number
}

export interface TrialBalanceStatement {
  organizationId: string
  asOf: string
  /** The first day of the fiscal year `asOf` falls in. Revenue and expense rows start here. */
  fiscalYearStart: string
  /**
   * Balance-sheet rows cumulative through `asOf`; revenue and expense rows over
   * `[fiscalYearStart, asOf]` only. A DELETED account (`accountType: null`) stays
   * cumulative - it has no statement class left to scope it by, and dropping it
   * silently is the one thing `readTrialBalance` is careful not to do.
   */
  rows: TrialBalanceRow[]
  retainedEarnings: TrialBalanceRetainedEarnings
  /** Row debits plus `retainedEarnings.plugDebitMinor`. */
  totalDebitMinor: number
  /** Row credits plus `retainedEarnings.plugCreditMinor`. */
  totalCreditMinor: number
  /** 🛑 The verdict. Must hold, which is the whole point of the computed row. */
  balanced: boolean
}

export interface ReadTrialBalanceStatementOptions {
  organizationId: string
  /** `YYYY-MM-DD`, inclusive. A trial balance takes ONE date (task 57 §5.3). */
  asOf: string
}

const isProfitAndLoss = (accountType: string | null): boolean =>
  accountType === 'revenue' || accountType === 'expense'

/**
 * The trial balance a CPA asks for: one date, P&L accounts reset at the fiscal
 * year, retained earnings computed.
 *
 * ## Why the computed row is `priorYearsMinor` and not `balanceMinor`
 *
 * Every posting balances, so the raw read has `Σdebit = Σcredit`. Dropping the
 * pre-fiscal-year P&L lines breaks that by exactly the amount removed:
 *
 * ```
 * Σdebit_new − Σcredit_new = credits_removed − debits_removed = priorYearsNetIncome
 * ```
 *
 * so the plug is a CREDIT of prior-year net income - `priorYearsMinor` verbatim.
 *
 * 🛑 **Not `retainedEarnings().balanceMinor`**, which would double-count twice:
 * `postedPriorYearsMinor` is already on this report as the org's own posted
 * retained-earnings ACCOUNT row (the cumulative read includes it), and
 * `currentPeriodMinor` is already on it as the current-year revenue and expense
 * rows. `balance-sheet.ts` makes the identical argument about its own equity
 * section - see `adapters.ts`'s note on `re-prior`.
 */
export async function readTrialBalanceStatement(
  db: Database,
  options: ReadTrialBalanceStatementOptions
): Promise<Result<TrialBalanceStatement, Error>> {
  const { organizationId, asOf } = options

  try {
    // The chart once for all three reads, and the month once for the whole
    // statement - same reasoning as `readBalanceSheet`.
    const chartResult = await listChartAccounts(db, organizationId)
    if (chartResult.isErr()) return err(chartResult.error)
    const chart = chartResult.value

    const fyStartMonth = await resolveFiscalYearStartMonth(organizationId)
    const fyStart = fiscalYearStart(asOf, fyStartMonth)
    const dayBeforeFyStart = previousCalendarDay(fyStart)

    // The same three reads `balance-sheet.ts` makes, for the same reasons.
    const [cumulative, priorYears, currentFy, retainedEarningsAccounts] = await Promise.all([
      readTrialBalance(db, { organizationId, to: asOf, chart }),
      readTrialBalance(db, { organizationId, to: dayBeforeFyStart, chart }),
      readTrialBalance(db, { organizationId, from: fyStart, to: asOf, chart }),
      loadRoleAccountCodes(db, organizationId, [ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS]),
    ])
    if (cumulative.isErr()) return err(cumulative.error)
    if (priorYears.isErr()) return err(priorYears.error)
    if (currentFy.isErr()) return err(currentFy.error)

    // The partition. A row is in exactly one of these: `!isProfitAndLoss`
    // catches the three balance-sheet types AND a deleted account's null type.
    const rows = [
      ...cumulative.value.rows.filter((row) => !isProfitAndLoss(row.accountType)),
      ...currentFy.value.rows.filter((row) => isProfitAndLoss(row.accountType)),
    ].sort(compareTrialBalanceRows)

    const retainedEarningsAccount = retainedEarningsAccounts.get(
      ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS
    )
    // Matched by id, not by code (task 15): the role could have been repointed
    // between the two reads this function makes over one call.
    const priorPostedRow = retainedEarningsAccount?.glAccountId
      ? priorYears.value.rows.find((row) => row.glAccountId === retainedEarningsAccount.glAccountId)
      : undefined
    const postedRetainedEarningsBalance =
      priorPostedRow && priorPostedRow.balanceMinor !== 0 ? priorPostedRow.balanceMinor : null

    const re = retainedEarnings({
      priorYearsNetIncome: netIncome(toNetIncomeRows(priorYears.value.rows)),
      currentPeriodNetIncome: netIncome(toNetIncomeRows(currentFy.value.rows)),
      postedRetainedEarningsBalance,
    })

    const plugCreditMinor = Math.max(0, re.priorYearsMinor)
    const plugDebitMinor = Math.max(0, -re.priorYearsMinor)

    const totalDebitMinor = rows.reduce((sum, row) => sum + row.debitMinor, 0) + plugDebitMinor
    const totalCreditMinor = rows.reduce((sum, row) => sum + row.creditMinor, 0) + plugCreditMinor

    return ok({
      organizationId,
      asOf,
      fiscalYearStart: fyStart,
      rows,
      retainedEarnings: {
        ...re,
        accountCode: retainedEarningsAccount?.code ?? null,
        plugDebitMinor,
        plugCreditMinor,
      },
      totalDebitMinor,
      totalCreditMinor,
      balanced: totalDebitMinor === totalCreditMinor,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read the trial balance statement', { error, organizationId, asOf })
    return err(new AuxxError('Internal error'))
  }
}

/** The revenue/expense rows of one read, in the shape `netIncome` consumes. */
function toNetIncomeRows(rows: readonly TrialBalanceRow[]) {
  return rows
    .filter((row) => isProfitAndLoss(row.accountType))
    .map((row) => ({
      accountType: row.accountType as 'revenue' | 'expense',
      balanceMinor: row.balanceMinor,
    }))
}
