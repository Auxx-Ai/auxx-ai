// apps/web/src/components/dynamic-table/components/floating-bulk-action-bar.tsx
'use client'

import { useMemo } from 'react'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import type { BulkAction } from '../types'

/**
 * Props for the FloatingBulkActionBar component.
 */
interface FloatingBulkActionBarProps<TData> {
  /** Selected data items (raw data, works for both table and kanban views). */
  selectedData: TData[]
  /** Array of bulk action configurations. */
  bulkActions: BulkAction<TData>[]
  /** Callback to clear the current selection. */
  onClearSelection: () => void
}

/**
 * Floating action bar that appears when items are selected.
 * Renders at bottom-center of viewport via portal.
 * Works with both table rows and kanban cards.
 */
export function FloatingBulkActionBar<TData>({
  selectedData,
  bulkActions,
  onClearSelection,
}: FloatingBulkActionBarProps<TData>) {
  const isOpen = selectedData.length > 0

  // Convert BulkAction[] to ActionBarAction[]
  const actions: ActionBarAction[] = useMemo(() => {
    return bulkActions
      .filter(action => !action.hidden?.(selectedData))
      .map(action => ({
        id: action.id ?? action.label,
        label: action.label,
        icon: action.icon,
        onClick: () => action.action(selectedData),
        disabled: action.disabled?.(selectedData),
        variant: action.variant || 'outline',
      }))
  }, [bulkActions, selectedData])

  return (
    <ActionBar
      open={isOpen}
      onOpenChange={open => { if (!open) onClearSelection() }}
      duration={Infinity}
      selectedCount={selectedData.length}
      selectedLabel="selected"
      actions={actions}
      showClose
    />
  )
}

FloatingBulkActionBar.displayName = 'FloatingBulkActionBar'
