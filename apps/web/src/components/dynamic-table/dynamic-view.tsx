// apps/web/src/components/dynamic-table/dynamic-view.tsx
'use client'

import { useMemo, useRef, Children, isValidElement, useState, useCallback } from 'react'
import { useDynamicTable } from './hooks/use-dynamic-table'
import { useCellNavigation } from './hooks/use-cell-navigation'
import { TableToolbar } from './components/table-toolbar'
import { TableBody } from './components/table-body'
import { KanbanViewBody } from './components/kanban-view-body'
import { FloatingBulkActionBar } from './components/floating-bulk-action-bar'
import { TableContentSkeleton } from './components/table-content-skeleton'
import { ToolbarSkeleton } from './components/toolbar-skeleton'
import { TableConfigProvider, useTableConfig } from './context/table-config-context'
import { TableInstanceProvider, useTableInstance } from './context/table-instance-context'
import { ViewMetadataProvider, useViewMetadata } from './context/view-metadata-context'
import { CellSelectionConfigProvider, useCellSelection } from './context/cell-selection-context'
import { useViewStore } from './stores/view-store'
import { cn } from '@auxx/ui/lib/utils'
import type {
  DynamicTableProps,
  ViewType,
  KanbanViewConfig,
  ViewConfig,
  CellSelectionState,
  ResourceField,
  CustomField,
} from './types'
import { useResourceFields } from '~/components/resources/hooks'
import './styles/table.css'

/**
 * Inner component that renders toolbar + view body.
 * Uses focused contexts for state access.
 */
function DynamicViewInner<TData extends object>({
  searchQuery,
  setSearchQuery,
  isSavingView,
  hasUnsavedViewChanges,
  saveCurrentView,
  resetViewChanges,
}: {
  searchQuery: string
  setSearchQuery: (query: string) => void
  isSavingView: boolean
  hasUnsavedViewChanges: boolean
  saveCurrentView?: () => void
  resetViewChanges?: () => void
}) {
  // Access focused contexts
  const {
    tableId,
    enableCheckbox,
    enableSearch,
    bulkActions = [],
    footerElement,
    isLoading,
    hideToolbar = false,
  } = useTableConfig<TData>()

  const { table } = useTableInstance<TData>()

  const { selectFields, selectedKanbanCardIds, onSelectedKanbanCardIdsChange } =
    useViewMetadata<TData>()

  console.log('selectFields', selectFields)
  // View store state
  const isViewsLoaded = useViewStore((state) => state.initialized)

  // Cell selection from separate context
  const { selectedCell, setSelectedCell, editingCell, setEditingCell, cellSelectionConfig } =
    useCellSelection()

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Cell navigation hook
  useCellNavigation({
    table,
    selectedCell,
    setSelectedCell,
    editingCell,
    setEditingCell,
    enabled: cellSelectionConfig?.enabled ?? false,
    scrollContainerRef,
  })

  // Get current view from store
  const currentView = useViewStore((state) => {
    const activeViewId = state.activeViewIds[tableId]
    if (!activeViewId) return null
    const views = state.viewsByTableId[tableId] ?? []
    return views.find((v) => v.id === activeViewId) ?? null
  })

  // Determine view type
  const viewType: ViewType = (currentView?.config as ViewConfig)?.viewType ?? 'table'
  const kanbanConfig: KanbanViewConfig | undefined = (currentView?.config as ViewConfig)?.kanban

  // Get groupBy field for kanban validation
  const groupByField = useMemo(() => {
    if (!kanbanConfig?.groupByFieldId || !selectFields) return null
    return selectFields.find((f) => f.id === kanbanConfig.groupByFieldId) ?? null
  }, [kanbanConfig?.groupByFieldId, selectFields])

  // Check if kanban view is valid
  const isKanbanView = viewType === 'kanban' && !!groupByField

  // Table-selected rows (for table view)
  const tableState = table.getState()
  const tableSelectedRows = useMemo(
    () => table.getFilteredSelectedRowModel().rows,
    [table, tableState.columnFilters, tableState.globalFilter, tableState.rowSelection]
  )

  // Kanban-selected data
  const kanbanSelectedData = useMemo(() => {
    if (!selectedKanbanCardIds || selectedKanbanCardIds.size === 0) return []
    const allData = table.getRowModel().rows.map((r) => r.original)
    return allData.filter((item) => selectedKanbanCardIds.has((item as { id: string }).id))
  }, [selectedKanbanCardIds, table])

  // Unified selected data based on view type
  const selectedData = useMemo(() => {
    return isKanbanView ? kanbanSelectedData : tableSelectedRows.map((r) => r.original)
  }, [isKanbanView, kanbanSelectedData, tableSelectedRows])

  // Unified clear selection handler
  const handleClearSelection = useCallback(() => {
    if (isKanbanView) {
      onSelectedKanbanCardIdsChange?.(new Set())
    } else {
      table.resetRowSelection()
    }
  }, [isKanbanView, onSelectedKanbanCardIdsChange, table])

  // Determine if we have any data
  const rowCount = table.getRowModel().rows.length
  const hasData = rowCount > 0

  // Unified initial loading state
  const isInitialLoading = !isViewsLoaded || (isLoading && !hasData)

  console.log('DynamicViewInner render', { rowCount, selectedData })
  return (
    <div ref={scrollContainerRef} className="flex flex-col relative h-full flex-1 overflow-auto">
      {/* Toolbar */}
      {!hideToolbar && (
        <div className="sticky top-0 z-20 bg-background left-0">
          {isViewsLoaded ? (
            <TableToolbar
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isSavingView={isSavingView}
              hasUnsavedViewChanges={hasUnsavedViewChanges}
              saveCurrentView={saveCurrentView}
              resetViewChanges={resetViewChanges}
            />
          ) : (
            <ToolbarSkeleton showSearch={enableSearch} />
          )}
        </div>
      )}

      {/* Content */}
      {isInitialLoading ? (
        <TableContentSkeleton rowCount={12} showCheckbox={enableCheckbox} columnCount={5} />
      ) : isKanbanView ? (
        <KanbanViewBody />
      ) : (
        <>
          <TableBody hideToolbar={hideToolbar} scrollContainerRef={scrollContainerRef} />
          <div className="grow" />
        </>
      )}

      {/* Inline loading indicator */}
      {!isInitialLoading && isLoading && hasData && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center pointer-events-none z-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-background px-3 py-2 rounded-md shadow-sm">
            <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>Loading...</span>
          </div>
        </div>
      )}

      {/* Footer */}
      {!isInitialLoading && !isKanbanView && footerElement}

      {/* Floating Bulk Action Bar */}
      {bulkActions.length > 0 && (
        <FloatingBulkActionBar
          selectedData={selectedData}
          bulkActions={bulkActions}
          onClearSelection={handleClearSelection}
        />
      )}
    </div>
  )
}

