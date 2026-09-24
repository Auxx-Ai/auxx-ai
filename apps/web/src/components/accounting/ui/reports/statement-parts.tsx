// apps/web/src/components/accounting/ui/reports/statement-parts.tsx

'use client'

import type { RecordId } from '@auxx/types/resource'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { CheckCircle2, Landmark, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { AccountLabel } from '../account-label'
import { accountMatchesSearch } from '../account-label-format'
import { EMPTY_CELL, formatMinor, formatSignedMinor } from '../ledger/format'
import { accountTypeIcon } from '../settings/accounts-types'

// The row model, row styling, cells and verdict shared by `StatementTable` and
// `ReportGrid`, so the two render a statement row identically.

export interface StatementRow {
  id: string
  label: string
  /** Nesting level. Was `0 | 1 | 2`; a sub-account can nest past that (CHART-HIERARCHY.md §5, D4 caps the chart at 5). */
  depth: number
  kind: 'section' | 'line' | 'subtotal' | 'total' | 'computed'
  /** Minor units, one per column. `null` renders {@link EMPTY_CELL}. */
  values: (number | null)[]
  meta?: {
    /** The `gl_account` `EntityInstance` id (task 15) - the drill-down key. `accountCode` is display only. */
    glAccountId?: string
    accountCode?: string | null
    accountName?: string
    /** Statement classification - the row's icon, via `GL_ACCOUNT_TYPE_META`. */
    accountType?: string
    recordId?: RecordId
    /**
     * The `GlPosting` behind this row, when the row IS one posting's line.
     * The general ledger's drill-down key; see `rows.ts` in lib for why a
     * posting fits neither `glAccountId` nor `recordId`.
     */
    glPostingId?: string
    badge?: ReactNode
    note?: string
  }
  /** A section's lines and its closing subtotal; aging's document drill-down. */
  children?: StatementRow[]
}

export interface StatementColumn {
  key: string
  label: string
  align?: 'right'
  /** Render with `formatSignedMinor` (a delta) instead of `formatMinor`. */
  signed?: boolean
  /** Header label when the `offset` layout collapses the columns (`Dr` / `Cr`). */
  shortLabel?: string
}

/**
 * The statement's own verdict - does it tie?
 *
 * 🛑 Rendered as a MARK ON THE TOTAL ROW (a check or a warning triangle beside
 * its label, the text on hover), not as a strip under the table. The verdict is
 * an assertion ABOUT the bottom line - "these two columns are equal", "assets
 * equal liabilities plus equity" - and a banner floating below the frame made
 * every statement in the app end in a coloured box restating a row that was
 * already on screen. On the total row it is read where the figures it judges
 * are read. See {@link StatementVerdictMark}.
 *
 * `label` is the verdict; `detail` is the follow-up sentence. Both land in the
 * tooltip, so keep them short enough to read in one.
 */
export interface StatementVerdict {
  label: string
  ok: boolean
  detail?: string
}

/** `label` and `detail` as the one sentence the tooltip shows. PURE, exported for its tests. */
export function verdictText(verdict: StatementVerdict): string {
  return verdict.detail ? `${verdict.label} ${verdict.detail}` : verdict.label
}

/**
 * The row the verdict rides on: the LAST top-level `total` row, which is a
 * statement's bottom line (`Total liabilities and equity` on a balance sheet,
 * `Totals` on a journal entry, `Total` on the trial balance and aging).
 *
 * Top level only, and last: a balance sheet carries a closing subtotal inside
 * every section, and the assertion is about the figure the reader ends on.
 *
 * `undefined` when the statement has no total row at all - the provider
 * agreement is a flat list of accounts - and `StatementTable` then falls back
 * to the strip, because a verdict with nothing to attach to must not vanish.
 *
 * PURE and exported for its tests.
 */
export function verdictRowId(rows: readonly StatementRow[]): string | undefined {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    if (row?.kind === 'total') return row.id
  }
  return undefined
}

/**
 * The verdict as one icon, for a total row's label.
 *
 * The text lives in the tooltip AND in `aria-label`, so the mark is never a
 * colour-only signal: the shape differs (check vs triangle) and a screen reader
 * reads the sentence off the trigger without opening anything.
 */
export function StatementVerdictMark({ verdict }: { verdict: StatementVerdict }) {
  const text = verdictText(verdict)
  return (
    <SimpleTooltip content={text} variant={verdict.ok ? 'default' : 'destructive'}>
      <span
        aria-label={text}
        role='img'
        className='inline-flex shrink-0 cursor-default items-center align-middle'>
        {verdict.ok ? (
          // The `success` Alert's green, kept in step with it deliberately -
          // this mark replaced that Alert and reads as the same verdict.
          <CheckCircle2 className='size-4 text-green-600 dark:text-green-400' />
        ) : (
          <TriangleAlert className='size-4 text-destructive' />
        )}
      </span>
    </SimpleTooltip>
  )
}

