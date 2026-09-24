// packages/lib/src/accounting/reports/adapters.ts
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

import { accountLabel } from '../ledger/chart/account-label'
import {
  type AccountNode,
  accountPath,
  accountPathLabel,
  buildAccountTree,
} from '../ledger/chart/account-tree'
import type { ChartAccountRow } from '../ledger/types'
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
import type { TrialBalanceStatement } from './trial-balance-statement'

/**
 * Nest a section's flat account lines under their chart parents
 * (CHART-HIERARCHY.md §5): a parent gets its own line (its own balance, even
 * when zero), its children follow at `depth + 1`, then a `Total <parent>`
 * subtotal - own balance plus every descendant, per column - at the same
 * depth as the children. `makeLine` is whatever the caller already builds for
 * a flat line (id, label, values, meta); this only decides WHERE each line
 * sits and adds the subtotals.
 *
 * An ancestor with no row of its own in `rows` (no postings, or simply not a
 * balance-sheet/P&L account this period) still renders as a connecting line,
 * at zero, because the subtotal below it is what a reader is looking for
 * (plan §5) - built directly from the chart row rather than through
 * `makeLine`, which has nothing to call it with.
 *
 * `inChart: false` rows (deleted accounts) are never nested - there is no
 * live chart row to hang them from - and stay flat at the section's own
 * `depth`, exactly as before.
 *
 * Falls back to a flat `rows.map(makeLine)` when no chart is given, or when
 * none of `rows` has a live chart account: existing callers that do not pass
 * a chart see no change in behaviour.
 *
 * `belongs` (default: always true) gates which ancestor gets pulled in: a
 * statement like the P&L calls this once per subsection, and a parent whose
 * `belongs` disagrees with its child's section must not connect the two - the
 * child instead renders as a root at the section's own depth.
 */
export function nestAccountLines<T extends { glAccountId: string; inChart: boolean }>(
  rows: readonly T[],
  chart: readonly ChartAccountRow[] | undefined,
  depth: number,
  makeLine: (row: T) => StatementRow,
  belongs: (account: ChartAccountRow) => boolean = () => true
): StatementRow[] {
  const inChartRows = rows.filter((row) => row.inChart)
  const outOfChartLines = rows
    .filter((row) => !row.inChart)
    .map((row) => ({ ...makeLine(row), depth }))

  if (!chart || chart.length === 0 || inChartRows.length === 0) {
    return [...inChartRows.map((row) => ({ ...makeLine(row), depth })), ...outOfChartLines]
  }

  const byId = new Map(inChartRows.map((row) => [row.glAccountId, row]))

  // Every account this section needs to connect its rows to their roots - the
  // rows themselves, plus every ancestor the chart names for them, even one
  // with no row of its own - walked nearest-parent-first, and stopping at the
  // first ancestor `belongs` rejects, since an excluded link breaks the chain
  // to everything above it too.
  const neededIds = new Set(byId.keys())
  for (const id of byId.keys()) {
    const ancestors = accountPath(chart, id).slice(0, -1)
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i] as ChartAccountRow
      if (!belongs(ancestor)) break
      neededIds.add(ancestor.id)
    }
  }
  const subsetChart = chart.filter((account) => neededIds.has(account.id))
  const tree = buildAccountTree(subsetChart)

  const columnCount = Math.max(1, ...inChartRows.map((row) => makeLine(row).values.length))
  const zeroValues = (): Array<number | null> => Array.from({ length: columnCount }, () => 0)

  const lineFor = (account: ChartAccountRow): StatementRow => {
    const row = byId.get(account.id)
    if (row) return makeLine(row)
    return {
      id: account.id,
      label: accountLabel(account),
      kind: 'line',
      depth,
      values: zeroValues(),
      meta: {
        glAccountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.accountType,
      },
    }
  }

  const linesById = new Map(subsetChart.map((account) => [account.id, lineFor(account)]))

  function subtreeTotal(node: AccountNode): Array<number | null> {
    const total = [...(linesById.get(node.account.id)?.values ?? zeroValues())]
    for (const child of node.children) {
      const childTotal = subtreeTotal(child)
      for (let i = 0; i < columnCount; i++) total[i] = (total[i] ?? 0) + (childTotal[i] ?? 0)
    }
    return total
  }

  function visit(node: AccountNode, d: number): StatementRow[] {
    const ownLine = { ...(linesById.get(node.account.id) as StatementRow), depth: d }
    if (node.children.length === 0) return [ownLine]

    const childLines = node.children.flatMap((child) => visit(child, d + 1))
    const subtotal: StatementRow = {
      id: `${node.account.id}:total`,
      label: `Total ${node.account.name}`,
      kind: 'subtotal',
      depth: d + 1,
      values: subtreeTotal(node),
    }
    return [ownLine, ...childLines, subtotal]
  }

  const nested = tree.flatMap((node) => visit(node, depth))
  return [...nested, ...outOfChartLines]
}

