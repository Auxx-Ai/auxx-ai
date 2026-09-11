// apps/web/src/components/accounting/ui/reports/statement-table.tsx

'use client'

import type { RecordId } from '@auxx/types/resource'
import { Alert } from '@auxx/ui/components/alert'
import { CurrencyInput, CurrencyInputField } from '@auxx/ui/components/input-currency'
import { InputGroup } from '@auxx/ui/components/input-group'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, Landmark, Search, TriangleAlert } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { AccountLabel } from '../account-label'
import { accountMatchesSearch } from '../account-label-format'
import { EMPTY_CELL, formatMinor, formatSignedMinor } from '../ledger/format'
import { accountTypeIcon } from '../settings/accounts-types'

/**
 * `StatementTable`, the one primitive every accounting report, the opening
 * trial balance, aging and the 1099/depreciation summaries render through
 * (`plans/accounting/ui-plan.md` §4.1).
 *
 * 🛑 NOT a `<table>` any more. It is the framed `TreeRow` list every other
 * list in the app is - the chart of accounts (`chart-list.tsx`), opening stock
 * (`opening-stock-list.tsx`), the bank review queue - because a statement that
 * renders as shadcn's bare `<Table>` sits in the same page as three of those
 * and reads as a different product. One bordered frame, a sticky header, rows
 * that carry their own fill, and the money in `TreeRow`'s `actions` slot.
 *
 * The row MODEL did not change. `packages/lib/src/postings/reports/rows.ts`
 * builds it and `pdf/statement-parts.tsx` renders the same rows through
 * react-pdf with its own, deliberately different, look.
 */

/** One row of a statement. */
export interface StatementRow {
  id: string
  label: string
  depth: 0 | 1 | 2
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
}

/** The `entry-journal.tsx`-style verdict strip under the table. */
export interface StatementVerdict {
  label: string
  ok: boolean
  detail?: string
}

export interface StatementTableProps {
  columns: StatementColumn[]
  rows: StatementRow[]
  currency: string
  /** `'edit'` renders a `CurrencyInput` in every editable value cell. Default `'read'`. */
  mode?: 'read' | 'edit'
  onCellChange?: (rowId: string, colKey: string, minor: number | null) => void
  onRowClick?: (row: StatementRow) => void
  verdict?: StatementVerdict
  /**
   * Turns the `Account` header into a search field. Off by default: six rows of
   * 1099 do not need one, and aging's rows are contacts rather than accounts.
   */
  searchable?: boolean
  /** Placeholder/label for the first column. Default `Account`. */
  labelHeading?: string
  /**
   * Open every section on mount. The reports open collapsed (a statement you
   * drill into); a data-entry grid must not, or every input is hidden.
   */
  expandAllByDefault?: boolean
  className?: string
  /**
   * Extra classes on EVERY row's line, appended after {@link ROW_KIND_CLASS}.
   *
   * For a consumer that needs a different row SHAPE, not different content -
   * `entry-journal.tsx` uses it to wrap the `secondary` slot onto a second line,
   * because a journal line's memo is identifying text rather than a badge and
   * cannot share one line with the account name in a docked drawer.
   *
   * 🛑 Not a styling hook for colours or spacing. The `kind` classes ARE the
   * information design of a statement (section > line > subtotal > total) and a
   * consumer overriding them makes a balance sheet unreadable.
   */
  rowClassName?: string
}

/** Only a `line` row's cells ever accept `CurrencyInput` edits or a click-through. */
const EDITABLE_KINDS: ReadonlySet<StatementRow['kind']> = new Set(['line'])

/**
 * ONE width for every money cell, used by the header and by every row.
 *
 * 🛑 Never two copies. The header is a separate element from the rows (they are
 * `TreeRow`s, not `<tr>`s in the same `<table>`), so nothing but this constant
 * keeps `Debit` over the debits - the same rule `OPENING_STOCK_COLS` enforces
 * for the parts list, expressed as a width because the money sits in a
 * right-aligned trailing cluster rather than a grid track.
 */
