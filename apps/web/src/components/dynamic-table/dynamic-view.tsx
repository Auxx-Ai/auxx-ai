// apps/web/src/components/dynamic-table/dynamic-view.tsx
'use client'

import { useMemo, useRef, Children, isValidElement, useState, useCallback, type RefObject } from 'react'
import { useDynamicTable } from './hooks/use-dynamic-table'
import { useCellNavigation } from './hooks/use-cell-navigation'
import { TableToolbar } from './components/table-toolbar'
import { TableBody } from './components/table-body'
import { KanbanViewBody } from './components/kanban-view-body'
import { FloatingBulkActionBar } from './components/floating-bulk-action-bar'
import { TableContentSkeleton } from './components/table-content-skeleton'
import { ToolbarSkeleton } from './components/toolbar-skeleton'
import { TableProvider, useTableContext } from './context/table-context'
import { CellSelectionProvider, useCellSelection } from './context/cell-selection-context'
import { RowSelectionProvider } from './context/row-selection-context'
import { useViewStoreInitialized } from './stores/view-store'
import { cn } from '@auxx/ui/lib/utils'
import type { DynamicTableProps, ViewType, KanbanViewConfig, ViewConfig, CellSelectionState } from './types'
import { Button } from '@auxx/ui/components/button'
import { X } from 'lucide-react'
import './styles/table.css'

/**
 * Inner component that renders toolbar + view body.
 * Uses context for all state and determines view type.
 */
function DynamicViewInner<TData extends object>() {
  const {
    table,
    isLoadingViews,
    isLoading,
    showFooter = false,
    hideToolbar = false,
    enableBulkActions,
    enableCheckbox,
    enableSearch,
    bulkActions = [],
    footerElement,
    bulkActionBarElement,
    tableToolbarElement,
    currentView,
    selectFields,
  } = useTableContext<TData>()

  // View store initialization state
  const isViewsLoaded = useViewStoreInitialized()

  // Cell selection from separate context for performance
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

  const tableState = table.getState()
  const selectedRows = useMemo(
    () => table.getFilteredSelectedRowModel().rows,
    [table, tableState.columnFilters, tableState.globalFilter, tableState.rowSelection]
  )
  const showBulkActionsBar = Boolean(enableBulkActions && selectedRows.length > 0)

  // Determine view type from current view config
  const viewType: ViewType = (currentView?.config as ViewConfig)?.viewType ?? 'table'
  const kanbanConfig: KanbanViewConfig | undefined = (currentView?.config as ViewConfig)?.kanban

  // Get groupBy field for kanban validation
  const groupByField = useMemo(() => {
    if (!kanbanConfig?.groupByFieldId || !selectFields) return null
    return selectFields.find((f) => f.id === kanbanConfig.groupByFieldId) ?? null
  }, [kanbanConfig?.groupByFieldId, selectFields])

  // Check if kanban view is valid (has required config)
  const isKanbanView = viewType === 'kanban' && !!groupByField

  // Determine if we have any data
  const rowCount = table.getRowModel().rows.length
  const hasData = rowCount > 0

  // Unified initial loading state:
  // - Views not loaded yet, OR
  // - Loading data AND no existing data to show
  const isInitialLoading = !isViewsLoaded || (isLoading && !hasData)

  return (
    <div ref={scrollContainerRef} className="flex flex-col relative h-full flex-1 overflow-auto">
      {/* Toolbar - always renders structure, content may be skeleton */}
      {!hideToolbar && (
        <div className="sticky top-0 z-20 bg-background left-0">
          {showBulkActionsBar ? (
            bulkActionBarElement || (
              <div className="">
                <div className="flex @container/controls items-row items-center gap-1.5 py-2 px-3 bg-background overflow-hidden">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="info"
                      size="sm"
                      onClick={() => table.toggleAllRowsSelected(false)}>
                      <X />
                      {selectedRows.length} selected
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
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
                          size="sm"
                          variant={action.variant || 'default'}>
                          {Icon && <Icon />}
                          {action.label}
                        </Button>
                      )
                    })}
                    <Button variant="outline" size="sm" onClick={() => table.resetRowSelection()}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )
          ) : isViewsLoaded ? (
            tableToolbarElement || <TableToolbar />
          ) : (
            <ToolbarSkeleton showSearch={enableSearch} />
          )}
        </div>
      )}

      {/* Content - skeleton or real table */}
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

      {/* Inline loading indicator for subsequent loads (filter changes, etc.) */}
      {!isInitialLoading && isLoading && hasData && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center pointer-events-none z-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-background px-3 py-2 rounded-md shadow-sm">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>Loading...</span>
          </div>
        </div>
      )}

      {/* Footer - only show when loaded */}
      {!isInitialLoading && footerElement}

      {/* Floating Bulk Action Bar - rendered via portal, shown alongside inline bar */}
      {showBulkActionsBar && bulkActions.length > 0 && !bulkActionBarElement && (
        <FloatingBulkActionBar
          selectedRows={selectedRows}
          bulkActions={bulkActions}
          onClearSelection={() => table.resetRowSelection()}
        />
      )}
    </div>
  )
}