const DELETED_ACCOUNT_NOTE =
  'This account has posted lines but has been deleted from the current chart of accounts.'
const RECEIVABLE_SPLIT_NOTE =
  'Orders and invoices in credit are shown under Liabilities as customer deposits.'
const CUSTOMER_DEPOSITS_NOTE =
  'Orders and invoices in credit in this receivable, netted per document. Not a posted balance.'

/** The computed deposits row's label. A hyphen, not a dash: the PDF font has no em dash. */
export function customerDepositsLabel(account: {
  accountCode: string | null
  accountName: string
}): string {
  const name = [account.accountCode, account.accountName].filter(Boolean).join(' ')
  return `${name || 'Accounts receivable'} - customer deposits`
}

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
 *
 * A trial balance stays flat even after CHART-HIERARCHY.md (§5): rather than
 * nesting, a sub-account's `label` is its full `accountPathLabel` (D8,
 * `Sales: 4020 Product Income`) when `chart` is given, and `meta.accountCode`/
 * `accountName` are left off so the screen renders that path text instead of
 * running it through `AccountLabel`'s code-track split - see
 * `statement-table.tsx`'s `labelNode`. A top-level account is unaffected: its
 * path IS its `accountLabel`, and the code-track rendering is unchanged.
 */
export function toTrialBalanceRows(
  tb: TrialBalance,
  chart?: readonly ChartAccountRow[]
): StatementRow[] {
  const lines: StatementRow[] = tb.rows.map((row) => {
    const nested = !!chart && row.inChart && accountPath(chart, row.glAccountId).length > 1
    const label = row.inChart
      ? chart
        ? accountPathLabel(chart, row.glAccountId) ||
          accountLabel({ code: row.accountCode, name: row.accountName })
        : accountLabel({ code: row.accountCode, name: row.accountName })
      : row.accountCode || row.accountName || row.glAccountId
    return {
      // The IDENTITY (task 15), not the code: two rows can no longer collide
      // because an account was renumbered mid-history.
      id: row.glAccountId,
      label,
      depth: 0,
      kind: 'line',
      values: [row.debitMinor, row.creditMinor, row.balanceMinor],
      meta: {
        glAccountId: row.glAccountId,
        accountCode: nested ? undefined : row.accountCode,
        accountName: nested ? undefined : row.accountName,
        // 🛑 The trial balance is FLAT - no sections, by design (see above) - so
        // the row's icon is the only thing on the screen saying which statement
        // an account belongs to. Without this every row wore the same fallback
        // glyph while the chart of accounts two clicks away grouped the same
        // accounts under five different ones. Null for an account whose type the
        // chart no longer holds, which `glAccountTypeMeta` handles.
        accountType: row.accountType ?? undefined,
        note: row.inChart ? undefined : DELETED_ACCOUNT_NOTE,
      },
    }
  })

  return [...lines, totalRow('total', 'Total', [tb.totalDebitMinor, tb.totalCreditMinor, null])]
}

/**
 * The trial balance AS A STATEMENT: {@link toTrialBalanceRows}' account lines,
 * plus the computed retained-earnings row that makes it balance once revenue
 * and expense have been reset at the fiscal year.
 *
 * The computed row is placed after the last EQUITY line rather than at the
 * bottom, so a flat type-ordered report still reads asset, liability, equity -
 * and the reader meets retained earnings where retained earnings belongs.
 */
