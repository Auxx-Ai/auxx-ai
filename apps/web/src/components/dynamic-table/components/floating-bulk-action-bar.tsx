// apps/web/src/components/dynamic-table/components/floating-bulk-action-bar.tsx
'use client'

import {
  ActionBar,
  ActionBarActionItem,
  ActionBarActions,
  ActionBarClose,
  ActionBarContent,
  ActionBarText,
} from '@auxx/ui/components/action-bar'
import { Button } from '@auxx/ui/components/button'
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

  return (
    <ActionBar
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClearSelection()
      }}
      duration={Infinity}>
      <ActionBarContent>
        <ActionBarText count={selectedRows.length} label="selected" />
        <ActionBarActions>
          {bulkActions.map((action) => {
            const Icon = action.icon
            const isDisabled = action.disabled?.(selectedRows.map((r) => r.original))
            const isHidden = action.hidden?.(selectedRows.map((r) => r.original))

            if (isHidden) return null

            return (
              <ActionBarActionItem key={action.label} asChild>
                <Button
                  onClick={() => action.action(selectedRows.map((r) => r.original))}
                  disabled={isDisabled}
                  size="sm"
                  variant={action.variant || 'outline'}>
                  {Icon && <Icon />}
                  {action.label}
                </Button>
              </ActionBarActionItem>
            )
          })}
        </ActionBarActions>
      </ActionBarContent>
      <ActionBarClose />
    </ActionBar>
  )
}

FloatingBulkActionBar.displayName = 'FloatingBulkActionBar'
