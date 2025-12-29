// apps/web/src/components/dynamic-table/index.tsx
'use client'

// Re-export types and utilities for convenience
export type {
  DynamicTableProps,
  ExtendedColumnDef,
  TableFilter,
  TableView,
  ViewConfig,
  ViewType,
  KanbanViewConfig,
  BulkAction,
  RowSelectionFeatures,
  FilterOperator,
  TextFilterOperator,
  NumberFilterOperator,
  DateFilterOperator,
  BooleanFilterOperator,
  ColumnTypeConfig,
  FilterOperatorConfig,
  SortOption,
  CellAction,
  ViewAction,
  DragDropConfig,
  CellSelectionState,
  CellSelectionConfig,
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  NumberColumnFormatting,
  FormattableFieldType,
} from './types'

export { DynamicView } from './dynamic-view'

export {
  FILTER_OPERATORS,
  COLUMN_TYPE_CONFIGS,
  SORT_OPTIONS,
  COLUMN_TYPE_ICONS,
  ROW_HEIGHT,
  DEFAULT_COLUMN_WIDTHS,
} from './utils/constants'

export { useDynamicTable } from './hooks/use-dynamic-table'
export { useTableContext } from './context/table-context'
export { useCellSelection } from './context/cell-selection-context'
export { DynamicTableFooter, DefaultFooterContent } from './components/dynamic-table-footer'
export { BulkActionBar } from './components/bulk-action-bar'
export { TableToolbar } from './components/table-toolbar'
export { DropIndicator } from './components/drop-indicator'
export { DragPreview } from './components/drag-preview'
export { FormattedCell, CellPadding, type CellConfig } from './components/formatted-cell'
export { CustomFieldCell } from './components/custom-field-cell'
export { CopyableLinkCell } from './components/copyable-link-cell'

// Cell renderers and utilities
export {
  renderCellValue,
  renderDateValue,
  renderTimeValue,
  renderNumberValue,
  renderCurrencyValue,
  renderEmailValue,
  renderPhoneValue,
  renderUrlValue,
  renderCheckboxValue,
  renderAddressValue,
  renderRichTextValue,
  renderFileValue,
  renderTextValue,
  EmptyCell,
  getRenderer,
} from './utils/cell-renderers'

// Column helpers
export {
  createDateColumn,
  createCurrencyColumn,
  createNumberColumn,
  createEmailColumn,
  createPhoneColumn,
  createUrlColumn,
  createTextColumn,
} from './utils/column-helpers'

// Custom field column factory (for syncer-based custom field columns)
export {
  createCustomFieldColumns,
  mapFieldTypeToColumnType,
  getIconForFieldType,
  type CustomFieldColumnOptions,
} from './custom-field-column-factory'

import { useDynamicTable } from './hooks/use-dynamic-table'
import { useCellNavigation } from './hooks/use-cell-navigation'
import { TableToolbar } from './components/table-toolbar'
import { VirtualTableBody } from './components/virtual-table-body'
import { HeaderCellWrapper } from './components/header-cell-wrapper'
import { CheckboxHeaderCell } from './components/checkbox-header-cell'
import { TableProvider, useTableContext } from './context/table-context'
import { CellSelectionProvider, useCellSelection } from './context/cell-selection-context'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import type { DynamicTableProps } from './types'
import { useRef, useMemo, Children, isValidElement } from 'react'
import './styles/table.css'
import { Button } from '@auxx/ui/components/button'
import { X } from 'lucide-react'
import { ColumnDndProvider } from './components/column-dnd-provider'
import { RowDndProvider } from './components/row-dnd-provider'

/**
 * Inner table component that uses context
 */
