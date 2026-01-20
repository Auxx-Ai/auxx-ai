// apps/web/src/components/dynamic-table/hooks/use-dynamic-table.tsx

'use client'

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type ColumnFiltersState,
  type RowSelectionState,
  type ColumnOrderState,
  type ColumnDef,
  type ColumnPinningState,
} from '@tanstack/react-table'
import { useQueryStates, parseAsString } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import type { DynamicTableProps } from '../types'
import { CheckboxCell } from '../components/checkbox-cell'
import { CheckboxHeaderCell } from '../components/checkbox-header-cell'
import { computeInitialViewConfig } from '../utils/view-config'
import { useDynamicTableStore } from '../stores/dynamic-table-store'
import { useSelectionStore } from '../stores/selection-store'
import {
  useTableViews,
  useActiveView,
  useTableFilters,
  useTableSorting,
  useColumnVisibility,
  useColumnOrder,
  useColumnSizing,
  useColumnPinning,
  useColumnLabels,
  useColumnFormatting,
  useViewStoreInitialized,
} from '../stores/store-selectors'
import { useRowSelection, useActiveDragItems } from '../hooks/use-table-selectors'
import {
  useSetFilters,
  useSetSorting,
  useSetColumnVisibility,
  useSetColumnOrder,
  useSetColumnSizing,
  useSetColumnPinning,
  useSetColumnLabel,
  useSetSingleColumnFormatting,
  useSetPinnedColumn,
} from '../stores/store-actions'
import { useSetRowSelection, useSetActiveDragItems } from '../hooks/use-table-actions'
import { useViewStorePersistence } from './use-view-store-persistence'

/**
 * Main hook for managing dynamic table state.
 * REFACTORED: Now uses unified DynamicTableStore with slices.
 */
