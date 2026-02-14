// apps/web/src/components/dynamic-table/components/virtual-table-cell.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { type Cell, flexRender } from '@tanstack/react-table'
import { memo, useRef } from 'react'
import { sanitizeColumnId } from '../utils/sanitize-column-id'

interface VirtualTableCellProps<TData> {
  cell: Cell<TData, unknown>
  /** Column ID for CSS variable width - uses data-col attribute */
  columnId: string
  className?: string
}

/**
 * Virtual cell component - simple container for table cells
 *
 * Cell renderers (FormattedCell, ItemsCellView, custom components) handle
 * their own padding and layout. This component just provides the outer
 * flex wrapper for positioning.
 *
 * Width is controlled via CSS variables (--col-{id}-w) set on the parent container.
 * This eliminates re-renders on column resize.
 *
 * Memoized to prevent unnecessary re-renders when parent row updates.
 */
function VirtualTableCellInner<TData>({ cell, columnId, className }: VirtualTableCellProps<TData>) {
  const ref = useRef<HTMLDivElement>(null)

  // DEBUG: Flash yellow on re-render to visualize which cells are updating
  // useEffect(() => {
  //   const el = ref.current
  //   if (!el) return

  //   el.style.backgroundColor = 'rgba(255, 200, 0, 0.5)'
  //   el.style.transition = 'background-color 0.5s ease-out'
  //   const timeout = setTimeout(() => {
  //     el.style.backgroundColor = ''
  //   }, 100)

  //   return () => clearTimeout(timeout)
  // })

  return (
    <div
      ref={ref}
      data-col={sanitizeColumnId(columnId)}
      className={cn('flex items-center h-full', className)}>
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </div>
  )
}

/** Memoized VirtualTableCell */
export const VirtualTableCell = memo(VirtualTableCellInner) as typeof VirtualTableCellInner