function DynamicTableInner<TData extends object = object>() {
  const {
    table,
    isLoadingViews,
    isLoading,
    showFooter = false,
    hideToolbar = false,
    enableBulkActions,
    bulkActions = [],
    onRowClick,
    rowClassName,
    footerElement,
    bulkActionBarElement,
    tableToolbarElement,
    emptyState,
    headerActions,
    dragDropConfig,
    activeDragItems,
    setActiveDragItems,
    debug,
  } = useTableContext<TData>()

  // Cell selection from separate context for performance
  const { selectedCell, setSelectedCell, editingCell, setEditingCell, cellSelectionConfig } =
    useCellSelection()

  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Cell navigation hook - must be in DynamicTableInner where scrollContainerRef is defined
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

  return (
    <>
      <div ref={scrollContainerRef} className="flex flex-col relative h-full flex-1 overflow-auto">
        {/* Toolbar or Bulk Actions Bar */}
        {!hideToolbar && (
          <div className="sticky top-0 z-20 bg-background left-0">
            {showBulkActionsBar
              ? bulkActionBarElement || (
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
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => table.resetRowSelection()}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              : tableToolbarElement || <TableToolbar />}
          </div>
        )}

        {/* Table */}
        <div className="">
          <div className="max-w-full pl-0">
            <div
              ref={containerRef}
              className="min-w-full"
              style={{ width: `${table.getTotalSize()}px` }}>
              {/* Table Header with Column DndContext */}
              <ColumnDndProvider table={table}>
                <div
                  className={cn(
                    'sticky z-21 min-w-full from-white to-white/50 bg-gradient-to-b dark:from-primary-100 dark:to-primary-100/50 backdrop-blur border-b border-primary-200/50',
                    hideToolbar ? 'top-0' : 'top-11'
                  )}>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <div key={headerGroup.id} className="flex min-w-full items-stretch">
                      {/* Render left pinned columns */}
                      {headerGroup.headers
                        .filter((header) => header.column.getIsPinned() === 'left')
                        .map((header) => {
                          const isCheckboxColumn = header.column.id === '_checkbox'

                          if (isCheckboxColumn) {
                            return <CheckboxHeaderCell key={header.id} header={header} />
                          }

                          return (
                            <div
                              key={header.id}
                              className="sticky shrink-0 z-30 backdrop-blur bg-background/40"
                              style={{ left: header.column.getStart('left') }}>
                              <HeaderCellWrapper header={header} />
                            </div>
                          )
                        })}

                      {/* Render center (non-pinned) columns */}
                      {headerGroup.headers
                        .filter((header) => !header.column.getIsPinned())
                        .map((header) => {
                          const isCheckboxColumn = header.column.id === '_checkbox'

                          if (isCheckboxColumn) {
                            return <CheckboxHeaderCell key={header.id} header={header} />
                          }

                          return <HeaderCellWrapper key={header.id} header={header} />
                        })}

                      {/* Header Actions (e.g., add column button) - positioned sticky to stay visible on scroll */}
                      {headerActions && (
                        <div className="sticky right-0 h-10 flex items-center bg-gradient-to-r from-transparent via-white to-white dark:via-primary-100 dark:to-primary-100">
                          {headerActions}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ColumnDndProvider>

              {/* Table Body with Row DndContext */}
              <RowDndProvider>
                <div className="relative block flex-1 h-full">
                  {(isLoading && table.getRowModel().rows?.length === 0) || isLoadingViews ? (
                    // Loading state
                    Array.from({ length: 5 }).map((_, index) => (
                      <div
                        key={index}
                        className="flex min-w-full items-stretch border-b border-primary-200/50">
                        {table.getAllColumns().map((column) => (
                          <div
                            key={column.id}
                            className="px-3 py-2 flex items-center"
                            style={{ width: column.getSize() }}>
                            <Skeleton className="h-4 w-full" />
                          </div>
                        ))}
                      </div>
                    ))
                  ) : table.getRowModel().rows?.length ? (
                    // Virtual table body with data rows
                    <VirtualTableBody
                      table={table}
                      containerRef={containerRef}
                      scrollContainerRef={scrollContainerRef}
                      dragDropConfig={dragDropConfig}
                      cellSelectionEnabled={cellSelectionConfig?.enabled}
                    />
                  ) : null}
                </div>
              </RowDndProvider>
            </div>
          </div>

          {!isLoading &&
            !isLoadingViews &&
            table.getRowModel().rows?.length == 0 &&
            (emptyState ? (
              <div className="inset-0 absolute flex flex-1 min-h-0 flex-col">{emptyState}</div>
            ) : (
              <div className="flex min-w-full items-stretch border-b border-primary-200/50">
                <div
                  className="px-3 py-12 text-center text-muted-foreground"
                  style={{ width: '100%' }}>
                  No results.
                </div>
              </div>
            ))}
        </div>

        <div className="grow"></div>
        {/* Footer - render children footer if provided, otherwise default */}
        {footerElement && footerElement}
      </div>
    </>
  )
}

/**
 * Dynamic table component with advanced features
 */
export function DynamicTable<TData extends object = object>(props: DynamicTableProps<TData>) {
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
    modelType,
    entityDefinitionId,
    ...tableProps
  } = props

  // Compute enableBulkActions from bulkActions
  const enableBulkActions = Boolean(bulkActions.length)

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
    selectedCell,
    setSelectedCell,
    editingCell,
    setEditingCell,
  } = tableState


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
      onRowSelectionChange: tableProps.onRowSelectionChange,
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
      getLastSelectedIndex,
      setLastSelectedIndex,
      getLastClickedRowId,
      setLastClickedRowId,
      isBulkMode,
      toggleRowSelection,
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
      selectFields,
      modelType,
      entityDefinitionId,
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
      getLastSelectedIndex,
      setLastSelectedIndex,
      getLastClickedRowId,
      setLastClickedRowId,
      isBulkMode,
      toggleRowSelection,
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
      selectFields,
      modelType,
      entityDefinitionId,
    ]
  )

  // Cell selection context value - separate for performance (avoids re-rendering entire table on selection change)
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

  return (
    // <TableErrorBoundary>
    <TableProvider value={contextValue}>
      <CellSelectionProvider value={cellSelectionContextValue}>
        <div className={cn('flex-1', className)}>
          <DynamicTableInner<TData> />
        </div>
      </CellSelectionProvider>
    </TableProvider>
    //</TableErrorBoundary>
  )
}
