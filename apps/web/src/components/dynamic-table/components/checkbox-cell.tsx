// apps/web/src/components/dynamic-table/components/checkbox-cell.tsx

'use client'

import { memo, useRef, useCallback, startTransition } from 'react'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { useTableContext } from '../context/table-context'
import type { CellContext } from '@tanstack/react-table'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Checkbox cell component that shows row number by default and checkbox on hover
 * Memoized to prevent unnecessary re-renders when other rows change
 */
function CheckboxCellInner<TData>({ row, table }: CellContext<TData, unknown>) {
  const { getLastSelectedIndex, setLastSelectedIndex, showRowNumbers } = useTableContext<TData>()
  const rowIndex = row.index
  const isSelected = row.getIsSelected()
  const checkboxRef = useRef<HTMLButtonElement>(null)

  const handleCheckboxChange = useCallback(
    (checked: boolean | 'indeterminate', event?: React.MouseEvent) => {
      if (checked === 'indeterminate') return

      // Handle shift+click for range selection
      const lastIndex = getLastSelectedIndex()
      if (event?.shiftKey && lastIndex !== null) {
        // Use startTransition for range selection to keep UI responsive
        startTransition(() => {
          const start = Math.min(lastIndex, rowIndex)
          const end = Math.max(lastIndex, rowIndex)
          const allRows = table.getRowModel().rows
          const newSelection: Record<string, boolean> = { ...table.getState().rowSelection }

          for (let i = start; i <= end; i++) {
            const rowId = allRows[i]?.id
            if (rowId) {
              if (checked) {
                newSelection[rowId] = true
              } else {
                delete newSelection[rowId]
              }
            }
          }

          table.setRowSelection(newSelection)
        })
      } else {
        // Normal click or ctrl/cmd+click
        row.toggleSelected(!!checked)
        setLastSelectedIndex(rowIndex)
      }
    },
    [row, rowIndex, setLastSelectedIndex, table, getLastSelectedIndex]
  )

  return (
    <div className="relative" style={{ width: 40 }}>
      <div className="flex size-full cursor-pointer justify-end pr-2">
        {showRowNumbers && !isSelected && (
          <span className="flex-1 pl-2 pr-1 text-right text-[10px] tabular-nums text-primary-500 group-hover/tablerow:hidden">
            {rowIndex + 1}
          </span>
        )}
        <label
          className={cn('text-sm font-medium flex-none items-start', {
            'hidden group-hover/tablerow:flex': !isSelected && showRowNumbers,
          })}>
          <Checkbox
            ref={checkboxRef}
            checked={isSelected}
            onCheckedChange={(newChecked) => handleCheckboxChange(newChecked)}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 text-accent-500 bg-primary-100 border-primary-300 hover:border-primary-400 rounded transition-colors focus:ring-accent-400 cursor-pointer"
          />
        </label>
      </div>
    </div>
  )
}

/** Memoized CheckboxCell - only re-renders when row selection state changes */
export const CheckboxCell = memo(CheckboxCellInner) as typeof CheckboxCellInner
