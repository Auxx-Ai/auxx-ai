// apps/web/src/components/accounting/ui/settings/opening-tb-grid.tsx
'use client'

// The opening trial balance, as a grid over the whole chart.
//
// ONE component, TWO doors: the setup wizard's page 3b and the
// `settings/opening` twin (plans/accounting/ui-plan.md §2.2). They render the
// same rows, the same subtotals and the same verdict, because a wizard and a
// settings page that disagreed about whether the books balance is exactly the
// failure the shared `setup-readiness` predicate exists to prevent one level
// up.
//
// Built on `StatementTable` (slot 1F) rather than a table of its own: it is the
// primitive every statement, the aging report and this grid render through, and
// its edit mode exists for this screen.

import type { ChartAccountRow, GlAccountTypeValue } from '@auxx/lib/accounting/ledger/client'
import { accountDepth, GL_ACCOUNT_TYPES, sortChartTree } from '@auxx/lib/accounting/ledger/client'
import type { OpeningTrialBalanceRow } from '@auxx/lib/accounting/opening/client'
import { formatAccountLabel } from '../account-label-format'
import { formatMinor } from '../ledger/format'
import type { StatementColumn, StatementRow } from '../reports/statement-table'
import { StatementTable } from '../reports/statement-table'
import { useChartAccounts } from '../use-chart-accounts'
import { accountTypeLabel } from './accounts-types'

/** Which money column a cell belongs to. `direction` by another name. */
export type OpeningColumnKey = 'debit' | 'credit'

const COLUMNS: StatementColumn[] = [
  { key: 'debit', label: 'Debit', align: 'right' },
  { key: 'credit', label: 'Credit', align: 'right' },
]

/** Row ids are namespaced so a section and an account can never collide. */
const ACCOUNT_ROW_PREFIX = 'account:'

/**
 * The five section headings, and the noun each subtotal names.
 *
 * Spelled out rather than derived from `accountTypeLabel` with a bare `s`,
 * which is what this rendered first and which produced "Liabilitys",
 * "Equitys", "Revenues" and "Expenses" on the wizard page. `accountTypeLabel`
 * is a SINGULAR label for a badge on one account; a statement section is a
 * plural, and English does not get from one to the other by concatenation.
 */
const SECTION_LABELS: Record<string, { heading: string; subtotal: string }> = {
  asset: { heading: 'Assets', subtotal: 'Total assets' },
  liability: { heading: 'Liabilities', subtotal: 'Total liabilities' },
  equity: { heading: 'Equity', subtotal: 'Total equity' },
  revenue: { heading: 'Revenue', subtotal: 'Total revenue' },
  expense: { heading: 'Expenses', subtotal: 'Total expenses' },
}

function sectionLabels(accountType: GlAccountTypeValue) {
  return (
    SECTION_LABELS[accountType] ?? {
      heading: accountTypeLabel(accountType),
      subtotal: `Total ${accountTypeLabel(accountType).toLowerCase()}`,
    }
  )
}

/** The account id behind a `StatementTable` row id, or null for a non-account row. */
export function accountIdFromRowId(rowId: string): string | null {
  return rowId.startsWith(ACCOUNT_ROW_PREFIX) ? rowId.slice(ACCOUNT_ROW_PREFIX.length) : null
}

/**
 * Apply one cell edit to the grid's rows.
 *
 * PURE, and exported so both doors share it and so the "typing in one column
 * clears the other" rule is testable without mounting a table.
 *
 * 🛑 **Typing a debit clears the credit on that row**, exactly as the journal
 * entry drawer's two `CurrencyInput`s do. An account carrying both would be
 * representable and would post two lines that net to nothing, which
 * `buildManualEntry` can only report afterwards as a warning. Clearing is the
 * cheaper answer and it is the one a bookkeeper expects.
 */
export function applyOpeningCellChange(
  rows: readonly OpeningTrialBalanceRow[],
  accountId: string,
  column: OpeningColumnKey,
  minor: number | null
): OpeningTrialBalanceRow[] {
  return rows.map((row) => {
    if (row.accountId !== accountId) return row
    return column === 'debit'
      ? { ...row, debitMinor: minor, creditMinor: null }
      : { ...row, debitMinor: null, creditMinor: minor }
  })
}

