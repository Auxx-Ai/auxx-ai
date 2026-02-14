// apps/web/src/components/dynamic-table/components/bulk-action-bar.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTableConfig } from '../context/table-config-context'
import { useTableInstance } from '../context/table-instance-context'
import { useRowSelection as useRowSelectionHook } from '../hooks/use-table-selectors'

interface BulkActionBarProps {
  children?: ReactNode
}

/**
 * Bulk action bar component for DynamicTable
 * Can be used as a child of DynamicTable to provide custom bulk actions
 *
 * Migrated to use split contexts instead of monolithic TableContext
 */
export function BulkActionBar({ children }: BulkActionBarProps) {
  const { table } = useTableInstance()
  const { tableId, bulkActions = [], enableBulkActions } = useTableConfig()

  // Use proper Zustand selector with useShallow for stable reference
  const rowSelectionState = useRowSelectionHook(tableId)

  // Memoize the selected rows to avoid recalculating on every render
  const selectedRows = useMemo(
    () => table.getFilteredSelectedRowModel().rows,
    [rowSelectionState, table]
  )

  const selectedCount = selectedRows.length

  // Don't render if bulk actions are not enabled or no rows are selected
  if (!enableBulkActions || selectedCount === 0) {
    return null
  }

  return (
    <div className='w-full overflow-hidden'>
      <div className='flex flex-nowrap @container/controls items-row items-center gap-1.5 py-2 bg-background overflow-x-auto no-scrollbar w-full scroll-px-3 snap-x'>
        {/* <div className="flex items-center gap-2 flex-nowrap px-3 shrink-0 w-full flex-1 "> */}
        <div className=' shrink-0 w-1.5'></div>

        <Button variant='info' size='sm' onClick={() => table.toggleAllRowsSelected(false)}>
          <X />
          {selectedCount} selected
        </Button>

        {/* Render default bulk actions */}
        {bulkActions.map((action) => {
          const Icon = action.icon
          const isDisabled = action.disabled?.(selectedRows.map((r) => r.original))
          const isHidden = action.hidden?.(selectedRows.map((r) => r.original))

          if (isHidden) return null

          return (
            <Button
              key={action.label}
              onClick={() => action.action(selectedRows.map((r) => r.original))}
              disabled={isDisabled}
              size='xs'
              variant={action.variant || 'default'}>
              {Icon && <Icon />}
              {action.label}
            </Button>
          )
        })}

        {/* Render custom children */}
        {children}

        <Button variant='outline' size='sm' onClick={() => table.resetRowSelection()} className=''>
          Cancel
        </Button>
        <div className='shrink-0 w-1.5'></div>
        {/* </div> */}
      </div>
    </div>
  )
}

// Add display name for easier identification
BulkActionBar.displayName = 'BulkActionBar'
