// apps/web/src/components/accounting/ui/reports/statement-table.tsx

'use client'

import type { RecordId } from '@auxx/types/resource'
import { CurrencyInput, CurrencyInputField } from '@auxx/ui/components/input-currency'
import { InputGroup } from '@auxx/ui/components/input-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { TooltipExplanation } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2, ChevronRight, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { EMPTY_CELL, formatMinor, formatSignedMinor } from '../ledger/format'

/**
 * `StatementTable`, the one primitive every accounting report, the opening
 * trial balance, aging and the 1099/depreciation summaries render through
 * (`plans/accounting/ui-plan.md` §4.1). Built on the plain `Table` from
 * `@auxx/ui`, never TanStack: there is no data-table primitive in this
 * module by design.
 */

/** One row of a statement. */
export interface StatementRow {
  id: string
  label: string
  depth: 0 | 1 | 2
  kind: 'section' | 'line' | 'subtotal' | 'total' | 'computed'
  /** Minor units, one per column. `null` renders {@link EMPTY_CELL}. */
  values: (number | null)[]
  meta?: { accountCode?: string; recordId?: RecordId; badge?: ReactNode; note?: string }
  /** Aging drill-down: documents behind a contact, revealed on expand. */
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
  className?: string
}

/** Only a `line` row's cells ever accept `CurrencyInput` edits or a click-through. */
const EDITABLE_KINDS: ReadonlySet<StatementRow['kind']> = new Set(['line'])

/** `TableFooter`'s own classes, applied per-row so a subtotal can sit mid-table. */
const SUBTOTAL_ROW_CLASS = 'border-t bg-muted/50 font-medium'
const TOTAL_ROW_CLASS = 'border-t-2 bg-muted/50 font-semibold'

export function StatementTable({
  columns,
  rows,
  currency,
  mode = 'read',
  onCellChange,
  onRowClick,
  verdict,
  className,
}: StatementTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  function toggleExpanded(rowId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  const visible = flattenVisibleRows(rows, expanded)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn('w-32', column.align === 'right' && 'text-right')}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map(({ row, isChild }) => (
            <StatementTableRow
              key={row.id}
              row={row}
              isChild={isChild}
              columns={columns}
              currency={currency}
              mode={mode}
              expanded={expanded.has(row.id)}
              onToggleExpanded={
                row.children && row.children.length > 0 ? () => toggleExpanded(row.id) : undefined
              }
              onCellChange={onCellChange}
              onRowClick={onRowClick}
            />
          ))}
        </TableBody>
      </Table>

      {verdict && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
            verdict.ok
              ? 'border-green-500/40 text-green-700 dark:text-green-400'
              : 'border-destructive/50 text-destructive'
          )}>
          {verdict.ok ? <CheckCircle2 className='size-4' /> : <TriangleAlert className='size-4' />}
          <span>
            {verdict.label}
            {verdict.detail ? ` ${verdict.detail}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}

interface StatementTableRowProps {
  row: StatementRow
  isChild: boolean
  columns: StatementColumn[]
  currency: string
  mode: 'read' | 'edit'
  expanded: boolean
  onToggleExpanded?: () => void
  onCellChange?: (rowId: string, colKey: string, minor: number | null) => void
  onRowClick?: (row: StatementRow) => void
}

function StatementTableRow({
  row,
  isChild,
  columns,
  currency,
  mode,
  expanded,
  onToggleExpanded,
  onCellChange,
  onRowClick,
}: StatementTableRowProps) {
  const depth = isChild ? Math.max(row.depth, 1) : row.depth
  const editable = mode === 'edit' && EDITABLE_KINDS.has(row.kind)
  const clickable = !!onRowClick && row.kind !== 'section'

  const rowClassName = cn(
    row.kind === 'subtotal' && SUBTOTAL_ROW_CLASS,
    row.kind === 'total' && TOTAL_ROW_CLASS,
    row.kind === 'computed' && 'text-muted-foreground italic',
    clickable && 'cursor-pointer'
  )

  if (row.kind === 'section') {
    return (
      <TableRow className={rowClassName} onClick={clickable ? () => onRowClick?.(row) : undefined}>
        <TableCell colSpan={columns.length + 1} className='font-medium'>
          <RowLabel
            row={row}
            depth={depth}
            onToggleExpanded={onToggleExpanded}
            expanded={expanded}
          />
        </TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow className={rowClassName} onClick={clickable ? () => onRowClick?.(row) : undefined}>
      <TableCell>
        <RowLabel row={row} depth={depth} onToggleExpanded={onToggleExpanded} expanded={expanded} />
      </TableCell>
      {columns.map((column, index) => {
        const minor = row.values[index] ?? null
        return (
          <TableCell
            key={column.key}
            className='text-right font-mono tabular-nums'
            onClick={editable ? (event) => event.stopPropagation() : undefined}>
            {editable ? (
              <CurrencyInput
                value={minor}
                currencyCode={currency}
                onValueChange={(next) =>
                  onCellChange?.(row.id, column.key, next === undefined ? null : next)
                }>
                <InputGroup className='ml-auto h-8 w-32 border-0 shadow-none ring-0!'>
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
          </TableCell>
        )
      })}
    </TableRow>
  )
}

function RowLabel({
  row,
  depth,
  expanded,
  onToggleExpanded,
}: {
  row: StatementRow
  depth: number
  expanded: boolean
  onToggleExpanded?: () => void
}) {
  return (
    <div className='flex min-w-0 items-center gap-1.5' style={{ paddingLeft: `${depth * 1.5}rem` }}>
      {onToggleExpanded ? (
        <button
          type='button'
          onClick={(event) => {
            event.stopPropagation()
            onToggleExpanded()
          }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
      ) : (
        <span className='size-4 shrink-0' />
      )}
      <span className='min-w-0 truncate'>{row.label}</span>
      {row.meta?.badge}
      {row.meta?.note && <TooltipExplanation text={row.meta.note} />}
    </div>
  )
}

/** One row, flattened, plus whether it is a child surfaced under an expanded parent. */
export interface FlatStatementRow {
  row: StatementRow
  isChild: boolean
}

/**
 * Flattens `rows` into the order the table renders: every top-level row, and
 * (immediately after a row whose id is in `expandedIds`) its `children`
 * (the aging drill-down). A row with `children` but a collapsed id renders
 * with a chevron and nothing beneath it.
 *
 * Pure, and exported so the expand/collapse behaviour is unit-testable
 * without mounting the table.
 */
export function flattenVisibleRows(
  rows: StatementRow[],
  expandedIds: ReadonlySet<string>
): FlatStatementRow[] {
  const out: FlatStatementRow[] = []
  for (const row of rows) {
    out.push({ row, isChild: false })
    if (row.children && row.children.length > 0 && expandedIds.has(row.id)) {
      for (const child of row.children) {
        out.push({ row: child, isChild: true })
      }
    }
  }
  return out
}