/**
 * The evidence-rule sentence that tells a person what number belongs in the
 * grid, branched on where the grid's numbers came from
 * (plans/accounting/tasks/done/19-opening-balances-from-the-provider.md section
 * 4.8).
 *
 * 🛑 Both strings live here, not inlined at either call site. The wizard page
 * and the settings twin already share this module for exactly this reason: a
 * wizard and a settings page giving different accounting advice about the
 * same grid is worse than either string being wrong on its own.
 *
 * `'manual'` is the original, unconditional instruction - a statement balance
 * is the right evidence when nobody has typed anything yet.
 *
 * ⚠️ The `'provider'` string is honest only while `accounting.openingSource`
 * means "seeded from" rather than "equal to" - a person may have edited every
 * row since the fill ran, which is why it ends by telling them to check
 * rather than telling them they are done.
 */
export function openingEvidenceInstruction(
  source: 'manual' | 'provider' | 'none',
  cutoverDate: string
): string {
  if (source === 'none') {
    return (
      `Your books begin at ${cutoverDate} with nothing carried in, so there is no evidence to ` +
      'gather and no opening entry to post. Untick the box below if that is not right.'
    )
  }
  if (source === 'provider') {
    return (
      `These are book balances from your accounting system as of ${cutoverDate}. They already account for ` +
      'payments that had not cleared at the cutover, which a statement balance does not, so do ' +
      'not replace them with the statement figure. Check them against what you expect.'
    )
  }
  return (
    `Use the ${cutoverDate.slice(5).replace('-', '/')} statement balance for every bank and card ` +
    'account. Do not use the tax return.'
  )
}

interface OpeningTbGridProps {
  rows: OpeningTrialBalanceRow[]
  currency: string
  /** After the freeze, or on a posted entry: every cell renders as a value. */
  readOnly?: boolean
  onCellChange?: (accountId: string, column: OpeningColumnKey, minor: number | null) => void
  /** The `entry-journal.tsx` strip: Debits / Credits / Difference. */
  verdict?: { label: string; ok: boolean; detail?: string }
}

export function OpeningTbGrid({
  rows,
  currency,
  readOnly,
  onCellChange,
  verdict,
}: OpeningTbGridProps) {
  // The shared chart fetch (`AccountLabel`, `GlAccountPicker` read the same
  // query) - just for `parentId`, which `OpeningTrialBalanceRow` does not
  // carry. Empty while loading, which `withTreeOrder`/`accountDepth` both
  // degrade to "flat, unindented" for, so the grid never blocks on it.
  const { accounts } = useChartAccounts()
  return (
    <StatementTable
      columns={COLUMNS}
      rows={toStatementRows(rows, currency, accounts)}
      currency={currency}
      mode={readOnly ? 'read' : 'edit'}
      // 🛑 Open. The reports open collapsed because a statement is something you
      // drill into; this is the screen a person TYPES the trial balance on, and
      // collapsed sections would hide every input behind a chevron.
      expandAllByDefault
      searchable
      onCellChange={(rowId, colKey, minor) => {
        const accountId = accountIdFromRowId(rowId)
        if (accountId) onCellChange?.(accountId, colKey as OpeningColumnKey, minor)
      }}
      verdict={verdict}
    />
  )
}

/**
 * Reorder one type's rows into the chart's tree order (D9), a sub-account
 * following its parent rather than sitting wherever code-then-name put it.
 *
 * A row whose account is not in `chart` (still loading, or archived out from
 * under an existing opening balance) keeps its incoming position - the sort
 * is stable and an unmatched id sorts last among matched ones, which is
 * "unindented, wherever it already was" rather than a jump.
 */
function withTreeOrder(
  inType: readonly OpeningTrialBalanceRow[],
  chartOfType: readonly ChartAccountRow[]
): OpeningTrialBalanceRow[] {
  const order = new Map(sortChartTree(chartOfType).map((account, index) => [account.id, index]))
  return [...inType].sort(
    (a, b) =>
      (order.get(a.accountId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.accountId) ?? Number.MAX_SAFE_INTEGER)
  )
}

/**
 * Group the chart into statement sections, each with a subtotal, then a grand
 * total.
 *
 * The section order is `GL_ACCOUNT_TYPES` - assets, liabilities, equity,
 * revenue, expense - which is the same tuple `sortChartAccountsForStatement`
 * ordered the rows by on the server, so the grouping never has to re-sort and a
 * section can never appear twice.
 *
 * An account type with no accounts renders no section at all: a chart that has
 * been edited down to four types should not show an empty Revenue heading with
 * a zero subtotal under it.
 *
 * Within a type, rows are reordered into TREE order (`withTreeOrder`,
 * CHART-HIERARCHY.md §5) and a sub-account's row sits at
 * `depth: 1 + accountDepth(...)` - one step deeper per chart level, the same
 * indent `TreeRow` already gives a nested statement row. These rows are still
 * flat SIBLINGS in one section's `children` (no per-parent subtotal - the
 * type's own total is unchanged), so the extra depth is cosmetic only.
 */
