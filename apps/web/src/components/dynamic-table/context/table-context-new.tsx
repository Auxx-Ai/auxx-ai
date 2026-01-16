// apps/web/src/components/dynamic-table/context/table-context-new.tsx
'use client'

import { useMemo, useCallback, type ReactNode } from 'react'
import { useTableConfig } from './table-config-context'
import { useTableInstance } from './table-instance-context'
import { useViewMetadata } from './view-metadata-context'
import { useViewStore } from '../stores/view-store-new'
import { useTableUIStore } from '../stores/table-ui-store'
import { useFilterStore } from '../stores/filter-store'
import type { Table } from '@tanstack/react-table'
import type { TableView, BulkAction, DragDropConfig, ColumnFormatting, CustomField } from '../types'
import type { SelectOptionColor } from '@auxx/types/custom-field'
import type { ConditionGroup } from '@auxx/lib/conditions/client'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Stable empty references to prevent unnecessary re-renders */
const EMPTY_VIEWS: TableView[] = []
const EMPTY_FILTERS: ConditionGroup[] = []
const EMPTY_COLUMN_LABELS: Record<string, string> = {}
const EMPTY_COLUMN_FORMATTING: Record<string, ColumnFormatting> = {}

// ============================================================================
// TYPES
// ============================================================================

/** Select field for kanban grouping */
interface SelectField {
  id: string
  name: string
  type?: string
  options?: { options?: Array<{ value: string; label: string; color?: SelectOptionColor }> }
}

interface DynamicTableContextValue<TData = any> {
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

  /** SINGLE_SELECT fields for kanban view grouping (derived from entityDefinitionId) */
  selectFields?: SelectField[]

  /** All custom fields for kanban card display (derived from entityDefinitionId) */
  customFields?: CustomField[]

  /** Entity label for "New X" buttons in kanban */
  entityLabel?: string

  /** Callback when "New" button is clicked in primary column header */
  onAddNew?: () => void