export function toTrialBalanceStatementRows(tb: TrialBalanceStatement): StatementRow[] {
  const lines = toTrialBalanceRows(
    {
      organizationId: tb.organizationId,
      from: tb.fiscalYearStart,
      to: tb.asOf,
      rows: tb.rows,
      totalDebitMinor: tb.totalDebitMinor,
      totalCreditMinor: tb.totalCreditMinor,
      balanced: tb.balanced,
    },
    tb.chart
  ).slice(0, -1)

  // 🛑 Omitted when zero, unlike the balance sheet's `re-current`. A first-year
  // org has no prior years to roll up, and a zero row here would read as an
  // account somebody posted nothing to rather than as a boundary that has not
  // been crossed yet. QBO drops it under All Dates for the same reason (57 §2.3).
  if (tb.retainedEarnings.priorYearsMinor !== 0) {
    const label = tb.retainedEarnings.accountCode
      ? `${tb.retainedEarnings.accountCode} Retained earnings (prior years)`
      : 'Retained earnings (prior years)'
    const re = computedRow(
      're-prior',
      label,
      [
        tb.retainedEarnings.plugDebitMinor || null,
        tb.retainedEarnings.plugCreditMinor || null,
        tb.retainedEarnings.priorYearsMinor,
      ],
      'Computed from prior-period activity, not a posted balance.'
    )
    // Last equity line, or the end of the report when the chart has no equity
    // accounts at all - never the top, which is where a -1 would put it.
    let insertAt = lines.length
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]?.meta?.accountType === 'equity') {
        insertAt = i + 1
        break
      }
    }
    lines.splice(insertAt, 0, re)
  }

  // 91 D3: the receivable's balance keeps its documents in debit; those in credit move to a
  // computed liability row. Debit and credit stay as posted, so the totals do not move.
  const deposits: StatementRow[] = []
  for (const row of tb.rows) {
    const split = row.receivableSplit
    if (!split || split.depositsMinor === 0) continue
    const line = lines.find((l) => l.id === row.glAccountId)
    if (line) {
      line.values = [line.values[0] ?? null, line.values[1] ?? null, split.receivableMinor]
      line.meta = { ...line.meta, note: RECEIVABLE_SPLIT_NOTE }
    }
    deposits.push(
      computedRow(
        `customer-deposits:${row.glAccountId}`,
        customerDepositsLabel(row),
        [null, null, split.depositsMinor],
        CUSTOMER_DEPOSITS_NOTE
      )
    )
  }
  if (deposits.length > 0) {
    let insertAt = lines.length
    for (let i = lines.length - 1; i >= 0; i--) {
      const type = lines[i]?.meta?.accountType
      if (type === 'liability' || type === 'asset') {
        insertAt = i + 1
        break
      }
    }
    lines.splice(insertAt, 0, ...deposits)
  }

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
 *
 * `chart` (the same read `readBalanceSheet` already made once for every
 * snapshot) nests a sub-account under its parent within each section via
 * {@link nestAccountLines} - CHART-HIERARCHY.md §5. Omit it and every section
 * renders flat, exactly as before.
 */
