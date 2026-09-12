// apps/web/src/components/line-grid/ui/line-grid-frame.tsx
'use client'

// The bordered frame every line grid renders inside - extracted from
// `line-builder.tsx`'s inline JSX (the header + rows container block), which
// `return-salvage-card.tsx` had already hand-copied once (money/tasks/56 §1),
// the thing this extraction exists to stop happening a third time.
//
// Owns: the bordered box (`data-slot='line-builder-frame'`, kept so
// `TuckedSection`'s override keeps working), the sticky header row on the
// same `cols` as the rows with an optional leading add-button, the rows
// container's three `*Capture` handlers that remember the focused cell, the
// post-swap focus-restore effect (a materialized draft's create swaps its
// `<input>` for a new one and drops focus to `<body>` - this restores it),
// and calling {@link useLineNav} so a consumer gets spreadsheet nav for free.
//
// Does NOT own: what a row IS. The builder wraps its rows in
// `DndContext`/`SortableContext` for drag-reorder; the return lines card
// (money/tasks/56 §4) has no reorder and just renders plain rows. Both pass
// `children` straight through.

import { cn } from '@auxx/ui/lib/utils'
import type { ReactNode, RefObject } from 'react'
import { useCallback, useLayoutEffect, useRef } from 'react'
import { useLineNav } from '../hooks/use-line-nav'

/** One header cell - the frame renders one per column, over `cols`. */
export interface LineGridHeaderCell {
  label: ReactNode
  /** Text alignment for this header cell. Defaults to `'start'`. */
  align?: 'start' | 'end'
  /**
   * Rendered right after `label` in the SAME cell - money's leading "add line
   * item" button. Only meaningful on a `'start'`-aligned cell; there is
   * nowhere else in the header for a second control to go.
   */
  addButton?: ReactNode
}

export interface LineGridFrameProps {
  /** The `grid-template-columns` string, shared by the header and every row. */
  cols: string
  header: LineGridHeaderCell[]
  /** Total navigable rows (real + phantom draft) - feeds {@link useLineNav} and the focus-restore clamp. */
  rowCount: number
  /** Navigable columns per row - feeds {@link useLineNav}. */
  colCount: number
  /** Push a fresh row. Called by {@link useLineNav} when nav lands past the last row. */
  onAddRow: () => void
  readOnly: boolean
  /** Rendered instead of `children` when `showEmpty` is true. */
  empty?: ReactNode
  /**
   * Whether to render `empty` instead of `children`. Defaults to `rowCount
   * === 0` - pass this explicitly wherever "empty" means something narrower,
   * e.g. money's builder only swaps to its empty state when ALSO `readOnly`
   * (an editable builder never renders zero rows; it re-seeds a placeholder
   * draft instead, so `rowCount` is never really 0 there).
   */
  showEmpty?: boolean
  /**
   * The rows container's ref, shared with a row-action hook (e.g.
   * `useLineRowActions`) wired up outside the frame so both listen on the
   * same element. Created internally when omitted.
   */
  containerRef?: RefObject<HTMLDivElement | null>
  /** Extra classes merged onto the bordered frame box itself. */
  className?: string
  /**
   * Extra classes merged onto the header grid. The one known use is a
   * column gap: a consumer whose rows carry `gap-x-2` (the salvage tree, whose
   * quantity and status cells are bordered) needs the same gap on the header
   * or its labels drift off the columns.
   */
  headerClassName?: string
  children: ReactNode
}

/** The one thing every focus-restore needs to remember about the last-focused cell. */
interface FocusedCell {
  row: number
  col: number
  caret: number | null
}

/**
 * The frame: header + rows share one bordered box so the grid reads as a
 * single framed table, over ONE `cols` template so every column lines up.
 * Calls {@link useLineNav} internally - a consumer that renders this gets
 * spreadsheet keyboard nav without wiring it up itself.
 */
