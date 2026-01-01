// apps/web/src/components/dynamic-table/components/checkbox-cell.tsx

'use client'

import { memo, useCallback, startTransition } from 'react'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { useTableContext } from '../context/table-context'
import { useRowSelection } from '../context/row-selection-context'
import type { CellContext } from '@tanstack/react-table'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Checkbox cell component that shows row number by default and checkbox on hover.
 * Clicking anywhere on the cell toggles selection. The checkbox is display-only.
 * Memoized to prevent unnecessary re-renders when other rows change.
 */
function CheckboxCellInner<TData>({ row, table }: CellContext<TData, unknown>) {
  const { showRowNumbers } = useTableContext<TData>()
  const { getLastSelectedIndex, setLastSelectedIndex, getIsBulkMode } = useRowSelection<TData>()
  const rowIndex = row.index
  const isSelected = row.getIsSelected()

  // Hide row numbers when in bulk selection mode
  const isBulkMode = getIsBulkMode()
  const shouldShowRowNumbers = showRowNumbers && !isBulkMode

  /** Handle cell click - toggles selection with shift-click support */
  const handleCellClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      const newChecked = !isSelected

      // Handle shift+click for range selection
      const lastIndex = getLastSelectedIndex()
      if (event.shiftKey && lastIndex !== null) {
        startTransition(() => {
          const start = Math.min(lastIndex, rowIndex)
          const end = Math.max(lastIndex, rowIndex)
          const allRows = table.getRowModel().rows
          const newSelection: Record<string, boolean> = { ...table.getState().rowSelection }

          for (let i = start; i <= end; i++) {
            const rowId = allRows[i]?.id
            if (rowId) {
              if (newChecked) {
                newSelection[rowId] = true
              } else {
                delete newSelection[rowId]
              }
            }
          }

          table.setRowSelection(newSelection)
        })
      } else {
        row.toggleSelected(newChecked)
        setLastSelectedIndex(rowIndex)
      }
    },
    [row, rowIndex, isSelected, setLastSelectedIndex, table, getLastSelectedIndex]
  )

  return (
    <div
      className="relative cursor-pointer"
      style={{ width: 40 }}
      onClick={handleCellClick}>
      <div className="flex size-full justify-end pr-2">
        {shouldShowRowNumbers && !isSelected && (
          <span className="flex-1 pl-2 pr-1 text-right text-[10px] tabular-nums text-primary-500 group-hover/tablerow:hidden">
            {rowIndex + 1}
          </span>
        )}
        <div
          className={cn('text-sm font-medium flex-none items-start', {
            'hidden group-hover/tablerow:flex': !isSelected && shouldShowRowNumbers,
          })}>
          {/* Display-only checkbox - cell click handles selection */}
          <Checkbox
            checked={isSelected}
            className="text-accent-500 bg-primary-100 border-primary-300 hover:border-primary-400 rounded transition-colors focus:ring-accent-400 pointer-events-none"
          />
        </div>
      </div>
    </div>
  )
}

/** Memoized CheckboxCell - only re-renders when row selection state changes */
export const CheckboxCell = memo(CheckboxCellInner) as typeof CheckboxCellInner