  /** Entity definition ID for field creation */
  entityDefinitionId?: string

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

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Unified hook that combines all split contexts and stores
 * Provides the same API as the old useTableContext for backwards compatibility
 *
 * This replaces the monolithic React Context with a composition of:
 * - TableConfigContext (static config)
 * - TableInstanceContext (TanStack table)
 * - ViewMetadataContext (metadata for rendering)
 * - ViewStore (views, currentView)
 * - TableUIStore (columnLabels, formatting, pinned column)
 * - FilterStore (filters)
 */
export function useDynamicTableContext<TData = any>(
  searchQuery?: string,
  setSearchQuery?: (query: string) => void,
  isSavingView?: boolean,
  hasUnsavedViewChanges?: boolean,
  saveCurrentView?: () => Promise<void>,
  resetViewChanges?: () => void
): DynamicTableContextValue<TData> {
  // ─── SPLIT CONTEXTS ─────────────────────────────────────────────────────────
  const config = useTableConfig<TData>()
  const { table } = useTableInstance<TData>()
  const metadata = useViewMetadata<TData>()

  // ─── VIEW STORE ─────────────────────────────────────────────────────────────
  const views = useViewStore((state) => state.viewsByTableId[config.tableId] ?? EMPTY_VIEWS)
  const activeViewId = useViewStore((state) => state.activeViewIds[config.tableId])
  const setActiveView = useViewStore((state) => state.setActiveView)
  const isLoadingViews = !useViewStore((state) => state.initialized)

  // Get current view
  const currentView = useMemo(() => {
    if (!activeViewId) return null
    return views.find((v) => v.id === activeViewId) ?? null
  }, [activeViewId, views])

  // ─── TABLE UI STORE ─────────────────────────────────────────────────────────
  // Get saved and pending configs separately
  const savedUIConfig = useTableUIStore((state) =>
    activeViewId ? state.viewConfigs[activeViewId] : state.sessionConfigs[config.tableId]
  )
  const pendingUIConfig = useTableUIStore((state) =>
    activeViewId ? state.pendingConfigs[activeViewId] : undefined
  )

  // Merge configs in useMemo
  const uiConfig = useMemo(() => {
    if (!savedUIConfig) return null
    if (!pendingUIConfig) return savedUIConfig
    return { ...savedUIConfig, ...pendingUIConfig }
  }, [savedUIConfig, pendingUIConfig])

  const updateViewConfig = useTableUIStore((state) => state.updateViewConfig)
  const updateSessionConfig = useTableUIStore((state) => state.updateSessionConfig)
  const resetToSaved = useTableUIStore((state) => state.resetToSaved)
  const markClean = useTableUIStore((state) => state.markClean)

  // Extract UI config values with stable references
  const columnLabels = uiConfig?.columnLabels ?? EMPTY_COLUMN_LABELS
  const columnFormatting = uiConfig?.columnFormatting ?? EMPTY_COLUMN_FORMATTING
  const pinnedColumnId = uiConfig?.columnPinning?.left?.[0] ?? null

  // ─── FILTER STORE ───────────────────────────────────────────────────────────
  const filters = useFilterStore((state) =>
    activeViewId ? (state.viewFilters[activeViewId] ?? EMPTY_FILTERS) : (state.sessionFilters[config.tableId] ?? EMPTY_FILTERS)
  )
  const setFiltersInStore = useFilterStore((state) => state.setFilters)

  // ─── STABLE CALLBACKS ───────────────────────────────────────────────────────
  const handleSetActiveView = useCallback(
    (viewId: string | null) => {
      setActiveView(config.tableId, viewId)
    },
    [setActiveView, config.tableId]
  )

  const handleSetFilters = useCallback(
    (newFilters: ConditionGroup[]) => {
      if (activeViewId) {
        setFiltersInStore(activeViewId, newFilters)
      }
    },
    [activeViewId, setFiltersInStore]
  )

  const handleSetColumnLabel = useCallback(
    (columnId: string, label: string | null) => {
      const updates = label ? { columnLabels: { ...columnLabels, [columnId]: label } } : (() => {
        const { [columnId]: _, ...rest } = columnLabels
        return { columnLabels: rest }
      })()

      if (activeViewId) {
        updateViewConfig(activeViewId, updates)
      } else {
        updateSessionConfig(config.tableId, updates)
      }
    },
    [activeViewId, columnLabels, config.tableId, updateViewConfig, updateSessionConfig]
  )

  const handleSetColumnFormatting = useCallback(
    (columnId: string, formatting: ColumnFormatting | null) => {
      const updates = formatting
        ? { columnFormatting: { ...columnFormatting, [columnId]: formatting } }
        : (() => {
            const { [columnId]: _, ...rest } = columnFormatting
            return { columnFormatting: rest }
          })()

      if (activeViewId) {
        updateViewConfig(activeViewId, updates)
      } else {
        updateSessionConfig(config.tableId, updates)
      }
    },
    [activeViewId, columnFormatting, config.tableId, updateViewConfig, updateSessionConfig]
  )

  const handleSetPinnedColumn = useCallback(
    (columnId: string | null) => {
      const updates = {
        columnPinning: columnId ? { left: [columnId] } : undefined,
      }

      if (activeViewId) {
        updateViewConfig(activeViewId, updates)
      } else {
        updateSessionConfig(config.tableId, updates)
      }
    },
    [activeViewId, config.tableId, updateViewConfig, updateSessionConfig]
  )

  const handleResetViewChanges = useCallback(() => {
    if (activeViewId) {
      resetToSaved(activeViewId)
    }
    if (resetViewChanges) {
      resetViewChanges()
    }
  }, [activeViewId, resetToSaved, resetViewChanges])

  const handleMarkViewClean = useCallback(() => {
    if (activeViewId) {
      markClean(activeViewId)
    }
  }, [activeViewId, markClean])

  // ─── RETURN VALUE ───────────────────────────────────────────────────────────
  return useMemo(
    () => ({
      // Table instance
      table,

      // Config
      tableId: config.tableId,
      enableFiltering: config.enableFiltering,
      enableSorting: config.enableSorting,
      enableSearch: config.enableSearch,
      enableBulkActions: config.enableBulkActions,
      enableImport: config.enableImport,
      showFooter: config.showFooter,
      hideToolbar: config.hideToolbar,
      enableCheckbox: config.enableCheckbox,
      showRowNumbers: config.showRowNumbers,
      entityDefinitionId: config.entityDefinitionId,

      // Metadata
      selectFields: metadata.selectFields as SelectField[],
      customFields: metadata.customFields,
      entityLabel: metadata.entityLabel,
      onAddNew: metadata.onAddNew,

      // Kanban
      onCardClick: metadata.onCardClick,
      onAddCard: metadata.onAddCard,
      selectedKanbanCardIds: metadata.selectedKanbanCardIds,
      onSelectedKanbanCardIdsChange: metadata.onSelectedKanbanCardIdsChange,

      // State
      views,
      currentView,
      isLoadingViews,
      isSavingView: isSavingView ?? false,
      hasUnsavedViewChanges: hasUnsavedViewChanges ?? false,
      saveCurrentView: saveCurrentView ?? (async () => {}),
      resetViewChanges: handleResetViewChanges,
      markViewClean: handleMarkViewClean,
      isLoading: config.isLoading,
      searchQuery: searchQuery ?? '',
      filters,
      columnLabels,
      columnFormatting,
      pinnedColumnId,

      // Actions
      setSearchQuery: setSearchQuery ?? (() => {}),
      setActiveView: handleSetActiveView,
      setFilters: handleSetFilters,
      setColumnLabel: handleSetColumnLabel,
      setColumnFormatting: handleSetColumnFormatting,
      setPinnedColumn: handleSetPinnedColumn,

      // Callbacks
      onRowClick: config.onRowClick,
      onImport: config.onImport,
      importHref: config.importHref,
      onRefresh: config.onRefresh,
      onScrollToBottom: config.onScrollToBottom,
      bulkActions: config.bulkActions,

      // Utilities
      rowClassName: config.rowClassName,

      // Footer
      footerElement: config.footerElement,

      // Custom components
      bulkActionBarElement: config.bulkActionBarElement,
      tableToolbarElement: config.tableToolbarElement,
      customFilter: config.customFilter,
      headerActions: config.headerActions,

      emptyState: config.emptyState,

      // Drag and drop
      dragDropConfig: config.dragDropConfig,
      activeDragItems: metadata.activeDragItems,
      setActiveDragItems: metadata.setActiveDragItems,

      // Debug
      debug: config.debug,
    }),
    [
      table,
      config,
      metadata,
      views,
      currentView,
      isLoadingViews,
      isSavingView,
      hasUnsavedViewChanges,
      saveCurrentView,
      handleResetViewChanges,
      handleMarkViewClean,
      searchQuery,
      setSearchQuery,
      filters,
      columnLabels,
      columnFormatting,
      pinnedColumnId,
      handleSetActiveView,
      handleSetFilters,
      handleSetColumnLabel,
      handleSetColumnFormatting,
      handleSetPinnedColumn,
    ]
  )
}
