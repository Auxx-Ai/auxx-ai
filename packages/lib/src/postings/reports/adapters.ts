// packages/lib/src/postings/reports/adapters.ts
//
// `toStatementRows` adapters: turn one read's typed model into the
// `StatementRow[]` the `StatementTable` (screen) and `GroupedRowsTable` (PDF)
// both render from `rows.ts`'s shared shape. Kept separate from the reads
// themselves per the module guide's "reads in their own file" rule - these are
// pure presentation shaping, not reads.
//
// A router composes a read's typed model with its rows: `{ ...model, rows:
// toXRows(model) }`. That is what "each read returns BOTH its typed model and
// `rows: StatementRow[]`" means in practice - see `ledger-reports.ts`.

import type { BalanceSheetRow, BalanceSheetSnapshot } from './balance-sheet'
import type { ProfitAndLossRow, ProfitAndLossSnapshot } from './profit-and-loss'
import { computedRow, type StatementColumn, type StatementRow, totalRow } from './rows'
import type { TrialBalance } from './trial-balance'

/** The trial balance's own columns, in the order `toTrialBalanceRows` fills them. */
export const TRIAL_BALANCE_COLUMNS: StatementColumn[] = [
  { key: 'debit', label: 'Debit', align: 'right' },
  { key: 'credit', label: 'Credit', align: 'right' },
  { key: 'balance', label: 'Balance', align: 'right', signed: true },
]

/**
 * One `'line'` row per account code, in the trial balance's own order, plus a
 * `'total'` row. Flat rather than sectioned by `accountType`, matching the
 * read itself (`GROUP BY accountCode`, no statement grouping) - a screen that
 * wants sections filters by `accountType` on the underlying `TrialBalance`
 * rather than on this shape.
 */
export function toTrialBalanceRows(tb: TrialBalance): StatementRow[] {
  const lines: StatementRow[] = tb.rows.map((row) => ({
    id: row.accountCode,
    label: row.inChart ? `${row.accountCode} ${row.accountName}` : `${row.accountCode}`,
    depth: 0,
    kind: 'line',
    values: [row.debitMinor, row.creditMinor, row.balanceMinor],
    meta: {
      accountCode: row.accountCode,
      note: row.inChart
        ? undefined
        : 'This code has posted lines but is not in the current chart of accounts.',
    },
  }))

  return [...lines, totalRow('total', 'Total', [tb.totalDebitMinor, tb.totalCreditMinor, null])]
}

/** The balance sheet's own columns - one value column, or two when a compare snapshot is present. */
export function balanceSheetColumns(bs: {
  asOf: string
  compare?: { asOf: string } | null
}): StatementColumn[] {
  const columns: StatementColumn[] = [
    { key: 'primary', label: bs.asOf, align: 'right', signed: true },
  ]
  if (bs.compare)
    columns.push({ key: 'compare', label: bs.compare.asOf, align: 'right', signed: true })
  return columns
}

function findCompare(
  rows: readonly { accountCode: string; balanceMinor: number }[],
  code: string
): number | null {
  return rows.find((row) => row.accountCode === code)?.balanceMinor ?? null
}

/**
 * The balance sheet as `StatementRow[]`: Assets, Liabilities, Equity sections,
 * each account a line, a subtotal per section, the two computed
 * retained-earnings rows inside Equity (per {@link BalanceSheetSnapshot.retainedEarnings}),
 * and a final "Total liabilities and equity" total row for the verdict strip
 * to compare against Assets' own subtotal.
 */