/**
 * The fallback gate: any of the three keys a statement row can be drilled on.
 *
 * ⚠️ Only right for a page whose handler acts on ALL of them. The general
 * ledger's account SECTIONS carry `glAccountId` while its handler acts on
 * `glPostingId`, so it passes its own - see {@link StatementTableProps.canRowDrill}.
 */
export function hasAnyDrillKey(row: StatementRow): boolean {
  return !!(row.meta?.glAccountId || row.meta?.glPostingId || row.meta?.recordId)
}

/**
 * ONE width for every money cell, used by the header and by every row.
 *
 * 🛑 Never two copies. The header is a separate element from the rows (they are
 * `TreeRow`s, not `<tr>`s in the same `<table>`), so nothing but this constant
 * keeps `Debit` over the debits - the same rule `OPENING_STOCK_COLS` enforces
 * for the parts list, expressed as a width because the money sits in a
 * right-aligned trailing cluster rather than a grid track.
 */
export const VALUE_COL = 'w-32 shrink-0 px-1'

/** `LeadingIcon`'s box. A row with no icon renders none, so the label would
 *  start at a different x than a section's chevron. Every row gets one. */
export const ICON_SPACER = <span className='size-4' />

export const ROW_KIND_CLASS: Record<StatementRow['kind'], string> = {
  // A heading over the rows, not one of them: no fill, no hover response.
  section: 'font-medium text-foreground hover:bg-transparent',
  line: 'bg-primary-100/50 hover:bg-primary-100',
  // Stronger than anything the chart or parts lists carry, and deliberately:
  // section > line > subtotal > total IS the information design of a statement,
  // and flattening it to match a checklist would make a balance sheet unreadable.
  subtotal:
    'mt-0.5 rounded-none border-primary-200/60 border-t bg-muted/40 font-medium text-foreground hover:bg-muted/40 dark:border-[#1e2227]',
  total:
    'mt-0.5 rounded-none border-primary-300/70 border-t-2 bg-muted/50 font-semibold text-foreground hover:bg-muted/50 dark:border-[#2a2f36]',
  computed: 'text-muted-foreground italic hover:bg-transparent',
}

/**
 * The longest account code in the statement, in characters, or 0 when no row
 * has one.
 *
 * 🛑 Measured, never assumed. Four digits is the common small-business default
 * (and what a US template chart uses), but Xero's stock chart is three, an ERP
 * runs five to eight, a French or German statutory chart is fixed at its own
 * length, and QuickBooks Online ships account numbering OFF - so a real
 * imported chart mixes lengths and blanks in one list. Hardcoding four would
 * clip a six-digit code or waste a column on a chart that has none.
 *
 * PURE and exported for its tests.
 */
export function maxAccountCodeLength(rows: readonly StatementRow[]): number {
  let longest = 0
  for (const row of rows) {
    const code = row.meta?.accountCode?.trim()
    if (code) longest = Math.max(longest, code.length)
    if (row.children) longest = Math.max(longest, maxAccountCodeLength(row.children))
  }
  return longest
}

/** Every row id that owns children, i.e. everything a chevron can open. */
export function allParentIds(rows: readonly StatementRow[]): Set<string> {
  const out = new Set<string>()
  for (const row of rows) {
    if (row.children && row.children.length > 0) out.add(row.id)
  }
  return out
}

export interface FilteredStatement {
  rows: StatementRow[]
  /** `line` rows surviving the filter. */
  matchCount: number
  /** `line` rows in the unfiltered statement. */
  totalCount: number
}

/**
 * Narrow a statement to the accounts matching `query`.
 *
 * 🛑 Every subtotal, total and computed row is DROPPED while filtering, and
 * `StatementTable` hides the verdict with them. They are sums over rows the
 * filter has hidden, so beside the survivors they are arithmetic that does not
 * check out - see the strip's own comment for why that is worse than useless
 * on the opening grid.
 *
 * Matching is `accountMatchesSearch` (code or name, the same predicate the
 * chart list uses) when the row carries an account, and a plain label match
 * otherwise, so an aging row still finds its contact.
 *
 * PURE and exported for its tests.
 */
