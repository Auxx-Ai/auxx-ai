// apps/web/src/components/dynamic-table/components/virtual-table-cell.tsx

'use client'

import { memo } from 'react'
import { flexRender, type Cell } from '@tanstack/react-table'
import { cn } from '@auxx/ui/lib/utils'

interface VirtualTableCellProps<TData> {
  cell: Cell<TData, unknown>
  className?: string
  style?: React.CSSProperties
}

/**
 * Virtual cell component - simple container for table cells
 *
 * Cell renderers (FormattedCell, ItemsCellView, custom components) handle
 * their own padding and layout. This component just provides the outer
 * flex wrapper for positioning.
 *
 * Memoized to prevent unnecessary re-renders when parent row updates.
 */
function VirtualTableCellInner<TData>({ cell, className, style }: VirtualTableCellProps<TData>) {
  return (
    <div className={cn('flex items-center h-full', className)} style={style}>
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </div>
  )
}

/** Memoized VirtualTableCell */
export const VirtualTableCell = memo(VirtualTableCellInner) as typeof VirtualTableCellInner