/**
 * DynamicView - Unified component for table and kanban views.
 * Single entry point that handles context setup and view switching.
 *
 * This component replaces both DynamicTable and the old DynamicView.
 * The toolbar is always rendered and works for both views.
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
    selectFields,
    customFields,
    primaryFieldId,
    entityLabel,
    onCardClick,
    onAddCard,
    selectedKanbanCardIds: controlledSelectedCardIds,
    onSelectedKanbanCardIdsChange,
    modelType,
    entityDefinitionId,
    resourceType,
    ...tableProps
  } = props

  // Compute enableBulkActions from bulkActions
  const enableBulkActions = Boolean(bulkActions.length)

  // Get table state from hook
  const tableState = useDynamicTable({ ...tableProps, bulkActions })

  const {
    table: tableInstance,
    views,
    currentView,
    isLoadingViews,
    isSavingView,
    hasUnsavedViewChanges,
    saveCurrentView,
    resetViewChanges,
    markViewClean,
    searchQuery,
    setSearchQuery,
    setActiveView,
    columnTypes,
    filters,
    setFilters,
    columnLabels,
    setColumnLabel,
    columnFormatting,
    setColumnFormatting,
    pinnedColumnId,
    setPinnedColumn,
    getLastSelectedIndex,
    setLastSelectedIndex,
    getLastClickedRowId,
    setLastClickedRowId,
    enableCheckbox,
    showRowNumbers,
    isBulkMode,
    toggleRowSelection,
    activeDragItems,
    setActiveDragItems,
  } = tableState

  // Cell selection state - kept in DynamicView for CellSelectionContext
  const [selectedCell, setSelectedCell] = useState<CellSelectionState | null>(null)
  const [editingCell, setEditingCell] = useState<CellSelectionState | null>(null)

  // Internal kanban selection state (used when not controlled)
  const [internalSelectedCardIds, setInternalSelectedCardIds] = useState<Set<string>>(new Set())
  const selectedKanbanCardIds = controlledSelectedCardIds ?? internalSelectedCardIds
  const setSelectedKanbanCardIds = onSelectedKanbanCardIdsChange ?? setInternalSelectedCardIds

  // Extract specific components from children
  let footerElement: React.ReactNode = null
  let hasFooter = false
  let bulkActionBarElement: React.ReactNode = null
  let tableToolbarElement: React.ReactNode = null

  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type) {
      const displayName = (child.type as any).displayName || (child.type as any).name

      if (displayName === 'DynamicTableFooter') {
        footerElement = child
        hasFooter = true
      } else if (displayName === 'BulkActionBar') {
        bulkActionBarElement = child
      } else if (displayName === 'TableToolbar') {
        tableToolbarElement = child
      }
    }
  })

  // Getter for isBulkMode - uses ref pattern for truly stable reference
  const isBulkModeRef = useRef(isBulkMode)
  isBulkModeRef.current = isBulkMode
  const getIsBulkMode = useCallback(() => isBulkModeRef.current, [])

  // Build context value with all props including kanban
  const contextValue = useMemo(
    () => ({
      table: tableInstance,
      views,
      currentView: currentView ?? null,
      isLoadingViews,
      isSavingView,
      hasUnsavedViewChanges,
      saveCurrentView,
      resetViewChanges,
      markViewClean,
      tableId: tableProps.tableId,
      enableFiltering: tableProps.enableFiltering,
      enableSorting: tableProps.enableSorting,
      enableSearch: tableProps.enableSearch,
      enableBulkActions,
      enableImport: Boolean(tableProps.onImport) || Boolean(tableProps.importHref),
      importHref: tableProps.importHref,
      showFooter: hasFooter || showFooter,
      hideToolbar,
      enableCheckbox,
      showRowNumbers,
      bulkActions,
      onRowClick,
      onImport: tableProps.onImport,
      onRefresh: tableProps.onRefresh,
      onScrollToBottom: tableProps.onScrollToBottom,
      rowClassName,
      isLoading,
      searchQuery,
      setSearchQuery,
      setActiveView,
      columnTypes,
      filters,
      setFilters,
      columnLabels,
      setColumnLabel,
      columnFormatting,
      setColumnFormatting,
      pinnedColumnId,
      setPinnedColumn,
      footerElement,
      bulkActionBarElement,
      tableToolbarElement,
      customFilter,
      emptyState,
      headerActions,
      dragDropConfig: props.dragDrop,
      activeDragItems,
      setActiveDragItems,
      debug: props.debug,
      // Kanban-specific props
      selectFields,
      customFields,
      primaryFieldId,
      entityLabel,
      onCardClick,
      onAddCard,
      modelType,
      entityDefinitionId,
      resourceType,
      selectedKanbanCardIds,
      onSelectedKanbanCardIdsChange: setSelectedKanbanCardIds,
    }),
    [
      tableInstance,
      views,
      currentView,
      isLoadingViews,
      isSavingView,
      hasUnsavedViewChanges,
      saveCurrentView,
      resetViewChanges,
      markViewClean,
      tableProps.tableId,
      tableProps.enableFiltering,
      tableProps.enableSorting,
      tableProps.enableSearch,
      enableBulkActions,
      tableProps.onImport,
      tableProps.importHref,
      hasFooter,
      showFooter,
      hideToolbar,
      enableCheckbox,
      showRowNumbers,
      bulkActions,
      onRowClick,
      tableProps.onRefresh,
      tableProps.onRowSelectionChange,
      tableProps.onScrollToBottom,
      rowClassName,
      isLoading,
      searchQuery,
      setSearchQuery,
      setActiveView,
      columnTypes,
      filters,
      setFilters,
      columnLabels,
      setColumnLabel,
      columnFormatting,
      setColumnFormatting,
      pinnedColumnId,
      setPinnedColumn,
      footerElement,
      bulkActionBarElement,
      tableToolbarElement,
      customFilter,
      emptyState,
      headerActions,
      props.dragDrop,
      activeDragItems,
      setActiveDragItems,
      props.debug,
      // Kanban deps
      selectFields,
      customFields,
      primaryFieldId,
      entityLabel,
      onCardClick,
      onAddCard,
      modelType,
      entityDefinitionId,
      resourceType,
      selectedKanbanCardIds,
      setSelectedKanbanCardIds,
    ]
  )

  // Cell selection context value - separate for performance
  const cellSelectionContextValue = useMemo(
    () => ({
      selectedCell,
      setSelectedCell,
      editingCell,
      setEditingCell,
      cellSelectionConfig: cellSelection,
    }),
    [selectedCell, setSelectedCell, editingCell, setEditingCell, cellSelection]
  )

  // Row selection context value - separate for performance
  const rowSelectionContextValue = useMemo(
    () => ({
      enableCheckbox,
      isBulkMode,
      getIsBulkMode,
      toggleRowSelection,
      getLastSelectedIndex,
      setLastSelectedIndex,
      getLastClickedRowId,
      setLastClickedRowId,
      bulkActions,
      onRowSelectionChange: tableProps.onRowSelectionChange,
    }),
    [
      enableCheckbox,
      isBulkMode,
      getIsBulkMode,
      toggleRowSelection,
      getLastSelectedIndex,
      setLastSelectedIndex,
      getLastClickedRowId,
      setLastClickedRowId,
      bulkActions,
      tableProps.onRowSelectionChange,
    ]
  )

  return (
    <TableProvider value={contextValue}>
      <RowSelectionProvider value={rowSelectionContextValue}>
        <CellSelectionProvider value={cellSelectionContextValue}>
          <div className={cn('flex-1', className)}>
            <DynamicViewInner<TData> />
          </div>
        </CellSelectionProvider>
      </RowSelectionProvider>
    </TableProvider>
  )
}