/**
 * DynamicView - NEW IMPLEMENTATION using focused contexts.
 * Replaces the massive 60+ property context with 3 focused contexts.
 */
export function DynamicView<TData extends object = object>(props: DynamicTableProps<TData>) {
  const {
    className,
    customFilter,
    showFooter = false,
    hideToolbar = false,
    bulkActions = [],
    onRowClick,
    rowClassName,
    isLoading = false,
    children,
    emptyState = null,
    headerActions,
    cellSelection,
    entityLabel,
    onAddNew,
    onCardClick,
    onAddCard,
    selectedKanbanCardIds: controlledSelectedCardIds,
    onSelectedKanbanCardIdsChange,
    entityDefinitionId,
    ...tableProps
  } = props

  // Compute enableBulkActions from bulkActions
  const enableBulkActions = Boolean(bulkActions.length)

  // Derive selectFields and customFields from entityDefinitionId
  const { fields } = useResourceFields(entityDefinitionId)

  const selectFields = useMemo(() => {
    if (!fields) return []
    return fields
      .filter(
        (f): f is ResourceField & { id: string } =>
          !!f.id && f.fieldType === 'SINGLE_SELECT' && f.active !== false
      )
      .map((f) => ({
        id: f.id,
        name: f.name ?? f.label,
        options: f.options as { options?: Array<{ id: string; label: string; color?: string }> },
      }))
  }, [fields])

  const customFields = useMemo(() => {
    if (!fields) return []
    return fields.filter((f): f is CustomField => !!f.id)
  }, [fields])

  // Get table state from NEW hook
  const tableState = useDynamicTable({ ...tableProps, bulkActions })

  const {
    table: tableInstance,
    isSavingView,
    hasUnsavedViewChanges,
    saveCurrentView,
    resetViewChanges,
    searchQuery,
    setSearchQuery,
    enableCheckbox,
    showRowNumbers,
    activeDragItems,
    setActiveDragItems,
  } = tableState

  // Cell selection state - now managed by Zustand store via useCellSelection hook
  // Remove local state, as the new architecture uses selection-store

  // Internal kanban selection state
  const [internalSelectedCardIds, setInternalSelectedCardIds] = useState<Set<string>>(new Set())
  const selectedKanbanCardIds = controlledSelectedCardIds ?? internalSelectedCardIds
  const setSelectedKanbanCardIds = onSelectedKanbanCardIdsChange ?? setInternalSelectedCardIds

  // Extract specific components from children
  let footerElement: React.ReactNode = null
  let hasFooter = false

  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type) {
      const displayName = (child.type as any).displayName || (child.type as any).name

      if (displayName === 'DynamicTableFooter') {
        footerElement = child
        hasFooter = true
      }
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD FOCUSED CONTEXT VALUES (3 contexts instead of 1 massive context)
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. CONFIG CONTEXT - Static configuration (~15 props, rarely changes)
  const configValue = useMemo(
    () => ({
      tableId: tableProps.tableId,
      entityDefinitionId,
      enableFiltering: tableProps.enableFiltering,
      enableSorting: tableProps.enableSorting,
      enableSearch: tableProps.enableSearch,
      enableCheckbox,
      showRowNumbers,
      enableBulkActions,
      enableImport: Boolean(tableProps.onImport) || Boolean(tableProps.importHref),
      importHref: tableProps.importHref,
      showFooter: hasFooter || showFooter,
      hideToolbar,
      bulkActions,
      onRowClick,
      onImport: tableProps.onImport,
      onRefresh: tableProps.onRefresh,
      onScrollToBottom: tableProps.onScrollToBottom,
      onRowSelectionChange: tableProps.onRowSelectionChange,
      rowClassName,
      isLoading,
      customFilter,
      emptyState,
      headerActions,
      dragDropConfig: props.dragDrop,
      debug: props.debug,
      footerElement,
    }),
    [
      tableProps.tableId,
      entityDefinitionId,
      tableProps.enableFiltering,
      tableProps.enableSorting,
      tableProps.enableSearch,
      enableCheckbox,
      showRowNumbers,
      enableBulkActions,
      tableProps.onImport,
      tableProps.importHref,
      hasFooter,
      showFooter,
      hideToolbar,
      bulkActions,
      onRowClick,
      tableProps.onRefresh,
      tableProps.onScrollToBottom,
      tableProps.onRowSelectionChange,
      rowClassName,
      isLoading,
      customFilter,
      emptyState,
      headerActions,
      props.dragDrop,
      props.debug,
      footerElement,
    ]
  )

  // 2. INSTANCE CONTEXT - Table instance (1 prop, changes when data changes)
  const instanceValue = useMemo(
    () => ({
      table: tableInstance,
    }),
    [tableInstance]
  )

  // 3. METADATA CONTEXT - View/kanban metadata (changes with view switch)
  const metadataValue = useMemo(
    () => ({
      selectFields,
      customFields,
      entityLabel,
      onAddNew,
      onCardClick,
      onAddCard,
      selectedKanbanCardIds,
      onSelectedKanbanCardIdsChange: setSelectedKanbanCardIds,
      activeDragItems,
      setActiveDragItems,
    }),
    [
      selectFields,
      customFields,
      entityLabel,
      onAddNew,
      onCardClick,
      onAddCard,
      selectedKanbanCardIds,
      setSelectedKanbanCardIds,
      activeDragItems,
      setActiveDragItems,
    ]
  )

  // Cell selection config - only static config, state managed by Zustand
  // The useCellSelection() hook in child components will connect to the store

  return (
    <TableConfigProvider value={configValue}>
      <TableInstanceProvider value={instanceValue}>
        <ViewMetadataProvider value={metadataValue}>
          <CellSelectionConfigProvider config={cellSelection}>
            <div className={cn('flex-1', className)}>
              <DynamicViewInner<TData>
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                isSavingView={isSavingView}
                hasUnsavedViewChanges={hasUnsavedViewChanges}
                saveCurrentView={saveCurrentView}
                resetViewChanges={resetViewChanges}
              />
            </div>
          </CellSelectionConfigProvider>
        </ViewMetadataProvider>
      </TableInstanceProvider>
    </TableConfigProvider>
  )
}
