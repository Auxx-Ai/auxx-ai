// apps/web/src/components/dynamic-table/components/checkbox-header-cell.tsx

'use client'

import { Checkbox } from '@auxx/ui/components/checkbox'
import type { Header } from '@tanstack/react-table'
import { useTableContext } from '../context/table-context'

interface CheckboxHeaderCellProps<TData> {
  header: Header<TData, unknown>
}

/**
 * Header checkbox for select all functionality
 */
export function CheckboxHeaderCell<TData>({ header }: CheckboxHeaderCellProps<TData>) {
  const { table } = useTableContext<TData>()

  const isPinned = header.column.getIsPinned() === 'left'

  return (
    <div
      style={{
        width: header.getSize(),
        minWidth: header.column.columnDef.minSize,
        maxWidth: header.column.columnDef.maxSize,
        ...(isPinned && { position: 'sticky', left: header.column.getStart('left'), zIndex: 20 }),
      }}
      className={`relative ${isPinned ? 'z-10 from-white to-white/50 bg-gradient-to-b dark:from-primary-100 dark:to-primary-100/50  backdrop-blur' : ''}`}>
      <div className="group min-w-min h-full font-inter font-medium">
        <div className=" h-full relative flex">
          <div className="flex items-center justify-end px-2 " style={{ width: 40 }}>
            <Checkbox
              checked={
                table.getIsAllPageRowsSelected() ||
                (table.getIsSomePageRowsSelected() && 'indeterminate')
              }
              onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
              aria-label="Select all"
              className="w-4 h-4 text-accent-500 bg-primary-100 border-primary-300 hover:border-primary-400 rounded transition-colors focus:ring-accent-400 cursor-pointer focus:ring-2"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
