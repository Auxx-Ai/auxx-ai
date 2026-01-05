// apps/web/src/components/dynamic-table/context/table-context.tsx

'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { Table } from '@tanstack/react-table'
import type { TableView, BulkAction, DragDropConfig, ColumnFormatting } from '../types'
import type { ModelType, SelectOptionColor } from '@auxx/types/custom-field'
import type { ConditionGroup } from '@auxx/lib/conditions/client'

/** Select field for kanban grouping */
interface SelectField {
  id: string
  name: string
  type?: string
  options?: { options?: Array<{ value: string; label: string; color?: SelectOptionColor }> }
}

/** Custom field definition for kanban card display */
interface CustomField {
  id: string
  name: string
  type: string
}

interface TableContextValue<TData = any> {
  // Table instance
  table: Table<TData>

  // Props
  tableId: string
  enableFiltering?: boolean
  enableSorting?: boolean
  enableSearch?: boolean
  enableBulkActions: boolean
  enableImport?: boolean
  showFooter?: boolean
  hideToolbar?: boolean
  enableCheckbox: boolean
  showRowNumbers?: boolean

  /** SINGLE_SELECT fields for kanban view grouping */
  selectFields?: SelectField[]

  /** All custom fields for kanban card display */
  customFields?: CustomField[]

  /** Primary display field ID for kanban cards */
  primaryFieldId?: string

  /** Entity label for "New X" buttons in kanban */
  entityLabel?: string

  /** Callback when "New" button is clicked in primary column header */
  onAddNew?: () => void

  /** Model type for creating new fields: 'contact', 'ticket', 'entity', etc. */
  modelType?: ModelType

  /** Entity definition ID - required only when modelType is 'entity' */
  entityDefinitionId?: string

  /** Resource type ID for server-side filtering (e.g., 'contact', 'ticket', 'entity_abc123') */
  resourceType?: string

  // Kanban callbacks
  /** Callback when kanban card is clicked */
  onCardClick?: (card: TData) => void
  /** Callback to add a new card in a kanban column */
  onAddCard?: (columnId: string) => void

  // Kanban selection state (controlled from parent for persistence)
  /** Selected kanban card IDs */
  selectedKanbanCardIds?: Set<string>
  /** Callback when kanban card selection changes */
  onSelectedKanbanCardIdsChange?: (ids: Set<string>) => void

  // State
  views: TableView[]
  currentView: TableView | null
  isLoadingViews: boolean
  isSavingView: boolean
  hasUnsavedViewChanges: boolean
  saveCurrentView: () => Promise<void>
  resetViewChanges: () => void
  markViewClean: () => void
  isLoading: boolean
  searchQuery: string
  filters: ConditionGroup[]
  columnTypes: Record<string, string>
  columnLabels: Record<string, string>
  columnFormatting: Record<string, ColumnFormatting>
  pinnedColumnId: string | null

  // Actions
  setSearchQuery: (query: string) => void
  setActiveView: (viewId: string | null) => void
  setFilters: (filters: ConditionGroup[]) => void
  setColumnLabel: (columnId: string, label: string | null) => void
  setColumnFormatting: (columnId: string, formatting: ColumnFormatting | null) => void
  setPinnedColumn: (columnId: string | null) => void

  // Callbacks
  onRowClick?: (row: TData, event: React.MouseEvent, rowId: string, table: Table<TData>) => void
  onImport?: (file: File) => Promise<void>
  importHref?: string
  onRefresh?: () => void
  onScrollToBottom?: () => void
  bulkActions?: BulkAction<TData>[]

  // Utilities
  rowClassName?: (row: TData) => string | undefined

  // Footer
  footerElement?: ReactNode

  // Custom components
  bulkActionBarElement?: ReactNode
  tableToolbarElement?: ReactNode
  customFilter?: ReactNode
  headerActions?: ReactNode

  emptyState?: ReactNode

  // Drag and drop
  dragDropConfig?: DragDropConfig<TData>
  activeDragItems: TData[] | null
  setActiveDragItems: (items: TData[] | null) => void

  // Debug
  debug?: {
    enabled?: boolean
    showRects?: boolean
    showCenters?: boolean
    showDistances?: boolean
  }
}

const TableContext = createContext<TableContextValue | undefined>(undefined)

interface TableProviderProps<TData = any> {
  children: ReactNode
  value: TableContextValue<TData>
}

/**
 * Provider for DynamicTable context
 */
export function TableProvider<TData = any>({ children, value }: TableProviderProps<TData>) {
  return (
    <TableContext.Provider value={value as TableContextValue}>{children}</TableContext.Provider>
  )
}

/**
 * Hook to access table context
 */
export function useTableContext<TData = any>() {
  const context = useContext(TableContext)
  if (!context) {
    throw new Error('useTableContext must be used within a TableProvider')
  }
  return context as TableContextValue<TData>
}
