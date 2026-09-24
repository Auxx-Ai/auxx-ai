// apps/web/src/components/accounting/ui/reports/statement-table.tsx

'use client'

import { Alert } from '@auxx/ui/components/alert'
import { CurrencyInput, CurrencyInputField } from '@auxx/ui/components/input-currency'
import { InputGroup } from '@auxx/ui/components/input-group'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, Search, TriangleAlert } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import {
  allParentIds,
  filterStatementRows,
  formatStatementCell,
  hasAnyDrillKey,
  maxAccountCodeLength,
  ROW_KIND_CLASS,
  type StatementColumn,
  type StatementRow,
  StatementRowIcon,
  StatementRowLabel,
  type StatementVerdict,
  StatementVerdictMark,
  showsValues,
  VALUE_COL,
  verdictRowId,
  verdictText,
} from './statement-parts'

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
 * The row MODEL did not change. `packages/lib/src/accounting/reports/rows.ts`
 * builds it and `pdf/statement-parts.tsx` renders the same rows through
 * react-pdf with its own, deliberately different, look.
 */

export interface StatementTableProps {
  columns: StatementColumn[]
  rows: StatementRow[]
  currency: string
  /** `'edit'` renders a `CurrencyInput` in every editable value cell. Default `'read'`. */
  mode?: 'read' | 'edit'
  onCellChange?: (rowId: string, colKey: string, minor: number | null) => void
  onRowClick?: (row: StatementRow) => void
  /**
   * Which rows {@link StatementTableProps.onRowClick} can actually act on.
   *
   * 🛑 Pass this whenever `onRowClick` is passed, and derive it from the SAME
   * condition the handler branches on. The gate used to be `kind !== 'section'`,
   * which is not the same question: a total, a subtotal and a computed row all
   * pass it while carrying no key to drill on, so five reports painted a pointer
   * cursor and a hover response on rows that did nothing - including the general
   * ledger's red "INCOMPLETE" warning row.
   *
   * A row this refuses falls through to `onToggleOpen`, so a group row that
   * cannot drill still expands instead of swallowing the click.
   */
  canRowDrill?: (row: StatementRow) => boolean
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
  /**
   * `'offset'` (two columns, read mode only): below the `@lg` container width the
   * second column collapses onto the first, shifted one tab right - the ledger's
   * debit/credit indent instead of two full money columns. Default `'columns'`.
   */
  amountLayout?: 'columns' | 'offset'
}

/** Only a `line` row's cells ever accept `CurrencyInput` edits or a click-through. */
const EDITABLE_KINDS: ReadonlySet<StatementRow['kind']> = new Set(['line'])

/** The `offset` layout's tracks: `VALUE_COL`'s width twice, then a value track plus one tab. */
const OFFSET_TRACKS = 'grid grid-cols-[8rem_8rem] @max-lg/statement:grid-cols-[7rem_3rem]'

/**
 * One cell's placement in {@link OFFSET_TRACKS}. When narrow, the second value spans
 * both tracks so it ends a tab right of the first; an empty cell hides instead of
 * drawing an em-dash, and a row carrying both (the totals) stacks the second.
 */
function offsetCellClass(index: number, empty: boolean, stacked: boolean): string {
  return cn(
    'min-w-0 px-1 row-start-1',
    index === 0
      ? 'col-start-1'
      : 'col-start-2 @max-lg/statement:col-span-2 @max-lg/statement:col-start-1',
    empty && '@max-lg/statement:hidden',
    stacked && index === 1 && '@max-lg/statement:row-start-2'
  )
}

