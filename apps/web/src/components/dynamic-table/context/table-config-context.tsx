// apps/web/src/components/dynamic-table/context/table-config-context.tsx
'use client'

import { createContext, useContext } from 'react'
import type { BulkAction, DragDropConfig } from '../types'

// ============================================================================
// TYPES
// ============================================================================

/** Static configuration - rarely changes */
export interface TableConfigContextValue<TData = any> {
  /** Unique table identifier */
  tableId: string

  /** Entity definition ID for field creation */
  entityDefinitionId?: string

  /** Enable filtering */
  enableFiltering?: boolean

  /** Enable sorting */
  enableSorting?: boolean

  /** Enable global search */
  enableSearch?: boolean

  /** Enable checkboxes for row selection */
  enableCheckbox: boolean

  /** Show row numbers when checkbox is enabled */
  showRowNumbers: boolean

  /** Enable bulk actions */
  enableBulkActions: boolean

  /** Enable import functionality */
  enableImport: boolean

  /** Import page URL */
  importHref?: string

  /** Show footer */
  showFooter: boolean

  /** Hide toolbar */
  hideToolbar: boolean

  /** Bulk actions configuration */
  bulkActions: BulkAction<TData>[]

  /** Row click handler */
  onRowClick?: (
    row: TData,
    event: React.MouseEvent,
    rowId: string,
    table: import('@tanstack/react-table').Table<TData>
  ) => void

  /** Import handler */
  onImport?: (file: File) => Promise<void>

  /** Refresh handler */
  onRefresh?: () => void

  /** Scroll to bottom handler */
  onScrollToBottom?: () => void

  /** Row selection change handler */
  onRowSelectionChange?: (ids: Set<string>) => void

  /** Custom row className */
  rowClassName?: (row: TData) => string | undefined

  /** Loading state */
  isLoading: boolean

  /** Custom filter component */
  customFilter?: React.ReactNode

  /** Empty state component */
  emptyState?: React.ReactNode

  /** Header actions */
  headerActions?: React.ReactNode

  /** Drag and drop configuration */
  dragDropConfig?: DragDropConfig<TData>

  /** Debug options */
  debug?: {
    enabled?: boolean
    showRects?: boolean
    showCenters?: boolean
    showDistances?: boolean
  }

  /** Footer element (from children) */
  footerElement?: React.ReactNode

  /** Bulk action bar element (from children) */
  bulkActionBarElement?: React.ReactNode

  /** Table toolbar element (from children) */
  tableToolbarElement?: React.ReactNode
}

// ============================================================================
// CONTEXT
// ============================================================================

const TableConfigContext = createContext<TableConfigContextValue | null>(null)

export const TableConfigProvider = TableConfigContext.Provider

export function useTableConfig<TData = any>(): TableConfigContextValue<TData> {
  const context = useContext(TableConfigContext)
  if (!context) {
    throw new Error('useTableConfig must be used within TableConfigProvider')
  }
  return context as TableConfigContextValue<TData>
}