const VALUE_COL = 'w-32 shrink-0 px-1'

/** `LeadingIcon`'s box. A row with no icon renders none, so the label would
 *  start at a different x than a section's chevron. Every row gets one. */
const ICON_SPACER = <span className='size-4' />

const ROW_KIND_CLASS: Record<StatementRow['kind'], string> = {
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

export function StatementTable({
  columns,
  rows,
  currency,
  mode = 'read',
  onCellChange,
  onRowClick,
  verdict,
  searchable = false,
  labelHeading = 'Account',
  expandAllByDefault = false,
  className,
  rowClassName,
}: StatementTableProps) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const query = searchable ? search.trim() : ''
  const filtered = useMemo(() => filterStatementRows(rows, query), [rows, query])

  /**
   * The code track's width, measured from the WHOLE statement rather than the
   * filtered rows - a track that resized as somebody typed would slide every
   * name left and right under the cursor.
   */
  const codeWidthCh = useMemo(() => maxAccountCodeLength(rows), [rows])

  /**
   * Which parents are open.
   *
   * 🛑 Two states, not one, because the default differs per consumer and a
   * single `expanded` set cannot express "open unless closed". While a search
   * is active every parent is forced open - a filter that leaves its own
   * matches hidden behind a chevron has done nothing.
   */
  const openIds = useMemo(() => {
    if (query) return allParentIds(filtered.rows)
    if (!expandAllByDefault) return expanded
    const open = allParentIds(filtered.rows)
    for (const id of collapsed) open.delete(id)
    return open
  }, [query, filtered.rows, expandAllByDefault, expanded, collapsed])

  function toggleOpen(rowId: string) {
    if (expandAllByDefault) {
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (next.has(rowId)) next.delete(rowId)
        else next.add(rowId)
        return next
      })
      return
    }
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  return (
    <div
      className={cn('flex flex-col gap-3', className)}
      style={
        {
          /**
           * How far a row's account NAME sits from the label's left edge:
           * `AccountLabel`'s reserved `${codeWidthCh}ch` code track plus its
           * own `gap-1.5`. Published as a variable because the track is
           * MEASURED here, from the whole statement, and a consumer that wants
           * to line something else up under the name cannot recompute it
           * without duplicating `maxAccountCodeLength`.
           *
           * `0px` when no row has a code: `AccountLabel` then renders neither
           * the track nor the gap, so the name starts flush and any offset
           * would be wrong rather than merely unnecessary.
           */
          '--statement-label-indent': codeWidthCh > 0 ? `calc(${codeWidthCh}ch + 0.375rem)` : '0px',
        } as CSSProperties
      }>
      <div className='rounded-lg border border-primary-200/50 dark:border-[#1e2227]'>
        {/*
          ⚠️ `top-[var(--statement-sticky-top,0px)]` and NOT `top-0`. The reports
          scroll inside their own `ScrollArea` with the toolbar outside it, where
          0 is right; the two settings doors sit under `SettingsPage`'s pinned
          title + tab block and set the var to `var(--settings-sticky-top)`, or
          this header pins underneath that block and is invisible for the whole
          scroll (the trap `opening-stock-list.tsx` documents).
        */}
        <div className='sticky top-[var(--statement-sticky-top,0px)] z-10 flex items-center rounded-t-lg border-primary-200/50 border-b bg-primary-50 px-1 py-1.5 text-muted-foreground text-sm dark:border-[#1e2227] dark:bg-background'>
          <div className='flex min-w-0 flex-1 items-center'>
            {/* `size-7`, matching `LeadingIcon`'s box, so the heading starts at
                the same x as every row's label. */}
            <span className='size-7 shrink-0' />
            {searchable ? (
              // A header until you engage it: no ring, no fill at rest, both on
              // hover and focus. The magnifier is the only permanent hint, which
              // is what makes it discoverable without looking like a form.
              <InputSearch
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={labelHeading}
                className='h-7 border-none bg-transparent shadow-none ring-0 hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-1'
              />
            ) : (
              <span className='px-1'>{labelHeading}</span>
            )}
          </div>
          <div className='flex items-center'>
            {columns.map((column) => (
              <div key={column.key} className={cn(VALUE_COL, 'text-right')}>
                {column.label}
              </div>
            ))}
          </div>
        </div>

        <div className='flex flex-col gap-0.5 p-1'>
          {filtered.rows.length === 0 ? (
            <EmptySection
              icon={<Search className='size-5' />}
              title={query ? 'No matching accounts' : 'Nothing to show'}
              description={query ? undefined : 'This statement has no rows yet.'}
            />
          ) : (
            filtered.rows.map((row) => (
              <StatementTableRow
                key={row.id}
                row={row}
                depth={row.depth}
                codeWidthCh={codeWidthCh}
                columns={columns}
                currency={currency}
                mode={mode}
                openIds={openIds}
                onToggleOpen={toggleOpen}
                onCellChange={onCellChange}
                onRowClick={onRowClick}
                rowClassName={rowClassName}
              />
            ))
          )}
        </div>
      </div>

      {/*
        🛑 While a filter is active the subtotals, the total and the verdict are
        GONE, replaced by this count. They are computed over the whole statement,
        so beside four visible rows they state a sum of numbers that are not on
        screen - and on the opening grid the verdict would read "Balanced" over
        those four rows, which somebody could reasonably take to mean the four
        balance. A filtered statement is a lookup, not a statement.
      */}
      {query && (
        <p className='text-muted-foreground text-xs'>
          Showing {filtered.matchCount} of {filtered.totalCount} accounts. Clear the search to see
          the totals.
        </p>
      )}

      {verdict && !query && (
        <Alert variant={verdict.ok ? 'success' : 'destructive'}>
          {verdict.ok ? <CheckCircle2 /> : <TriangleAlert />}
          <span>
            {verdict.label}
            {verdict.detail ? ` ${verdict.detail}` : ''}
          </span>
        </Alert>
      )}
    </div>
  )
}

