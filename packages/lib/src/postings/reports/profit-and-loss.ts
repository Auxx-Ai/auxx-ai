// packages/lib/src/postings/reports/profit-and-loss.ts
//
// The profit and loss statement: the trial balance filtered to revenue and
// expense, over a period (not cumulative). Net income here is the same figure
// `balance-sheet.ts`'s `currentPeriodNetIncome` computes for the same range -
// see `__tests__/profit-and-loss.test.ts` for the cross-check.
//
// COGS PRESENTATION. Grouping expense accounts under a "Cost of goods sold"
// subsection is driven by `subtype === 'cost_of_goods_sold'`
// (`account-subtype.ts`, task 13 §3 / task 15 §5), a chart ATTRIBUTE set on
// the account itself - never a code prefix. A chart with no codes at all (an
// imported QuickBooks chart, or a person who never numbers anything) still
// gets a COGS section, and renumbering an account never moves it between
// sections. This replaced a `code.startsWith('5')` heuristic that threw on a
// null code and gave a codeless chart no COGS section at all.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import type { GlAccountSubtypeValue } from '../account-subtype'
import { netIncome } from './statement-math'
import { readTrialBalance, type TrialBalanceRow } from './trial-balance'

const logger = createScopedLogger('postings:reports:profit-and-loss')

/** One revenue or expense account's activity over the requested period. */
export interface ProfitAndLossRow {
  /** The `gl_account` `EntityInstance` id this row groups on. The IDENTITY (task 15). */
  glAccountId: string
  /**
   * The account's CURRENT code - a snapshot only when `inChart` is `false`.
   * Null when the account carries no code (task 15 §5). See `TrialBalanceRow`.
   */
  accountCode: string | null
  accountName: string
  accountType: 'revenue' | 'expense'
  /** What puts a row in the COGS subsection below - see the file header. */
  subtype: GlAccountSubtypeValue | null
  balanceMinor: number
  inChart: boolean
}

export interface ProfitAndLossSnapshot {
  from: string
  to: string
  revenue: ProfitAndLossRow[]
  totalRevenueMinor: number
  /** Expense rows whose `subtype` is `cost_of_goods_sold` - see the file header. */
  cogs: ProfitAndLossRow[]
  totalCogsMinor: number
  /** `totalRevenueMinor - totalCogsMinor`. */
  grossProfitMinor: number
  /** Expense rows whose `subtype` is NOT `cost_of_goods_sold`. */
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

function toRow(row: TrialBalanceRow): ProfitAndLossRow {
  return {
    glAccountId: row.glAccountId,
    accountCode: row.accountCode,
    accountName: row.accountName,
    accountType: row.accountType as 'revenue' | 'expense',
    subtype: row.subtype,
    balanceMinor: row.balanceMinor,
    inChart: row.inChart,
  }
}

/**
 * One profit and loss statement over `[from, to]`: revenue, COGS (the
 * `cost_of_goods_sold`-subtyped subsection of expense), gross profit,
 * operating expense, net income.
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
  // Task 15 §5: COGS is a chart ATTRIBUTE, never a code prefix - a null or
  // unnumbered code must not throw, and a `5xxx` account with no subtype set
  // is simply an ordinary operating expense.
  const cogs = expense.filter((row) => row.subtype === 'cost_of_goods_sold')
  const operatingExpenses = expense.filter((row) => row.subtype !== 'cost_of_goods_sold')

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
