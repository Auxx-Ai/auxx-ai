// apps/web/src/components/dynamic-table/context/row-selection-context.tsx

'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { BulkAction } from '../types'

interface RowSelectionContextValue<TData = any> {
  /** Whether checkboxes are enabled */
  enableCheckbox: boolean
  /** Whether any rows are selected (bulk mode active) */
  isBulkMode: boolean
  /** Stable getter for bulk mode - doesn't trigger re-renders */
  getIsBulkMode: () => boolean
  /** Toggle row selection with shift-click support */
  toggleRowSelection: (rowId: string, event: React.MouseEvent) => void
  /** Get last selected index for shift-click range selection */
  getLastSelectedIndex: () => number | null
  /** Set last selected index */
  setLastSelectedIndex: (index: number | null) => void
  /** Get last clicked row ID */
  getLastClickedRowId: () => string | null
  /** Set last clicked row ID */
  setLastClickedRowId: (id: string | null) => void
  /** Bulk actions configuration */
  bulkActions?: BulkAction<TData>[]
  /** Callback when row selection changes */
  onRowSelectionChange?: (selectedRows: Set<string>) => void
}

const RowSelectionContext = createContext<RowSelectionContextValue | null>(null)

interface RowSelectionProviderProps<TData = any> {
  children: ReactNode
  value: RowSelectionContextValue<TData>
}

/**
 * Provider for row selection state - kept separate from main TableContext for performance.
 * This prevents row selection changes from triggering re-renders in unrelated components.
 */
export function RowSelectionProvider<TData = any>({
  children,
  value,
}: RowSelectionProviderProps<TData>) {
  return <RowSelectionContext.Provider value={value}>{children}</RowSelectionContext.Provider>
}

/**
 * Hook to access row selection state
 */
export function useRowSelection<TData = any>(): RowSelectionContextValue<TData> {
  const context = useContext(RowSelectionContext)
  if (!context) {
    throw new Error('useRowSelection must be used within RowSelectionProvider')
  }
  return context as RowSelectionContextValue<TData>
}

/**
 * Hook for components that optionally support row selection
 */
export function useRowSelectionOptional<TData = any>(): RowSelectionContextValue<TData> | null {
  return useContext(RowSelectionContext) as RowSelectionContextValue<TData> | null
}