function toStatementRows(
  rows: readonly OpeningTrialBalanceRow[],
  currency: string,
  chart: readonly ChartAccountRow[]
): StatementRow[] {
  const out: StatementRow[] = []
  let totalDebit = 0
  let totalCredit = 0

  for (const accountType of GL_ACCOUNT_TYPES) {
    const rowsOfType = rows.filter((row) => row.accountType === (accountType as GlAccountTypeValue))
    if (rowsOfType.length === 0) continue

    const chartOfType = chart.filter((account) => account.accountType === accountType)
    const inType = withTreeOrder(rowsOfType, chartOfType)

    const labels = sectionLabels(accountType as GlAccountTypeValue)

    let sectionDebit = 0
    let sectionCredit = 0
    const children: StatementRow[] = []

    for (const row of inType) {
      sectionDebit += row.debitMinor ?? 0
      sectionCredit += row.creditMinor ?? 0
      children.push({
        id: `${ACCOUNT_ROW_PREFIX}${row.accountId}`,
        label: formatAccountLabel({ code: row.accountCode, name: row.accountName }),
        depth: 1 + accountDepth(chart, row.accountId),
        kind: 'line',
        values: [row.debitMinor ?? null, row.creditMinor ?? null],
        meta: {
          accountCode: row.accountCode,
          // 🛑 `accountName` is what routes the label through `AccountLabel`
          // rather than `StatementTable`'s plain-span fallback. Without it this
          // grid printed a pre-formatted `code · name` string while the chart
          // list two tabs away rendered the same account with the code as a
          // muted prefix - one screen's accounts not looking like another's.
          accountName: row.accountName,
          accountType: row.accountType,
          ...(row.isActive ? {} : { note: 'This account is inactive in the chart.' }),
        },
      })
    }

    totalDebit += sectionDebit
    totalCredit += sectionCredit

    // The closing subtotal is a CHILD of its section, and the section carries
    // the same two figures. That is the shape lib's `statementSection`
    // (`postings/reports/rows.ts`) already builds for every report, and this
    // grid was the one consumer emitting a flat list instead - which is the
    // whole reason its sections could not be collapsed. Nested, they collapse
    // to one line showing the section's own total, exactly like a balance
    // sheet's.
    children.push({
      id: `subtotal:${accountType}`,
      label: labels.subtotal,
      depth: 1,
      kind: 'subtotal',
      values: [sectionDebit, sectionCredit],
    })

    out.push({
      id: `section:${accountType}`,
      label: labels.heading,
      depth: 0,
      kind: 'section',
      values: [sectionDebit, sectionCredit],
      meta: { accountType },
      children,
    })
  }

  if (out.length > 0) {
    out.push({
      id: 'total:trial-balance',
      label: 'Total',
      depth: 0,
      kind: 'total',
      values: [totalDebit, totalCredit],
    })
  }

  return out
}

/**
 * The verdict's copy, from the two totals.
 *
 * Rendered as a mark on the Total row - except on an EMPTY grid, which has no
 * Total row to mark, so `StatementTable` falls back to the strip. Which is the
 * right place for it: "nothing entered yet" is the one verdict here that is
 * not a remark about figures on screen.
 *
 * ⚠️ "Nothing entered" is NOT the same answer as "does not balance", and both
 * are different from "balanced". An empty grid balances trivially at zero, and
 * calling that Balanced would let somebody walk past the one page that matters
 * with an entirely blank trial balance. `resolveSetupReadiness` draws the same
 * three-way distinction, from the same numbers.
 */
export function openingVerdict(
  debitMinor: number,
  creditMinor: number,
  rowCount: number,
  currency: string,
  /** The org declared it carries no opening balances, so an empty grid is the finished answer. */
  fromNothing = false
): { label: string; ok: boolean; detail?: string } {
  if (rowCount === 0) {
    return fromNothing
      ? {
          label: 'Nothing to carry in.',
          ok: true,
          detail: 'These books start from nothing, so no opening entry will be posted.',
        }
      : {
          label: 'Nothing entered yet.',
          ok: false,
          detail: 'Enter what each account was worth on the cutover date.',
        }
  }
  const difference = debitMinor - creditMinor
  if (difference === 0) {
    return {
      label: 'Balanced.',
      ok: true,
      detail: `Debits ${formatMinor(debitMinor, currency)} equal credits.`,
    }
  }
  return {
    label: `Out of balance by ${formatMinor(Math.abs(difference), currency)}.`,
    ok: false,
    detail:
      `Debits ${formatMinor(debitMinor, currency)}, credits ${formatMinor(creditMinor, currency)}. ` +
      'Find the missing balance - never add a plug account to make it agree.',
  }
}
