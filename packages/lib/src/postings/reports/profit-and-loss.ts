// packages/lib/src/postings/reports/profit-and-loss.ts
//
// The profit and loss statement: the trial balance filtered to revenue and
// expense, over a period (not cumulative). Net income here is the same figure
// `balance-sheet.ts`'s `currentPeriodNetIncome` computes for the same range -
// see `__tests__/profit-and-loss.test.ts` for the cross-check.
//
// COGS PRESENTATION. `GlAccountType` collapses "Cost of Goods Sold" into
// `expense` (`default-chart.ts` §2) - there is no COGS classification on the
// row. So grouping 5xxx-coded expense accounts under a "Cost of goods sold"
// subsection here is a PRESENTATION heuristic over the account CODE, not a
// posting rule and not a chart attribute: an org that renumbers a COGS account
// out of the 5xxx range changes which section it prints under, and that is the
// accepted cost of not adding a chart-level COGS flag for a v1 report.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { netIncome } from './statement-math'
import { readTrialBalance, type TrialBalanceRow } from './trial-balance'

const logger = createScopedLogger('postings:reports:profit-and-loss')

/** One revenue or expense account's activity over the requested period. */
export interface ProfitAndLossRow {
  accountCode: string
  accountName: string
  accountType: 'revenue' | 'expense'
  balanceMinor: number
  inChart: boolean
}

export interface ProfitAndLossSnapshot {
  from: string
  to: string
  revenue: ProfitAndLossRow[]
  totalRevenueMinor: number
  /** Expense rows whose code starts with `'5'` - the COGS presentation grouping. */
  cogs: ProfitAndLossRow[]
  totalCogsMinor: number
  /** `totalRevenueMinor - totalCogsMinor`. */
  grossProfitMinor: number
  /** Expense rows NOT coded `5xxx`. */
  operatingExpenses: ProfitAndLossRow[]
  totalOperatingExpensesMinor: number
  /** `totalCogsMinor + totalOperatingExpensesMinor`. */
  totalExpenseMinor: number
  /** `totalRevenueMinor - totalExpenseMinor`, equivalently `grossProfitMinor - totalOperatingExpensesMinor`. */
  netIncomeMinor: number
}

export interface ProfitAndLoss extends ProfitAndLossSnapshot {
  organizationId: string
  compare: ProfitAndLossSnapshot | null
}

export interface ReadProfitAndLossOptions {
  organizationId: string
  /** `YYYY-MM-DD`. */
  from: string
  /** `YYYY-MM-DD`, inclusive. */
  to: string
  compare?: { from: string; to: string }
}

const COGS_PREFIX = '5'

function toRow(row: TrialBalanceRow): ProfitAndLossRow {
  return {
    accountCode: row.accountCode,
    accountName: row.accountName,
    accountType: row.accountType as 'revenue' | 'expense',
    balanceMinor: row.balanceMinor,
    inChart: row.inChart,
  }
}

/**
 * One profit and loss statement over `[from, to]`: revenue, COGS (the 5xxx
 * subsection of expense), gross profit, operating expense, net income.
 */
export async function readProfitAndLoss(
  db: Database,
  options: ReadProfitAndLossOptions
): Promise<Result<ProfitAndLoss, Error>> {
  const { organizationId, from, to, compare } = options

  try {
    const primary = await computeSnapshot(db, organizationId, from, to)
    if (primary.isErr()) return err(primary.error)

    let compareSnapshot: ProfitAndLossSnapshot | null = null
    if (compare) {
      const compared = await computeSnapshot(db, organizationId, compare.from, compare.to)
      if (compared.isErr()) return err(compared.error)
      compareSnapshot = compared.value
    }

    return ok({ organizationId, ...primary.value, compare: compareSnapshot })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to read the profit and loss statement', {
      error,
      organizationId,
      from,
      to,
    })
    return err(new AuxxError('Internal error'))
  }
}

async function computeSnapshot(
  db: Database,
  organizationId: string,
  from: string,
  to: string
): Promise<Result<ProfitAndLossSnapshot, Error>> {
  const tb = await readTrialBalance(db, { organizationId, from, to })
  if (tb.isErr()) return err(tb.error)

  const revenue = tb.value.rows.filter((row) => row.accountType === 'revenue').map(toRow)
  const expense = tb.value.rows.filter((row) => row.accountType === 'expense').map(toRow)
  const cogs = expense.filter((row) => row.accountCode.startsWith(COGS_PREFIX))
  const operatingExpenses = expense.filter((row) => !row.accountCode.startsWith(COGS_PREFIX))

  const totalRevenueMinor = revenue.reduce((sum, row) => sum + row.balanceMinor, 0)
  const totalCogsMinor = cogs.reduce((sum, row) => sum + row.balanceMinor, 0)
  const totalOperatingExpensesMinor = operatingExpenses.reduce(
    (sum, row) => sum + row.balanceMinor,
    0
  )
  const totalExpenseMinor = totalCogsMinor + totalOperatingExpensesMinor

  const netIncomeMinor = netIncome([...revenue, ...expense])

  return ok({
    from,
    to,
    revenue,
    totalRevenueMinor,
    cogs,
    totalCogsMinor,
    grossProfitMinor: totalRevenueMinor - totalCogsMinor,
    operatingExpenses,
    totalOperatingExpensesMinor,
    totalExpenseMinor,
    netIncomeMinor,
  })
}
