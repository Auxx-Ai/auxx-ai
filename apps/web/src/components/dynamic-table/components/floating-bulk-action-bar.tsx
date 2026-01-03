// apps/web/src/components/dynamic-table/components/floating-bulk-action-bar.tsx
'use client'

import { useMemo } from 'react'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import type { Row } from '@tanstack/react-table'
import type { BulkAction } from '../types'

/**
 * Props for the FloatingBulkActionBar component.
 */
interface FloatingBulkActionBarProps<TData> {
  /** Array of selected table rows. */
  selectedRows: Row<TData>[]
  /** Array of bulk action configurations. */
  bulkActions: BulkAction<TData>[]
  /** Callback to clear the current selection. */
  onClearSelection: () => void
}

/**
 * Floating action bar that appears when rows are selected.
 * Renders at bottom-center of viewport via portal.
 * Shown alongside the inline BulkActionBar in the header.
 */
export function FloatingBulkActionBar<TData>({
  selectedRows,
  bulkActions,
  onClearSelection,
}: FloatingBulkActionBarProps<TData>) {
  const isOpen = selectedRows.length > 0
  const rowData = useMemo(() => selectedRows.map(r => r.original), [selectedRows])

  // Convert BulkAction[] to ActionBarAction[]
  const actions: ActionBarAction[] = useMemo(() => {
    return bulkActions
      .filter(action => !action.hidden?.(rowData))
      .map(action => ({
        id: action.id ?? action.label,
        label: action.label,
        icon: action.icon,
        onClick: () => action.action(rowData),
        disabled: action.disabled?.(rowData),
        variant: action.variant || 'outline',
      }))
  }, [bulkActions, rowData])

  return (
    <ActionBar
      open={isOpen}
      onOpenChange={open => { if (!open) onClearSelection() }}
      duration={Infinity}
      selectedCount={selectedRows.length}
      selectedLabel="selected"
      actions={actions}
      showClose
    />
  )
}

FloatingBulkActionBar.displayName = 'FloatingBulkActionBar'