export function toBalanceSheetRows(
  bs: BalanceSheetSnapshot,
  compare?: BalanceSheetSnapshot | null,
  chart?: readonly ChartAccountRow[]
): StatementRow[] {
  const two = (
    value: number,
    rows: readonly { glAccountId: string; balanceMinor: number }[],
    glAccountId: string
  ) => (compare ? [value, findCompare(rows, glAccountId)] : [value])

  // One deposits row per receivable in credit in either snapshot, matched by id.
  const depositAccounts = new Map<string, { accountCode: string | null; accountName: string }>()
  for (const row of [...bs.customerDeposits, ...(compare?.customerDeposits ?? [])])
    if (!depositAccounts.has(row.glAccountId)) depositAccounts.set(row.glAccountId, row)
  const splitAccountIds = new Set(depositAccounts.keys())
  const depositRows: StatementRow[] = [...depositAccounts].map(([glAccountId, account]) =>
    computedRow(
      `customer-deposits:${glAccountId}`,
      customerDepositsLabel(account),
      compare
        ? [
            findCompare(bs.customerDeposits, glAccountId),
            findCompare(compare.customerDeposits, glAccountId),
          ]
        : [findCompare(bs.customerDeposits, glAccountId)],
      CUSTOMER_DEPOSITS_NOTE
    )
  )

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
    const makeLine = (row: BalanceSheetRow): StatementRow => ({
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
        note: !row.inChart
          ? DELETED_ACCOUNT_NOTE
          : splitAccountIds.has(row.glAccountId)
            ? RECEIVABLE_SPLIT_NOTE
            : undefined,
      },
    })
    const children: StatementRow[] = nestAccountLines(
      rows,
      chart,
      1,
      makeLine,
      (account) => account.accountType === accountType
    )
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
    compare?.totalLiabilitiesMinor,
    depositRows
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
 *
 * `chart` nests a sub-account under its parent within each of Revenue, COGS
 * and Operating expenses via {@link nestAccountLines} - CHART-HIERARCHY.md
 * §5. Each section passes its own `belongs` predicate, which is what keeps a
 * parent split from a child by the COGS/operating-expense `subtype` boundary
 * in one section instead of rendering (and subtotalling) in both.
 */
export function toProfitAndLossRows(
  pl: ProfitAndLossSnapshot,
  compare?: ProfitAndLossSnapshot | null,
  chart?: readonly ChartAccountRow[]
): StatementRow[] {
  const two = (
    value: number,
    rows: readonly { glAccountId: string; balanceMinor: number }[],
    glAccountId: string
  ) => (compare ? [value, findCompare(rows, glAccountId)] : [value])

  const lines = (
    rows: readonly ProfitAndLossRow[],
    compareRows: readonly ProfitAndLossRow[],
    belongs: (account: ChartAccountRow) => boolean
  ): StatementRow[] =>
    nestAccountLines(
      rows,
      chart,
      1,
      (row) => ({
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
      }),
      belongs
    )

  const isCogs = (account: ChartAccountRow) =>
    account.accountType === 'expense' && account.subtype === 'cost_of_goods_sold'

  const revenueSection: StatementRow = {
    id: 'revenue',
    label: 'Revenue',
    depth: 0,
    kind: 'section',
    meta: { accountType: 'revenue' },
    values: compare ? [pl.totalRevenueMinor, compare.totalRevenueMinor] : [pl.totalRevenueMinor],
    children: [
      ...lines(pl.revenue, compare?.revenue ?? [], (account) => account.accountType === 'revenue'),
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
      ...lines(pl.cogs, compare?.cogs ?? [], isCogs),
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
      ...lines(
        pl.operatingExpenses,
        compare?.operatingExpenses ?? [],
        (account) => account.accountType === 'expense' && account.subtype !== 'cost_of_goods_sold'
      ),
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
 * The general ledger stays flat, like the trial balance (CHART-HIERARCHY.md
 * §5): a sub-account's section label is its `accountPathLabel` (D8), and
 * `meta.accountCode`/`accountName` are left off a nested account for the same
 * reason `toTrialBalanceRows` leaves them off - so the screen renders the
 * path text rather than `AccountLabel`'s code-track split.
 */
export function toGeneralLedgerRows(gl: GeneralLedger): StatementRow[] {
  const sections = gl.accounts.map((account) => {
    const nested = !!account.accountName && accountPath(gl.chart, account.glAccountId).length > 1
    const label = account.accountName
      ? accountPathLabel(gl.chart, account.glAccountId) ||
        [account.accountCode, account.accountName].filter(Boolean).join(' ')
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
        // The LINE id, not the posting's: a fulfillment batch credits sales tax
        // once per jurisdiction, so one posting owns many rows in this account.
        id: line.lineId,
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
      accountCode: nested ? undefined : account.accountCode,
      accountName: nested ? undefined : account.accountName,
      accountType: account.accountType ?? undefined,
      note: account.accountType
        ? undefined
        : 'This account has posted lines but has been deleted from the current chart of accounts.',
    }
    return section
  })

  return [...sections, totalRow('total', 'Total', [gl.totalDebitMinor, gl.totalCreditMinor, null])]
}
