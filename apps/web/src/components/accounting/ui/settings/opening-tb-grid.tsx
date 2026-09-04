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
// 🛑 The three inventory rows are LOCKED, not merely prefilled. Their number
// comes from the `accounting.opening*` settings, which is what
// `readOpeningBaseline` hands the first close as its baseline. Two editable
// doors onto one number is how the ledger and the subledger start disagreeing,
// and the disagreement would surface as a COGS plug nobody can explain.
//
// Built on `StatementTable` (slot 1F) rather than a table of its own: it is the
// primitive every statement, the aging report and this grid render through, and
// its edit mode exists for this screen.

import type { GlAccountTypeValue, OpeningTrialBalanceRow } from '@auxx/lib/postings/client'
import { GL_ACCOUNT_TYPES } from '@auxx/lib/postings/client'
import { formatMinor } from '../ledger/format'
import type { StatementColumn, StatementRow } from '../reports/statement-table'
import { StatementTable } from '../reports/statement-table'
import { accountTypeLabel } from './accounts-types'
import { FrozenLock } from './frozen-lock'

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

/** The account code behind a `StatementTable` row id, or null for a non-account row. */
export function accountCodeFromRowId(rowId: string): string | null {
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
 *
 * A LOCKED row is never changed, whatever it is handed. The lock is the whole
 * reason the inventory numbers cannot drift from their settings.
 */
export function applyOpeningCellChange(
  rows: readonly OpeningTrialBalanceRow[],
  accountCode: string,
  column: OpeningColumnKey,
  minor: number | null
): OpeningTrialBalanceRow[] {
  return rows.map((row) => {
    if (row.accountCode !== accountCode || row.lockedByRole) return row
    return column === 'debit'
      ? { ...row, debitMinor: minor, creditMinor: null }
      : { ...row, debitMinor: null, creditMinor: minor }
  })
}

/**
 * Overlay the three locked inventory rows with the amounts the BROWSER holds.
 *
 * 🛑 Found by driving, not by a test. `ledgerOpening.get` reads the
 * `accounting.opening*` settings on the server, and every page of the wizard
 * mounts at once - so the query fires before the previous page's settings save
 * has landed, and the three locked rows arrive empty and stay empty. The verdict
 * then reads "Nothing entered yet" over a grid nobody can fix, because the rows
 * that hold the numbers are the ones that cannot be typed in.
 *
 * `useSettings` is patched synchronously by the write on the previous page
 * (`patchSettings`), so the browser's copy is the fresher of the two. Keyed by
 * ROLE rather than by account code, because `G8` says the code differs per org
 * and the server is the one that resolved which account carries which role.
 *
 * 🛑 **A browser `null` never blanks a value the server supplied**, and this is
 * the second half of the same driving session. `getSetting` answers `null` both
 * for "this org has not set it" and for "this store was hydrated before that key
 * existed" - the two are indistinguishable from here. Letting a `null` win
 * wiped the correct 100000 / 0 / 250000 the server had already resolved and put
 * the grid back to three em-dashes. So the browser wins only when it has a
 * number; otherwise the server's stands, and the next refetch settles it.
 *
 * PURE, and exported so both doors and a test can use it.
 */
export function overlayInventorySettings(
  rows: readonly OpeningTrialBalanceRow[],
  minorByRole: Readonly<Record<string, number | null>>
): OpeningTrialBalanceRow[] {
  return rows.map((row) => {
    if (!row.lockedByRole) return row
    const minor = minorByRole[row.lockedByRole]
    // `undefined` is a role this caller knows nothing about; `null` is a store
    // that may simply not have loaded the key. Neither may overwrite.
    if (minor === undefined || minor === null) return row
    // An inventory account is an asset: its opening balance is a debit.
    return { ...row, debitMinor: minor, creditMinor: null }
  })
}

/**
 * Whether the rows ON SCREEN say something different from the rows the server
 * last handed back.
 *
 * 🛑 The overlay above is applied at RENDER time and is deliberately not held
 * in state, so a locked inventory figure that moved on the panel/page above
 * left both doors' dirty flags - which only a manual cell edit sets - false.
 * The screen then showed one trial balance while the stored draft, which is
 * what `buildOpeningBalanceEntry` posts, still held the old one. Both doors
 * therefore treat a difference from `serverRows` as dirty, whether a person
 * typed it or the overlay produced it.
 *
 * PURE. Compares by account code and by both money columns; row ORDER is the
 * server's in both lists, so a positional walk is enough.
 */
export function openingRowsDifferFromServer(
  rows: readonly OpeningTrialBalanceRow[],
  serverRows: readonly OpeningTrialBalanceRow[] | undefined
): boolean {
  if (!serverRows) return false
  if (rows.length !== serverRows.length) return true
  return rows.some((row, index) => {
    const server = serverRows[index]
    return (
      !server ||
      server.accountCode !== row.accountCode ||
      (server.debitMinor ?? null) !== (row.debitMinor ?? null) ||
      (server.creditMinor ?? null) !== (row.creditMinor ?? null)
    )
  })
}

interface OpeningTbGridProps {
  rows: OpeningTrialBalanceRow[]
  currency: string
  /** After the freeze, or on a posted entry: every cell renders as a value. */
  readOnly?: boolean
  /** Why a locked inventory row cannot be typed in. Rendered in its tooltip. */
  lockReason: string
  onCellChange?: (accountCode: string, column: OpeningColumnKey, minor: number | null) => void
  /** The `entry-journal.tsx` strip: Debits / Credits / Difference. */
  verdict?: { label: string; ok: boolean; detail?: string }
}

export function OpeningTbGrid({
  rows,
  currency,
  readOnly,
  lockReason,
  onCellChange,
  verdict,
}: OpeningTbGridProps) {
  return (
    <StatementTable
      columns={COLUMNS}
      rows={toStatementRows(rows, currency, lockReason)}
      currency={currency}
      mode={readOnly ? 'read' : 'edit'}
      onCellChange={(rowId, colKey, minor) => {
        const accountCode = accountCodeFromRowId(rowId)
        if (accountCode) onCellChange?.(accountCode, colKey as OpeningColumnKey, minor)
      }}
      verdict={verdict}
    />
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
 */
function toStatementRows(
  rows: readonly OpeningTrialBalanceRow[],
  currency: string,
  lockReason: string
): StatementRow[] {
  const out: StatementRow[] = []
  let totalDebit = 0
  let totalCredit = 0

  for (const accountType of GL_ACCOUNT_TYPES) {
    const inType = rows.filter((row) => row.accountType === (accountType as GlAccountTypeValue))
    if (inType.length === 0) continue

    const labels = sectionLabels(accountType as GlAccountTypeValue)

    out.push({
      id: `section:${accountType}`,
      label: labels.heading,
      depth: 0,
      kind: 'section',
      values: [],
    })

    let sectionDebit = 0
    let sectionCredit = 0

    for (const row of inType) {
      sectionDebit += row.debitMinor ?? 0
      sectionCredit += row.creditMinor ?? 0
      out.push({
        id: `${ACCOUNT_ROW_PREFIX}${row.accountCode}`,
        label: `${row.accountCode} ${row.accountName}`,
        depth: 1,
        // 🛑 `computed`, not `line`, is what makes a locked row read-only:
        // `StatementTable`'s edit mode puts a `CurrencyInput` in a `line` and
        // nowhere else. A `disabled` prop on the input would have been a second
        // mechanism for the same fact, and the italic-muted rendering
        // `computed` already carries says "this number came from somewhere
        // else", which is exactly what is true here.
        kind: row.lockedByRole ? 'computed' : 'line',
        values: [row.debitMinor ?? null, row.creditMinor ?? null],
        meta: {
          accountCode: row.accountCode,
          ...(row.lockedByRole ? { badge: <FrozenLock reason={lockReason} /> } : {}),
          ...(row.isActive ? {} : { note: 'This account is inactive in the chart.' }),
        },
      })
    }

    totalDebit += sectionDebit
    totalCredit += sectionCredit

    out.push({
      id: `subtotal:${accountType}`,
      label: labels.subtotal,
      depth: 0,
      kind: 'subtotal',
      values: [sectionDebit, sectionCredit],
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
 * The verdict strip's copy, from the two totals.
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
  currency: string
): { label: string; ok: boolean; detail?: string } {
  if (rowCount === 0) {
    return {
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