interface StatementTableRowProps {
  row: StatementRow
  /** Nesting depth, resolved by the parent. Drives the indent and the connector. */
  depth: number
  /** Characters to reserve for the code, so every name starts at the same x. */
  codeWidthCh: number
  columns: StatementColumn[]
  currency: string
  mode: 'read' | 'edit'
  openIds: ReadonlySet<string>
  onToggleOpen: (rowId: string) => void
  onCellChange?: (rowId: string, colKey: string, minor: number | null) => void
  onRowClick?: (row: StatementRow) => void
  /** Appended after the row's `kind` class. See `StatementTableProps`. */
  rowClassName?: string
}

/**
 * One row, and its children NESTED INSIDE IT.
 *
 * 🛑 `TreeRow`'s own `children`, not a flattened sibling list. The primitive
 * draws the connector line from a parent's chevron down past its rows and
 * animates the collapse (`BaseTreeRow`); a flat list of rows that merely happen
 * to be indented gets neither, and a section then reads as a heading that
 * happens to sit above some accounts rather than as one that CONTAINS them.
 */
function StatementTableRow({
  row,
  depth,
  codeWidthCh,
  columns,
  currency,
  mode,
  openIds,
  onToggleOpen,
  onCellChange,
  onRowClick,
  rowClassName,
}: StatementTableRowProps) {
  const editable = mode === 'edit' && EDITABLE_KINDS.has(row.kind)
  const clickable = !!onRowClick && row.kind !== 'section'
  const hasChildren = !!row.children && row.children.length > 0
  const isOpen = openIds.has(row.id)

  /**
   * A section shows its own totals only while CLOSED.
   *
   * Open, the closing subtotal row two inches below says the same thing, and a
   * statement that states each total twice reads as if the two might differ.
   * Closed, this figure is the entire point of collapsing.
   */
  const showValues = row.kind !== 'section' || (hasChildren && !isOpen)
  const TypeIcon = row.meta?.accountType ? accountTypeIcon(row.meta.accountType) : Landmark

  return (
    <TreeRow
      // The `secondary` slot carries a Badge (the frozen-inventory lock), and
      // TreeRow truncates that slot by default, clipping the pill's edges.
      className={TREE_SECONDARY_NOTRUNCATE}
      depth={depth}
      // The chevron is `TreeRow`'s own (`expandable` renders it after the
      // label, the mode `chart-list` uses for its account-type groups), not one
      // built here. It sits at a different x on each row because the labels
      // differ in length - the same trade the chart list already makes, and the
      // price of not re-implementing a primitive's affordance.
      expandable={hasChildren}
      icon={
        isAccountRow(row) || hasChildren ? (
          // The classification's own glyph, from the one `GL_ACCOUNT_TYPE_META`
          // table the chart list and the roles tab read too - at BOTH levels,
          // so a section and the accounts under it wear the same mark.
          //
          // `Landmark` is the fallback for a row naming no type, which is every
          // row of the aging and 1099 reports: their lines are contacts and
          // vendors, not accounts.
          <TypeIcon className='size-4 text-muted-foreground' />
        ) : (
          // A subtotal is not an account. It keeps the box so its label stays on
          // the column, and nothing in it.
          ICON_SPACER
        )
      }
      isOpen={isOpen}
      onToggleOpen={
        hasChildren ? () => onToggleOpen(row.id) : clickable ? () => onRowClick?.(row) : undefined
      }
      title={
        row.meta?.accountName ? (
          <AccountLabel
            account={{ code: row.meta.accountCode ?? null, name: row.meta.accountName }}
            codeWidthCh={codeWidthCh}
            className='min-w-0'
          />
        ) : (
          row.label
        )
      }
      secondary={row.meta?.badge}
      description={row.meta?.note}
      rowClassName={cn(ROW_KIND_CLASS[row.kind], rowClassName)}
      actions={
        <div className='flex items-center'>
          {columns.map((column, index) => {
            const minor = row.values[index] ?? null
            return (
              <div
                key={column.key}
                className={cn(VALUE_COL, 'text-right font-mono text-sm tabular-nums')}>
                {/* 🛑 An open section renders NOTHING here, not `EMPTY_CELL`.
                    An em-dash is an answer - "this row has no figure in this
                    column" - and an open section has one, two rows down on its
                    own subtotal. */}
                {!showValues ? null : editable ? (
                  <CurrencyInput
                    value={minor}
                    currencyCode={currency}
                    onValueChange={(next) =>
                      onCellChange?.(row.id, column.key, next === undefined ? null : next)
                    }>
                    <InputGroup className='h-7'>
                      <CurrencyInputField className='text-right' />
                    </InputGroup>
                  </CurrencyInput>
                ) : minor === null ? (
                  EMPTY_CELL
                ) : column.signed ? (
                  formatSignedMinor(minor, currency)
                ) : (
                  formatMinor(minor, currency)
                )}
              </div>
            )
          })}
        </div>
      }>
      {hasChildren
        ? row.children?.map((child) => (
            <StatementTableRow
              key={child.id}
              row={child}
              // The model's own depth, floored at one below its parent, so a
              // child that forgot to declare one still indents.
              depth={Math.max(child.depth, depth + 1)}
              codeWidthCh={codeWidthCh}
              columns={columns}
              currency={currency}
              mode={mode}
              openIds={openIds}
              onToggleOpen={onToggleOpen}
              onCellChange={onCellChange}
              onRowClick={onRowClick}
              rowClassName={rowClassName}
            />
          ))
        : undefined}
    </TreeRow>
  )
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
function isAccountRow(row: StatementRow): boolean {
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