export function LineGridFrame({
  cols,
  header,
  rowCount,
  colCount,
  onAddRow,
  readOnly,
  empty,
  showEmpty,
  containerRef,
  className,
  headerClassName,
  children,
}: LineGridFrameProps) {
  const internalRef = useRef<HTMLDivElement>(null)
  const rowsContainerRef = containerRef ?? internalRef

  // Last focused line cell (row/col + caret). Committing a draft fires a
  // create whose completion swaps one row's input elements for another's,
  // dropping focus to `<body>`. We snapshot the focused cell here and restore
  // it after that swap so keyboard flow survives materialization (otherwise
  // the next Tab escapes the grid entirely).
  const focusedCellRef = useRef<FocusedCell | null>(null)

  const rememberFocusedCell = useCallback(() => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
    const cell = el?.closest?.('[data-line-row][data-line-col]') as HTMLElement | null
    if (!cell || !rowsContainerRef.current?.contains(cell)) return
    focusedCellRef.current = {
      row: Number(cell.dataset.lineRow),
      col: Number(cell.dataset.lineCol),
      caret: typeof el?.selectionStart === 'number' ? el.selectionStart : null,
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: rowsContainerRef is a ref, its identity is stable
  }, [])

  // Spreadsheet keyboard nav across the rows container; Enter / ArrowDown /
  // Tab past the last row calls `onAddRow` to spawn a draft.
  useLineNav({
    containerRef: rowsContainerRef,
    rowCount,
    colCount,
    onAddRow,
    readOnly,
  })

  // Restore focus after a row swap: when materialization detaches the focused
  // input, the browser parks focus on `<body>`. Only then (never when the
  // user intentionally clicked elsewhere) do we re-focus the same cell index.
  //
  // No dependency array by design: the kit has no signal for "the row set
  // changed" the way money has `records`/`drafts` - running after every
  // render is the generalization of that, and the body is a cheap no-op
  // unless focus actually landed on `<body>`.
  useLayoutEffect(() => {
    const target = focusedCellRef.current
    if (!target || document.activeElement !== document.body) return
    if (rowCount === 0) return
    // Deleting the bottom row leaves the remembered index past the end - clamp
    // it so focus lands on the row above instead of dropping out of the grid.
    const row = Math.min(target.row, rowCount - 1)
    const sel = `[data-line-row="${row}"][data-line-col="${target.col}"]`
    // The name cell rests as a `[data-cell-focusable]` text button (no <input>
    // until focused), so match that too - otherwise focus is lost after a
    // draft→real swap on the name column.
    const input = rowsContainerRef.current?.querySelector(
      `${sel} input, ${sel} textarea, ${sel} [data-cell-focusable]`
    ) as HTMLElement | null
    if (!input) return
    input.focus()
    if (target.caret != null && 'setSelectionRange' in input) {
      try {
        ;(input as HTMLInputElement).setSelectionRange(target.caret, target.caret)
      } catch {
        // Non-text inputs reject setSelectionRange - focus alone is enough.
      }
    }
  })

  const isEmpty = showEmpty ?? rowCount === 0

  return (
    <div
      data-slot='line-builder-frame'
      className={cn('rounded-lg border border-primary-200/50 dark:border-[#1e2227]', className)}>
      {/* Header - same grid template as the rows, so the labels sit over their columns. */}
      <div
        className={cn(
          'sticky top-0 z-10 grid rounded-t-lg border-primary-200/50 border-b bg-primary-50 px-1 py-2 text-muted-foreground text-sm dark:border-[#1e2227] dark:bg-background',
          headerClassName
        )}
        style={{ gridTemplateColumns: cols }}>
        {header.map((cell, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: header cells are a fixed-order column layout
            key={index}
            className={cell.align === 'end' ? 'px-2 text-right' : 'flex items-center gap-1 pl-2'}>
            {cell.label}
            {cell.addButton}
          </div>
        ))}
      </div>

      {/* Rows container - the keydown listener for spreadsheet nav lives here, so
          real rows and phantom drafts share one continuous focus index space.
          The capture handlers keep `focusedCellRef` fresh for post-swap restore. */}
      <div
        ref={rowsContainerRef}
        onFocusCapture={rememberFocusedCell}
        onKeyUpCapture={rememberFocusedCell}
        onPointerUpCapture={rememberFocusedCell}>
        {isEmpty ? empty : children}
      </div>
    </div>
  )
}