export function toBalanceSheetRows(
  bs: BalanceSheetSnapshot,
  compare?: BalanceSheetSnapshot | null
): StatementRow[] {
  const two = (
    value: number,
    rows: readonly { accountCode: string; balanceMinor: number }[],
    code: string
  ) => (compare ? [value, findCompare(rows, code)] : [value])

  const section = (
    id: string,
    label: string,
    rows: readonly BalanceSheetRow[],
    compareRows: readonly BalanceSheetRow[],
    totalLabel: string,
    totalValue: number,
    compareTotal: number | undefined,
    extraChildren: StatementRow[] = []
  ): StatementRow => {
    const children: StatementRow[] = rows.map((row) => ({
      id: row.accountCode,
      label: row.inChart ? `${row.accountCode} ${row.accountName}` : row.accountCode,
      depth: 1,
      kind: 'line',
      values: two(row.balanceMinor, compareRows, row.accountCode),
      meta: {
        accountCode: row.accountCode,
        note: row.inChart
          ? undefined
          : 'This code has posted lines but is not in the current chart of accounts.',
      },
    }))
    children.push(...extraChildren)
    children.push({
      id: `${id}:total`,
      label: totalLabel,
      depth: 1,
      kind: 'total',
      values: compare ? [totalValue, compareTotal ?? null] : [totalValue],
    })
    return {
      id,
      label,
      depth: 0,
      kind: 'section',
      values: compare ? [totalValue, compareTotal ?? null] : [totalValue],
      children,
    }
  }

  const equityExtra: StatementRow[] = [
    computedRow(
      're-current',
      'Retained earnings (current period)',
      compare
        ? [bs.retainedEarnings.currentPeriodMinor, compare.retainedEarnings.currentPeriodMinor]
        : [bs.retainedEarnings.currentPeriodMinor],
      'Computed from the P&L, not a posted balance.'
    ),
  ]
  // 🛑 Rendered whenever it is non-zero, NOT only in the `rolled_forward`
  // branch. `priorYearsMinor` is prior-period net income that no year-end close
  // has swept anywhere, so `totalEquityMinor` adds it in both branches - and a
  // section whose children omit a figure its own subtotal includes does not add
  // up on screen. `postedPriorYearsMinor` is the one that stays out: it is
  // already one of the equity ACCOUNT rows above.
  const priorYearsShown =
    bs.retainedEarnings.priorYearsMinor !== 0 ||
    (compare?.retainedEarnings.priorYearsMinor ?? 0) !== 0
  if (priorYearsShown) {
    equityExtra.push(
      computedRow(
        're-prior',
        'Retained earnings (prior years)',
        compare
          ? [bs.retainedEarnings.priorYearsMinor, compare.retainedEarnings.priorYearsMinor]
          : [bs.retainedEarnings.priorYearsMinor],
        'Computed from prior-period activity, not a posted balance.'
      )
    )
  }

  const assets = section(
    'assets',
    'Assets',
    bs.assets,
    compare?.assets ?? [],
    'Total assets',
    bs.totalAssetsMinor,
    compare?.totalAssetsMinor
  )
  const liabilities = section(
    'liabilities',
    'Liabilities',
    bs.liabilities,
    compare?.liabilities ?? [],
    'Total liabilities',
    bs.totalLiabilitiesMinor,
    compare?.totalLiabilitiesMinor
  )
  const equity = section(
    'equity',
    'Equity',
    bs.equity,
    compare?.equity ?? [],
    'Total equity',
    bs.totalEquityMinor,
    compare?.totalEquityMinor,
    equityExtra
  )

  const totalLiabEquity = totalRow(
    'total-liabilities-equity',
    'Total liabilities and equity',
    compare
      ? [
          bs.totalLiabilitiesMinor + bs.totalEquityMinor,
          compare.totalLiabilitiesMinor + compare.totalEquityMinor,
        ]
      : [bs.totalLiabilitiesMinor + bs.totalEquityMinor]
  )

  return [assets, liabilities, equity, totalLiabEquity]
}

/**
 * The P&L as `StatementRow[]`: Revenue, Cost of goods sold (5xxx expense),
 * gross profit, Operating expenses, net income.
 */
export function toProfitAndLossRows(
  pl: ProfitAndLossSnapshot,
  compare?: ProfitAndLossSnapshot | null
): StatementRow[] {
  const two = (
    value: number,
    rows: readonly { accountCode: string; balanceMinor: number }[],
    code: string
  ) => (compare ? [value, findCompare(rows, code)] : [value])

  const lines = (
    rows: readonly ProfitAndLossRow[],
    compareRows: readonly ProfitAndLossRow[]
  ): StatementRow[] =>
    rows.map((row) => ({
      id: row.accountCode,
      label: row.inChart ? `${row.accountCode} ${row.accountName}` : row.accountCode,
      depth: 1,
      kind: 'line' as const,
      values: two(row.balanceMinor, compareRows, row.accountCode),
      meta: {
        accountCode: row.accountCode,
        note: row.inChart
          ? undefined
          : 'This code has posted lines but is not in the current chart of accounts.',
      },
    }))

  const revenueSection: StatementRow = {
    id: 'revenue',
    label: 'Revenue',
    depth: 0,
    kind: 'section',
    values: compare ? [pl.totalRevenueMinor, compare.totalRevenueMinor] : [pl.totalRevenueMinor],
    children: [
      ...lines(pl.revenue, compare?.revenue ?? []),
      totalRow(
        'revenue:total',
        'Total revenue',
        compare ? [pl.totalRevenueMinor, compare.totalRevenueMinor] : [pl.totalRevenueMinor]
      ),
    ],
  }

  const cogsSection: StatementRow = {
    id: 'cogs',
    label: 'Cost of goods sold',
    depth: 0,
    kind: 'section',
    values: compare ? [pl.totalCogsMinor, compare.totalCogsMinor] : [pl.totalCogsMinor],
    children: [
      ...lines(pl.cogs, compare?.cogs ?? []),
      {
        id: 'cogs:total',
        label: 'Total cost of goods sold',
        depth: 1,
        kind: 'subtotal',
        values: compare ? [pl.totalCogsMinor, compare.totalCogsMinor] : [pl.totalCogsMinor],
      },
    ],
  }

  const grossProfit = computedRow(
    'gross-profit',
    'Gross profit',
    compare ? [pl.grossProfitMinor, compare.grossProfitMinor] : [pl.grossProfitMinor]
  )

  const opexSection: StatementRow = {
    id: 'operating-expenses',
    label: 'Operating expenses',
    depth: 0,
    kind: 'section',
    values: compare
      ? [pl.totalOperatingExpensesMinor, compare.totalOperatingExpensesMinor]
      : [pl.totalOperatingExpensesMinor],
    children: [
      ...lines(pl.operatingExpenses, compare?.operatingExpenses ?? []),
      totalRow(
        'operating-expenses:total',
        'Total operating expenses',
        compare
          ? [pl.totalOperatingExpensesMinor, compare.totalOperatingExpensesMinor]
          : [pl.totalOperatingExpensesMinor]
      ),
    ],
  }

  const netIncome = totalRow(
    'net-income',
    'Net income',
    compare ? [pl.netIncomeMinor, compare.netIncomeMinor] : [pl.netIncomeMinor]
  )

  return [revenueSection, cogsSection, grossProfit, opexSection, netIncome]
}