export function filterStatementRows(
  rows: readonly StatementRow[],
  query: string
): FilteredStatement {
  const totalCount = countLines(rows)
  const needle = query.trim()
  if (!needle) return { rows: [...rows], matchCount: totalCount, totalCount }

  const out: StatementRow[] = []
  let matchCount = 0

  for (const row of rows) {
    if (row.children && row.children.length > 0) {
      const children = row.children.filter((child) => isAccountRow(child) && matches(child, needle))
      if (children.length === 0) continue
      matchCount += children.length
      out.push({ ...row, children })
      continue
    }
    if (!isAccountRow(row)) continue
    if (!matches(row, needle)) continue
    matchCount += 1
    out.push(row)
  }

  return { rows: out, matchCount, totalCount }
}

function matches(row: StatementRow, needle: string): boolean {
  if (row.meta?.accountName) {
    return accountMatchesSearch(
      { code: row.meta.accountCode ?? null, name: row.meta.accountName },
      needle
    )
  }
  return row.label.toLowerCase().includes(needle.toLowerCase())
}

/**
 * Whether a row names something a search is FOR - an account, or aging's
 * contact and its documents.
 *
 * 🛑 `computed` is the reason this is not `kind === 'line'`. The opening grid
 * marks its three locked inventory accounts `computed` so edit mode leaves them
 * alone (`opening-tb-grid.tsx`), while a P&L marks Gross profit and Net income
 * the same way. The first is an account and must survive a filter; the second
 * is a figure derived from rows the filter just hid and must not. What
 * separates them is whether the row carries an account at all.
 */
export function isAccountRow(row: StatementRow): boolean {
  if (row.kind === 'line') return true
  if (row.kind !== 'computed') return false
  return !!row.meta?.accountName || !!row.meta?.accountCode
}

function countLines(rows: readonly StatementRow[]): number {
  let count = 0
  for (const row of rows) {
    if (isAccountRow(row)) count += 1
    if (row.children) count += countLines(row.children)
  }
  return count
}

/**
 * `ROW_KIND_CLASS` for `ReportGrid`, whose row is split into a pinned label and
 * its cells: hover comes from the row's group so both halves light together.
 * Margins are left out because the grid positions rows itself. Keep in step.
 */
export const GRID_ROW_KIND_CLASS: Record<StatementRow['kind'], string> = {
  section: 'font-medium text-foreground',
  line: 'bg-primary-100/50 group-hover/rg-row:bg-primary-100',
  subtotal:
    'rounded-none border-primary-200/60 border-t bg-muted/40 font-medium text-foreground dark:border-[#1e2227]',
  total:
    'rounded-none border-primary-300/70 border-t-2 bg-muted/50 font-semibold text-foreground dark:border-[#2a2f36]',
  computed: 'text-muted-foreground italic',
}

/** The row's leading glyph: the account type's icon, `Landmark` for a typeless row, a spacer for a subtotal. */
export function StatementRowIcon({
  row,
  hasChildren,
}: {
  row: StatementRow
  hasChildren: boolean
}) {
  if (!isAccountRow(row) && !hasChildren) return ICON_SPACER
  const TypeIcon = row.meta?.accountType ? accountTypeIcon(row.meta.accountType) : Landmark
  return <TypeIcon className='size-4 text-muted-foreground' />
}

/** An `AccountLabel` for an account row, the plain label otherwise, with the verdict mark beside it. */
export function StatementRowLabel({
  row,
  codeWidthCh,
  verdictMark,
}: {
  row: StatementRow
  codeWidthCh: number
  verdictMark?: ReactNode
}) {
  const label = row.meta?.accountName ? (
    <AccountLabel
      account={{ code: row.meta.accountCode ?? null, name: row.meta.accountName }}
      codeWidthCh={codeWidthCh}
      className='min-w-0'
    />
  ) : (
    row.label
  )
  if (!verdictMark) return label
  // Inline-flex: a block child inside the truncating title would push the mark to the far edge.
  return (
    <span className='inline-flex min-w-0 items-center gap-1.5'>
      {label}
      {verdictMark}
    </span>
  )
}

/** One money cell's text. */
export function formatStatementCell(
  minor: number | null | undefined,
  column: StatementColumn,
  currency: string
): string {
  if (minor === null || minor === undefined) return EMPTY_CELL
  return column.signed ? formatSignedMinor(minor, currency) : formatMinor(minor, currency)
}

/**
 * A section shows its own totals only while closed: open, its subtotal row says
 * the same, and a statement that states each total twice reads as if they might differ.
 */
export function showsValues(row: StatementRow, hasChildren: boolean, isOpen: boolean): boolean {
  return row.kind !== 'section' || (hasChildren && !isOpen)
}
