// apps/web/src/components/line-grid/ui/line-grid-row.tsx
'use client'

// The plain grid row shell every line-grid consumer renders one of per row -
// generalized out of money's `LineGridRow` (line-builder/line-rows.tsx), which
// hardcoded four named slots (name/qty/price/total). This version takes an
// ordered `cells` array instead, so a document with a different column set
// (the return lines card's part/qty/condition/fault, journal's own grid) gets
// the same chrome and the same `data-line-row`/`data-line-col` nav contract
// `useLineNav` reads, without money's shape baked in.
//
// 🛑 The nav column index is the position AMONG NAVIGABLE CELLS, not the
// array index - a `navigable: false` cell (money's read-only amount column on
// four of six documents) must not consume a column number, or a non-navigable
// middle column would break Tab order for every cell after it. See
// `line-grid-row.test.tsx`.

import { cn } from '@auxx/ui/lib/utils'
import type { useSortable } from '@dnd-kit/sortable'
import { GripVertical } from 'lucide-react'
import type { ReactNode } from 'react'

/** One column's content in a {@link LineGridRow}. */
export interface LineGridCell {
  node: ReactNode
  /**
   * Whether this cell joins the spreadsheet nav order - false renders it
   * without `data-line-row`/`data-line-col` at all, which is what money's
   * `totalNavigable` flag does for a read-only amount column. Defaults to
   * true.
   */
  navigable?: boolean
  /** Extra classes merged onto the cell's wrapper (e.g. `min-w-0` for a name cell). */
  className?: string
}

export interface LineGridRowProps {
  rowIndex: number
  /** The `grid-template-columns` string, shared with the header (`LineGridFrame`'s `cols`). */
  cols: string
  /** Rendered in the left gutter, outside the grid columns - a drag {@link GripSlot} or nothing. */
  grip: ReactNode
  /** One entry per column, in display order. */
  cells: LineGridCell[]
  /** Muted/indented treatment - money's deselectable optional quote line. */
  muted?: boolean
}

/**
 * One line's grid row - a `group/tree-row` so hover-revealed chrome (the drag
 * grip) fades in on row hover. Owns the shared column template and the
 * `data-line-row`/`data-line-col` tags {@link useLineNav} focus-hops between.
 */
export function LineGridRow({ rowIndex, cols, grip, cells, muted = false }: LineGridRowProps) {
  let navIndex = 0

  return (
    <div className={cn('group/tree-row relative text-sm', muted && 'opacity-75')}>
      {/* Drag grip - lives in the left gutter, OUTSIDE the framed grid. */}
      {grip}

      {/* Hover background - a standalone layer behind the grid columns. */}
      <div className='absolute inset-0 rounded-md transition-colors group-hover/tree-row:bg-background' />

      <div
        className={cn(
          'relative grid min-h-9 items-stretch px-1 text-muted-foreground',
          muted && 'pl-3'
        )}
        style={{ gridTemplateColumns: cols }}>
        {cells.map((cell, index) => {
          const navigable = cell.navigable ?? true
          const col = navigable ? navIndex++ : undefined
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: cells are a fixed-order column layout, never reordered or filtered
              key={index}
              data-line-row={navigable ? rowIndex : undefined}
              data-line-col={col}
              className={cn('flex items-center', cell.className)}>
              {cell.node}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Drag grip pinned into the left gutter - a small bordered box centered on the
 * frame's left edge (the `-left-2.5` offset straddles the border). Revealed only
 * on row hover; draft rows render no grip at all (they aren't sortable).
 */
export function GripSlot({
  attributes,
  listeners,
}: {
  attributes?: ReturnType<typeof useSortable>['attributes']
  listeners?: ReturnType<typeof useSortable>['listeners']
}) {
  return (
    <span
      {...attributes}
      {...listeners}
      // z-10: the row's grid div is a later positioned sibling - without a
      // z-index it hit-tests above the grip's inner half, eating drag starts.
      className='-left-2.5 -translate-y-1/2 absolute top-1/2 z-10 flex h-5 w-5 cursor-grab items-center justify-center rounded-md border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/tree-row:opacity-100'>
      <GripVertical className='size-3.5' />
    </span>
  )
}
