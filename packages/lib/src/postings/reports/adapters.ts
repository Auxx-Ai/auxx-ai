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
import type { GeneralLedger } from './general-ledger'
import type { ProfitAndLossRow, ProfitAndLossSnapshot } from './profit-and-loss'
import {
  computedRow,
  type StatementColumn,
  type StatementLineInput,
  type StatementRow,
  statementSection,
  totalRow,
} from './rows'
import type { TrialBalance } from './trial-balance'

/** The trial balance's own columns, in the order `toTrialBalanceRows` fills them. */
export const TRIAL_BALANCE_COLUMNS: StatementColumn[] = [
  { key: 'debit', label: 'Debit', align: 'right' },
  { key: 'credit', label: 'Credit', align: 'right' },
  { key: 'balance', label: 'Balance', align: 'right', signed: true },
]

/**
 * One `'line'` row per account, in the trial balance's own order, plus a
 * `'total'` row. Flat rather than sectioned by `accountType`, matching the
 * read itself (`GROUP BY glAccountId`, no statement grouping) - a screen that
 * wants sections filters by `accountType` on the underlying `TrialBalance`
 * rather than on this shape.
 */
export function toTrialBalanceRows(tb: TrialBalance): StatementRow[] {
  const lines: StatementRow[] = tb.rows.map((row) => ({
    // The IDENTITY (task 15), not the code: two rows can no longer collide
    // because an account was renumbered mid-history.
    id: row.glAccountId,
    label: row.inChart
      ? [row.accountCode, row.accountName].filter(Boolean).join(' ')
      : row.accountCode || row.accountName || row.glAccountId,
    depth: 0,
    kind: 'line',
    values: [row.debitMinor, row.creditMinor, row.balanceMinor],
    meta: {
      glAccountId: row.glAccountId,
      accountCode: row.accountCode,
      accountName: row.accountName,
      // 🛑 The trial balance is FLAT - no sections, by design (see above) - so
      // the row's icon is the only thing on the screen saying which statement
      // an account belongs to. Without this every row wore the same fallback
      // glyph while the chart of accounts two clicks away grouped the same
      // accounts under five different ones. Null for an account whose type the
      // chart no longer holds, which `glAccountTypeMeta` handles.
      accountType: row.accountType ?? undefined,
      note: row.inChart
        ? undefined
        : 'This account has posted lines but has been deleted from the current chart of accounts.',
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

/** Match the compare snapshot's row by `glAccountId` (task 15), never by code - a renumber between the two reads must not miss. */
function findCompare(
  rows: readonly { glAccountId: string; balanceMinor: number }[],
  glAccountId: string
): number | null {
  return rows.find((row) => row.glAccountId === glAccountId)?.balanceMinor ?? null
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
    rows: readonly { glAccountId: string; balanceMinor: number }[],
    glAccountId: string
  ) => (compare ? [value, findCompare(rows, glAccountId)] : [value])

  const section = (
    id: string,
    label: string,
    /** The statement classification, for the icon every row in the section draws. */
    accountType: string,
    rows: readonly BalanceSheetRow[],
    compareRows: readonly BalanceSheetRow[],
    totalLabel: string,
    totalValue: number,
    compareTotal: number | undefined,
    extraChildren: StatementRow[] = []
  ): StatementRow => {
    const children: StatementRow[] = rows.map((row) => ({
      // The IDENTITY (task 15), not the code - see `toTrialBalanceRows`.
      id: row.glAccountId,
      label: row.inChart
        ? [row.accountCode, row.accountName].filter(Boolean).join(' ')
        : row.accountCode || row.accountName || row.glAccountId,
      depth: 1,
      kind: 'line',
      values: two(row.balanceMinor, compareRows, row.glAccountId),
      meta: {
        glAccountId: row.glAccountId,
        accountCode: row.accountCode,
        accountName: row.accountName,
        accountType,
        note: row.inChart
          ? undefined
          : 'This account has posted lines but has been deleted from the current chart of accounts.',
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
      meta: { accountType },
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
    'asset',
    bs.assets,
    compare?.assets ?? [],
    'Total assets',
    bs.totalAssetsMinor,
    compare?.totalAssetsMinor
  )
  const liabilities = section(
    'liabilities',
    'Liabilities',
    'liability',
    bs.liabilities,
    compare?.liabilities ?? [],
    'Total liabilities',
    bs.totalLiabilitiesMinor,
    compare?.totalLiabilitiesMinor
  )
  const equity = section(
    'equity',
    'Equity',
    'equity',
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
    rows: readonly { glAccountId: string; balanceMinor: number }[],
    glAccountId: string
  ) => (compare ? [value, findCompare(rows, glAccountId)] : [value])

  const lines = (
    rows: readonly ProfitAndLossRow[],
    compareRows: readonly ProfitAndLossRow[]
  ): StatementRow[] =>
    rows.map((row) => ({
      // The IDENTITY (task 15), not the code - see `toTrialBalanceRows`.
      id: row.glAccountId,
      label: row.inChart
        ? [row.accountCode, row.accountName].filter(Boolean).join(' ')
        : row.accountCode || row.accountName || row.glAccountId,
      depth: 1,
      kind: 'line' as const,
      values: two(row.balanceMinor, compareRows, row.glAccountId),
      meta: {
        glAccountId: row.glAccountId,
        accountCode: row.accountCode,
        accountName: row.accountName,
        note: row.inChart
          ? undefined
          : 'This account has posted lines but has been deleted from the current chart of accounts.',
      },
    }))

  const revenueSection: StatementRow = {
    id: 'revenue',
    label: 'Revenue',
    depth: 0,
    kind: 'section',
    meta: { accountType: 'revenue' },
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
    meta: { accountType: 'expense' },
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
    meta: { accountType: 'expense' },
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

/**
 * The general ledger's own columns.
 *
 * 🛑 Three columns, not the six ("date, document, memo, debit, credit,
 * balance") a firm's printed ledger has, because **`StatementRow.values` is
 * `Array<number | null>`** - every renderer this shape feeds
 * (`StatementTable`, `GroupedRowsTable`, `toCsvRows`) formats a cell as
 * CURRENCY. There is no text column to put a date, a document number or a memo
 * in, and faking one with a number would print `$2,026.08`.
 *
 * So the three text facts ride the row instead, exactly as `toAgingRows`
 * carries a due date: the DATE and DOCUMENT NUMBER are the line's `label`, and
 * the MEMO is `meta.note`, which the table renders as the row's description and
 * `toCsvRows` folds into nothing - a CSV reader gets `2026-08-04  JNL-0002` in
 * the Label column, which is what a spreadsheet needs to sort and filter on.
 *
 * Adding real text columns is a change to `StatementRow` and to all three
 * renderers; it is not something this adapter can do on its own.
 */
export const GENERAL_LEDGER_COLUMNS: StatementColumn[] = [
  { key: 'debit', label: 'Debit', align: 'right' },
  { key: 'credit', label: 'Credit', align: 'right' },
  { key: 'balance', label: 'Balance', align: 'right', signed: true },
]

/** Where the running-balance column sits, for the two cells `statementSection` cannot compute. */
const BALANCE_COLUMN = 2

/**
 * One section per account - `statementSection`'s parent-plus-children shape -
 * with a brought-forward opening row, one line per posted line, and a closing
 * "Ending balance" row.
 *
 * 🛑 Two cells are overwritten after `statementSection` builds the section, and
 * both are the same cell: the Balance column. `statementSection` SUMS every
 * column across its lines, which is right for debit and credit and meaningless
 * for a running balance - a running balance is a POSITION at a moment, and the
 * sum of an account's positions is not a number. Both the section header and
 * its own total row therefore carry `endingBalanceMinor` instead.
 *
 * When {@link GeneralLedger.truncated} is set, a `'computed'` row goes FIRST,
 * ahead of every account, saying so in the label - so it survives into the CSV
 * and the PDF, where a `truncated: true` field on a JSON response does not
 * reach the person actually reading the ledger.
 */
export function toGeneralLedgerRows(gl: GeneralLedger): StatementRow[] {
  const sections = gl.accounts.map((account) => {
    const label = account.accountName
      ? [account.accountCode, account.accountName].filter(Boolean).join(' ')
      : (account.accountCode ?? account.glAccountId)

    const lines: StatementLineInput[] = [
      {
        id: `${account.glAccountId}:opening`,
        label: 'Opening balance',
        // Null, not zero, in Debit and Credit: the brought-forward figure is
        // not activity, and a zero here would print `$0.00` under a column the
        // section header totals.
        values: [null, null, account.openingBalanceMinor],
      },
      ...account.lines.map((line) => ({
        id: `${account.glAccountId}:${line.glPostingId}:${line.txnDate}:${line.docNumber}`,
        // The drill-down key, carried as DATA rather than left to be parsed
        // back out of `id` above. A GL line's destination is its posting.
        glPostingId: line.glPostingId,
        // The date and the document number, because there is no column for
        // either - see `GENERAL_LEDGER_COLUMNS`.
        label: `${line.txnDate}  ${line.docNumber}`,
        values: [
          line.direction === 'debit' ? line.amountMinor : null,
          line.direction === 'credit' ? line.amountMinor : null,
          line.runningBalanceMinor,
        ],
        note: line.memo ?? undefined,
      })),
    ]

    const section = statementSection(account.glAccountId, label, lines, {
      totalLabel: 'Ending balance',
    })
    section.values[BALANCE_COLUMN] = account.endingBalanceMinor
    const closing = section.children?.[section.children.length - 1]
    if (closing) closing.values[BALANCE_COLUMN] = account.endingBalanceMinor
    section.meta = {
      glAccountId: account.glAccountId,
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType ?? undefined,
      note: account.accountType
        ? undefined
        : 'This account has posted lines but has been deleted from the current chart of accounts.',
    }
    return section
  })

  const rows: StatementRow[] = []
  if (gl.truncated) {
    const shown = gl.accounts.reduce((count, account) => count + account.lines.length, 0)
    rows.push(
      computedRow(
        'truncated',
        `INCOMPLETE - stopped at ${shown.toLocaleString('en-US')} lines. This ledger does not tie to the trial balance; run a shorter date range.`,
        [null, null, null],
        'The size guard fired. Everything below is a partial ledger.'
      )
    )
  }
  rows.push(...sections)
  rows.push(totalRow('total', 'Total', [gl.totalDebitMinor, gl.totalCreditMinor, null]))
  return rows
}