export function StatementTable({
  columns,
  rows,
  currency,
  mode = 'read',
  onCellChange,
  onRowClick,
  canRowDrill = hasAnyDrillKey,
  verdict,
  searchable = false,
  labelHeading = 'Account',
  expandAllByDefault = false,
  className,
  rowClassName,
  amountLayout = 'columns',
}: StatementTableProps) {
  const offset = amountLayout === 'offset' && columns.length === 2 && mode === 'read'
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
   * Which row wears the verdict, or `undefined` for the strip fallback.
   *
   * Measured on the WHOLE statement rather than the filtered rows only so the
   * two answers cannot differ; while a search is active nothing is marked at
   * all, for the reason the count below the table states.
   */
  const markedRowId = verdict && !query ? verdictRowId(rows) : undefined

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
      className={cn('flex flex-col gap-3', offset && '@container/statement', className)}
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
      <div
        className={cn(
          'rounded-lg border border-primary-200/50 dark:border-[#1e2227]',
          // Narrow: drop the leading icon box; `--statement-icon-width` keeps memo indents in step.
          offset &&
            '@max-lg/statement:[--statement-icon-width:0px] @max-lg/statement:[&_[data-slot=tree-row-icon]]:hidden'
        )}>
        {/*
          ⚠️ `top-[var(--statement-sticky-top,0px)]` and NOT `top-0`. The reports
          scroll inside their own `ScrollArea` with the toolbar outside it - the
          accounting LAYOUT's, above the scroll - where 0 is right; the two
          settings doors sit under `SettingsPage`'s pinned
          title + tab block and set the var to `var(--settings-sticky-top)`, or
          this header pins underneath that block and is invisible for the whole
          scroll (the trap `opening-stock-list.tsx` documents).
        */}
        <div className='sticky top-[var(--statement-sticky-top,0px)] z-10 flex items-center rounded-t-lg border-primary-200/50 border-b bg-primary-50 px-1 py-1.5 text-muted-foreground text-sm dark:border-[#1e2227] dark:bg-background'>
          <div className='flex min-w-0 flex-1 items-center'>
            {/* `size-7`, matching `LeadingIcon`'s box, so the heading starts at
                the same x as every row's label. */}
            <span data-slot='tree-row-icon' className='size-7 shrink-0' />
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
          <div className={offset ? OFFSET_TRACKS : 'flex items-center'}>
            {columns.map((column, index) =>
              offset ? (
                <div
                  key={column.key}
                  className={cn(offsetCellClass(index, false, false), 'text-right')}>
                  <span className='@max-lg/statement:hidden'>{column.label}</span>
                  <span className='hidden @max-lg/statement:inline'>
                    {column.shortLabel ?? column.label}
                  </span>
                </div>
              ) : (
                <div key={column.key} className={cn(VALUE_COL, 'text-right')}>
                  {column.label}
                </div>
              )
            )}
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
                canRowDrill={canRowDrill}
                rowClassName={rowClassName}
                offset={offset}
                verdictMark={
                  verdict && row.id === markedRowId ? (
                    <StatementVerdictMark verdict={verdict} />
                  ) : undefined
                }
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

      {/*
        The FALLBACK, for a statement with no total row to mark (the provider
        agreement, a flat list of accounts). Everything that ends in a bottom
        line wears {@link StatementVerdictMark} on that row instead.
      */}
      {verdict && !query && !markedRowId && (
        <Alert variant={verdict.ok ? 'success' : 'destructive'}>
          {verdict.ok ? <CheckCircle2 /> : <TriangleAlert />}
          <span>{verdictText(verdict)}</span>
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
  canRowDrill: (row: StatementRow) => boolean
  /** Appended after the row's `kind` class. See `StatementTableProps`. */
  rowClassName?: string
  /** The resolved `amountLayout === 'offset'`. See {@link offsetCellClass}. */
  offset: boolean
  /** The statement's verdict, on the one row that carries it. See {@link StatementVerdictMark}. */
  verdictMark?: ReactNode
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
  canRowDrill,
  rowClassName,
  offset,
  verdictMark,
}: StatementTableRowProps) {
  const editable = mode === 'edit' && EDITABLE_KINDS.has(row.kind)
  const drillable = !!onRowClick && canRowDrill(row)
  const hasChildren = !!row.children && row.children.length > 0
  const isOpen = openIds.has(row.id)

  const showValues = showsValues(row, hasChildren, isOpen)

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
      icon={<StatementRowIcon row={row} hasChildren={hasChildren} />}
      isOpen={isOpen}
      // Two gestures, two slots. `onRowClick` takes the body and leaves the
      // chevron to `onToggleOpen`, so a row can expand AND drill. A row that
      // cannot drill passes only `onToggleOpen`, and `TreeRow` falls back to it
      // for the body - which is what lets a non-drillable group row expand.
      onToggleOpen={hasChildren ? () => onToggleOpen(row.id) : undefined}
      onRowClick={drillable ? () => onRowClick?.(row) : undefined}
      title={<StatementRowLabel row={row} codeWidthCh={codeWidthCh} verdictMark={verdictMark} />}
      secondary={row.meta?.badge}
      description={row.meta?.note}
      rowClassName={cn(ROW_KIND_CLASS[row.kind], rowClassName)}
      actions={
        <div className={offset ? cn(OFFSET_TRACKS, 'items-center') : 'flex items-center'}>
          {columns.map((column, index) => {
            const minor = row.values[index] ?? null
            const stacked = row.values.every((value) => value != null)
            return (
              <div
                key={column.key}
                className={cn(
                  offset ? offsetCellClass(index, minor === null, stacked) : VALUE_COL,
                  'text-right font-mono text-sm tabular-nums'
                )}>
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
                ) : (
                  formatStatementCell(minor, column, currency)
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
              canRowDrill={canRowDrill}
              rowClassName={rowClassName}
              offset={offset}
            />
          ))
        : undefined}
    </TreeRow>
  )
}