export function useDynamicTable<TData extends Record<string, any>>({
  data,
  columns,
  tableId,
  enableFiltering = true,
  enableSorting = true,
  enableSearch = true,
  showRowNumbers = true,
  getRowId,
  onRowSelectionChange,
  rowSelection: controlledRowSelection,
  bulkActions,
  onColumnVisibilityChange,
  standalone = false,
  ...props
}: DynamicTableProps<TData>) {
  // Compute enableCheckbox from bulkActions or onRowSelectionChange
  const enableCheckbox = Boolean(bulkActions?.length) || Boolean(onRowSelectionChange)
  const [urlState, setUrlState] = useQueryStates({
    q: parseAsString,
  })

  // View state is now managed locally instead of in URL
  const [activeViewId, setActiveViewId] = useState<string | null>(null)

  // Get views from unified store
  const views = useTableViews(tableId)
  const isStoreInitialized = useViewStoreInitialized()
  const isLoadingViews = !isStoreInitialized
  const hasUnsavedChanges = useDynamicTableStore((state) => state.hasUnsavedChanges)
  const isSaving = useDynamicTableStore((state) => state.isSaving)
  const setActiveViewInStore = useDynamicTableStore((state) => state.setActiveView)

  // Get current view
  const currentView = useActiveView(tableId)

  // Find default view
  const defaultView = useMemo(() => {
    return views.find((view) => view.isDefault) ?? null
  }, [views])

  // Auto-select default view on mount if no view selected (skip for standalone)
  useEffect(() => {
    // Skip for standalone tables - they don't use views
    if (standalone) return

    // Only run when store is initialized and we have views
    if (!isStoreInitialized || views.length === 0) return

    // If no view selected and default view exists, auto-select it
    if (!activeViewId && defaultView) {
      setActiveViewId(defaultView.id)
    }
  }, [isStoreInitialized, activeViewId, defaultView, views.length, standalone])

  // Sync view ID to store
  useEffect(() => {
    setActiveViewInStore(tableId, activeViewId)
  }, [tableId, activeViewId, setActiveViewInStore])

  // Initialize persistence (handles auto-save when enabled, or manual save)
  const { saveView } = useViewStorePersistence(currentView?.id ?? null, tableId)

  // ═══════════════════════════════════════════════════════════════════════════
  // READ STATE FROM ZUSTAND STORES (NO LOCAL STATE!)
  // ═══════════════════════════════════════════════════════════════════════════

  const filters = useTableFilters(tableId)
  const sorting = useTableSorting(tableId)
  const columnVisibility = useColumnVisibility(tableId)
  const columnOrder = useColumnOrder(tableId)
  const columnSizing = useColumnSizing(tableId)
  const columnPinning = useColumnPinning(tableId)
  const columnLabels = useColumnLabels(tableId) ?? {}
  const columnFormatting = useColumnFormatting(tableId) ?? {}
  const rowSelection = useRowSelection(tableId)
  const activeDragItems = useActiveDragItems(tableId)

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE ACTIONS (USE ACTION HOOKS)
  // ═══════════════════════════════════════════════════════════════════════════

  const setFilters = useSetFilters(tableId)
  const setSorting = useSetSorting(tableId)
  const setColumnVisibility = useSetColumnVisibility(tableId)
  const setColumnOrder = useSetColumnOrder(tableId)
  const setColumnSizing = useSetColumnSizing(tableId)
  const setColumnPinning = useSetColumnPinning(tableId)
  const setRowSelection = useSetRowSelection(tableId)
  const setActiveDragItems = useSetActiveDragItems(tableId)

  // ═══════════════════════════════════════════════════════════════════════════
  // URL STATE & SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  const [globalFilter, setGlobalFilter] = useState(urlState.q ?? '')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  // ═══════════════════════════════════════════════════════════════════════════
  // SPECIAL COLUMN HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  const applySpecialColumnOrder = useCallback(
    (order: ColumnOrderState | undefined): ColumnOrderState => {
      const filtered = (order ?? []).filter((id) => id !== '_checkbox')
      let next = filtered
      if (enableCheckbox) {
        next = ['_checkbox', ...next]
      }
      return next
    },
    [enableCheckbox]
  )

  const resolveColumnPinning = useCallback(
    (pinning?: ColumnPinningState): ColumnPinningState => {
      if (pinning?.left || pinning?.right) {
        return {
          left: pinning.left ? [...pinning.left] : undefined,
          right: pinning.right ? [...pinning.right] : undefined,
        }
      }
      return enableCheckbox ? { left: ['_checkbox'] } : {}
    },
    [enableCheckbox]
  )

  // Apply special column order when it changes
  const displayColumnOrder = useMemo(
    () => applySpecialColumnOrder(columnOrder),
    [columnOrder, applySpecialColumnOrder]
  )

  // Apply special column pinning
  const displayColumnPinning = useMemo(
    () => resolveColumnPinning(columnPinning),
    [columnPinning, resolveColumnPinning]
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW SWITCHING
  // ═══════════════════════════════════════════════════════════════════════════

  // Track initial setup separately from view changes
  const hasInitializedRef = useRef(false)
  const lastAppliedViewIdRef = useRef<string | null>(currentView?.id ?? null)

  // Initialize store with proper config when view changes
  useEffect(() => {
    const viewId = currentView?.id ?? null
    const isFirstMount = !hasInitializedRef.current

    // Always run on first mount, then only on view changes
    if (!isFirstMount && lastAppliedViewIdRef.current === viewId) {
      return
    }

    hasInitializedRef.current = true

    // Switching to "All rows" (no view) - filters already cleared by store
    if (!viewId) {
      lastAppliedViewIdRef.current = null

      // Initialize session config if needed
      const store = useDynamicTableStore.getState()
      const sessionConfig = store.getSessionConfig(tableId)
      if (Object.keys(sessionConfig.columnVisibility).length === 0) {
        // Initialize with default config
        const defaultConfig = computeInitialViewConfig({
          columns,
          enableCheckbox,
          filters: [],
        })
        store.updateSessionConfig(tableId, defaultConfig)
      }

      // Clear session filters
      store.setSessionFilters(tableId, [])

      // For standalone tables, mark as initialized immediately
      if (standalone && !store.initialized) {
        store.setInitialized(true)
      }

      return
    }

    // Switching to a view - config already loaded in store
    // Just mark that we've applied this view
    lastAppliedViewIdRef.current = viewId
  }, [currentView, tableId, columns, enableCheckbox, standalone])

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECKBOX COLUMN
  // ═══════════════════════════════════════════════════════════════════════════

  const checkboxColumn: ColumnDef<TData> = useMemo(
    () => ({
      id: '_checkbox',
      accessorFn: () => null,
      size: 40,
      minSize: 40,
      maxSize: 40,
      enableResizing: false,
      enableSorting: false,
      enableHiding: false,
      header: CheckboxHeaderCell,
      cell: CheckboxCell,
    }),
    []
  )

  const enhancedColumns = useMemo(() => {
    let nextColumns = [...columns]
    if (enableCheckbox) {
      nextColumns = [checkboxColumn, ...nextColumns]
    }
    return nextColumns
  }, [checkboxColumn, columns, enableCheckbox])

  // ═══════════════════════════════════════════════════════════════════════════
  // COLUMN ORDER HANDLER WITH CHECKBOX PRESERVATION
  // ═══════════════════════════════════════════════════════════════════════════

  const handleColumnOrderChange = useCallback(
    (updater: ColumnOrderState | ((old: ColumnOrderState) => ColumnOrderState)) => {
      const previousOrder = displayColumnOrder
      const nextOrder = typeof updater === 'function' ? updater(previousOrder) : updater
      const finalOrder = applySpecialColumnOrder(nextOrder)

      // Remove special columns before saving to store
      const orderWithoutSpecial = finalOrder.filter((id) => id !== '_checkbox')
      setColumnOrder(orderWithoutSpecial)
    },
    [displayColumnOrder, applySpecialColumnOrder, setColumnOrder]
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // TANSTACK TABLE INSTANCE
  // ═══════════════════════════════════════════════════════════════════════════

  const table = useReactTable({
    data,
    columns: enhancedColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
    getFilteredRowModel: enableFiltering ? getFilteredRowModel() : undefined,
    getPaginationRowModel: props.pageCount ? getPaginationRowModel() : undefined,
    state: {
      sorting,
      columnFilters,
      columnVisibility: columnVisibility ?? {},
      columnOrder: displayColumnOrder,
      columnSizing,
      columnPinning: displayColumnPinning,
      rowSelection,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: handleColumnOrderChange,
    onColumnSizingChange: setColumnSizing,
    onColumnPinningChange: setColumnPinning,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    enableSorting,
    enableFilters: enableFiltering,
    enableColumnResizing: true,
    enableRowSelection: true,
    enableGlobalFilter: enableSearch,
    columnResizeMode: 'onChange',
    getRowId: getRowId ?? ((row, index) => (row.id ? String(row.id) : String(index))),
    manualPagination: Boolean(props.pageCount),
    pageCount: props.pageCount,
  })

  // Ref to maintain stable reference to table for callbacks
  const tableRef = useRef(table)
  useEffect(() => {
    tableRef.current = table
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTROLLED ROW SELECTION
  // ═══════════════════════════════════════════════════════════════════════════

  const initialRowSelection = useMemo(() => {
    if (!controlledRowSelection) {
      return {}
    }
    const selection: RowSelectionState = {}
    controlledRowSelection.forEach((id) => {
      selection[id] = true
    })
    return selection
  }, [controlledRowSelection])

  useEffect(() => {
    if (!controlledRowSelection) {
      return
    }
    setRowSelection(initialRowSelection)
  }, [initialRowSelection, controlledRowSelection, setRowSelection])

  // Notify parent of row selection changes
  useEffect(() => {
    if (!onRowSelectionChange || !enableCheckbox || controlledRowSelection) {
      return
    }
    const selectedRows = new Set(Object.keys(rowSelection))
    onRowSelectionChange(selectedRows)
  }, [controlledRowSelection, enableCheckbox, onRowSelectionChange, rowSelection])

  // ═══════════════════════════════════════════════════════════════════════════
  // COLUMN VISIBILITY CALLBACK
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (onColumnVisibilityChange && columnVisibility !== undefined) {
      onColumnVisibilityChange(columnVisibility)
    }
  }, [columnVisibility, onColumnVisibilityChange])

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const hasUnsavedViewChanges = currentView?.id ? hasUnsavedChanges(currentView.id) : false
  const isSavingView = currentView?.id ? isSaving(currentView.id) : false

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const setActiveView = useCallback((viewId: string | null) => {
    setActiveViewId(viewId)
  }, [])

  const setSearchQuery = useCallback(
    (query: string) => {
      setUrlState({ q: query || null })
      setGlobalFilter(query)
    },
    [setUrlState]
  )

  // Get all column IDs getter for pinning (stable reference via useCallback)
  const getAllColumnIds = useCallback(
    () => tableRef.current?.getAllLeafColumns().map((col) => col.id) ?? [],
    []
  )

  // Use centralized action hooks for single column operations
  const setColumnLabel = useSetColumnLabel(tableId)
  const setColumnFormatting = useSetSingleColumnFormatting(tableId)
  const setPinnedColumn = useSetPinnedColumn(tableId, getAllColumnIds)

  const pinnedColumnId = useMemo(() => {
    const leftPinned = displayColumnPinning.left ?? []
    if (leftPinned.length === 0) {
      return null
    }
    const userPinned = leftPinned.filter((id) => id !== '_checkbox')
    return userPinned.length > 0
      ? userPinned[userPinned.length - 1]
      : leftPinned[leftPinned.length - 1]
  }, [displayColumnPinning])

  // Use selection store for last selected index and clicked row
  const getLastSelectedIndex = useCallback(() => {
    return useSelectionStore.getState().tables[tableId]?.lastSelectedIndex ?? null
  }, [tableId])

  const setLastSelectedIndex = useCallback(
    (index: number | null) => {
      useSelectionStore.getState().setLastSelectedIndex(tableId, index)
    },
    [tableId]
  )

  const getLastClickedRowId = useCallback(() => {
    return useSelectionStore.getState().tables[tableId]?.lastClickedRowId ?? null
  }, [tableId])

  const setLastClickedRowId = useCallback(
    (id: string | null) => {
      useSelectionStore.getState().setLastClickedRowId(tableId, id)
    },
    [tableId]
  )

  const toggleRowSelection = useCallback(
    (rowId: string, event: React.MouseEvent) => {
      const t = tableRef.current
      const row = t.getRowModel().rows.find((tableRow) => tableRow.id === rowId)
      if (!row) {
        return
      }

      const rowIndex = row.index
      const checked = !row.getIsSelected()
      const lastIndex = getLastSelectedIndex()

      if (event.shiftKey && lastIndex !== null) {
        // Use startTransition for range selection to keep UI responsive
        startTransition(() => {
          const start = Math.min(lastIndex, rowIndex)
          const end = Math.max(lastIndex, rowIndex)
          const allRows = t.getRowModel().rows
          const newSelection: Record<string, boolean> = { ...t.getState().rowSelection }

          for (let index = start; index <= end; index += 1) {
            const currentRowId = allRows[index]?.id
            if (!currentRowId) {
              continue
            }
            if (checked) {
              newSelection[currentRowId] = true
            } else {
              delete newSelection[currentRowId]
            }
          }

          setRowSelection(newSelection)
        })
      } else {
        row.toggleSelected(checked)
        setLastSelectedIndex(rowIndex)
      }
    },
    [getLastSelectedIndex, setLastSelectedIndex, setRowSelection]
  )

  const resetViewChanges = useCallback(() => {
    if (!currentView?.id) return

    // Reset store to saved state using unified store
    useDynamicTableStore.getState().resetViewChanges(currentView.id)
  }, [currentView])

  // Manual save trigger - calls the persistence hook's save function
  const saveCurrentView = useCallback(async () => {
    await saveView()
  }, [saveView])

  // markViewClean is now handled by the store
  const markViewClean = useCallback(() => {
    // The store handles this automatically
  }, [])

  const isBulkMode = enableCheckbox && table.getFilteredSelectedRowModel().rows.length > 0

  return {
    table,
    views,
    currentView,
    isLoadingViews,
    isSavingView,
    hasUnsavedViewChanges,
    saveCurrentView,
    markViewClean,
    resetViewChanges,
    searchQuery: globalFilter,
    setSearchQuery,
    setActiveView,
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
  }
}
