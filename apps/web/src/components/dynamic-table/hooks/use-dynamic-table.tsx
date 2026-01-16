// apps/web/src/components/dynamic-table/hooks/use-dynamic-table.ts

'use client'

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
  type ColumnOrderState,
  type ColumnSizingState,
  type ColumnDef,
  type ColumnPinningState,
} from '@tanstack/react-table'
import { useQueryStates, parseAsString } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import type { DynamicTableProps, ViewConfig, ExtendedColumnDef, ColumnFormatting } from '../types'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { CheckboxCell } from '../components/checkbox-cell'
import { CheckboxHeaderCell } from '../components/checkbox-header-cell'
import {
  computeInitialViewConfig,
  normalizeViewConfig,
  buildViewConfig,
} from '../utils/view-config'
import {
  useTableViews,
  useViewStore,
  useViewStoreInitialized,
  useActiveViewConfig,
} from '../stores/view-store'
import { useViewStorePersistence } from './use-view-store-persistence'

/**
 * Main hook for managing dynamic table state.
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
  ...props
}: DynamicTableProps<TData>) {
  // Compute enableCheckbox from bulkActions or onRowSelectionChange
  const enableCheckbox = Boolean(bulkActions?.length) || Boolean(onRowSelectionChange)
  const [urlState, setUrlState] = useQueryStates({
    q: parseAsString,
  })

  // View state is now managed locally instead of in URL
  const [activeViewId, setActiveViewId] = useState<string | null>(null)

  // Get views from centralized store instead of React Query
  const views = useTableViews(tableId)
  const isStoreInitialized = useViewStoreInitialized()
  const isLoadingViews = !isStoreInitialized
  const updateViewConfig = useViewStore((state) => state.updateViewConfig)
  const hasUnsavedChanges = useViewStore((state) => state.hasUnsavedChanges)
  const isSaving = useViewStore((state) => state.isSaving)
  const resetToSaved = useViewStore((state) => state.resetToSaved)
  const setActiveViewInStore = useViewStore((state) => state.setActiveView)
  const updateSessionView = useViewStore((state) => state.updateSessionView)

  const currentView = useMemo(() => {
    if (!activeViewId) {
      return null
    }
    return views.find((view) => view.id === activeViewId) ?? null
  }, [activeViewId, views])

  // Find default view
  const defaultView = useMemo(() => {
    return views.find((view) => view.isDefault) ?? null
  }, [views])

  // Auto-select default view on mount if no view selected
  useEffect(() => {
    // Only run when store is initialized and we have views
    if (!isStoreInitialized || views.length === 0) return

    // If no view selected and default view exists, auto-select it
    if (!activeViewId && defaultView) {
      setActiveViewId(defaultView.id)
    }
  }, [isStoreInitialized, activeViewId, defaultView, views.length])

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC VIEW ID TO STORE
  // This ensures useActiveViewConfig() returns the correct config
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    setActiveViewInStore(tableId, activeViewId)
  }, [tableId, activeViewId, setActiveViewInStore])

  // Initialize persistence (triggers auto-save on changes)
  useViewStorePersistence(currentView?.id ?? null, tableId)

  // Get active view config (includes pending changes and session view)
  const activeViewConfig = useActiveViewConfig(tableId)

  const baseViewConfig = useMemo(() => {
    if (currentView) {
      return normalizeViewConfig(currentView.config)
    }

    return computeInitialViewConfig({
      columns,
      enableCheckbox,
      filters: [],
    })
  }, [columns, currentView, enableCheckbox])

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

  const [localFilters, setLocalFilters] = useState<ConditionGroup[]>(() => baseViewConfig.filters)
  const [activeDragItems, setActiveDragItems] = useState<TData[] | null>(null)

  // Use refs for values that shouldn't trigger re-renders when changed
  const lastSelectedIndexRef = useRef<number | null>(null)
  const lastClickedRowIdRef = useRef<string | null>(null)

  // Stable getter/setter functions that don't trigger re-renders
  const getLastSelectedIndex = useCallback(() => lastSelectedIndexRef.current, [])
  const setLastSelectedIndex = useCallback((index: number | null) => {
    lastSelectedIndexRef.current = index
  }, [])

  const getLastClickedRowId = useCallback(() => lastClickedRowIdRef.current, [])
  const setLastClickedRowId = useCallback((id: string | null) => {
    lastClickedRowIdRef.current = id
  }, [])

  const [sorting, setSorting] = useState<SortingState>(baseViewConfig.sorting)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    baseViewConfig.columnVisibility
  )
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() =>
    applySpecialColumnOrder(baseViewConfig.columnOrder)
  )
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(baseViewConfig.columnSizing)
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>(() =>
    resolveColumnPinning(baseViewConfig.columnPinning)
  )
  const [columnLabels, setColumnLabels] = useState<Record<string, string>>(
    () => baseViewConfig.columnLabels ?? {}
  )
  const [columnFormatting, setColumnFormattingState] = useState<Record<string, ColumnFormatting>>(
    () => baseViewConfig.columnFormatting ?? {}
  )

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

  const [rowSelection, setRowSelection] = useState<RowSelectionState>(initialRowSelection)
  const [globalFilter, setGlobalFilter] = useState(urlState.q ?? '')

  useEffect(() => {
    setRowSelection(initialRowSelection)
  }, [initialRowSelection])

  useEffect(() => {
    setColumnOrder((prev) => applySpecialColumnOrder(prev))
  }, [applySpecialColumnOrder])

  useEffect(() => {
    setColumnPinning((prev) => resolveColumnPinning(prev))
  }, [resolveColumnPinning])

  // Update pinning when baseViewConfig changes (handles async column loading with primaryCell)
  // Only applies when there's no saved view to avoid overriding user's saved pinning
  useEffect(() => {
    if (!currentView && baseViewConfig.columnPinning) {
      setColumnPinning(resolveColumnPinning(baseViewConfig.columnPinning))
    }
  }, [baseViewConfig.columnPinning, currentView, resolveColumnPinning])

  const applyViewConfig = useCallback(
    (config: ViewConfig, options: { applyFilters?: boolean } = {}) => {
      setSorting(config.sorting)
      setColumnVisibility(config.columnVisibility)
      setColumnOrder(applySpecialColumnOrder(config.columnOrder))
      setColumnSizing(config.columnSizing)
      setColumnPinning(resolveColumnPinning(config.columnPinning))
      setColumnLabels(config.columnLabels ?? {})
      setColumnFormattingState(config.columnFormatting ?? {})
      if (options.applyFilters !== false) {
        setLocalFilters(config.filters ?? [])
      }
    },
    [applySpecialColumnOrder, resolveColumnPinning]
  )

  const lastAppliedViewIdRef = useRef<string | null>(currentView?.id ?? null)

  // Sync external changes from store to local state (for column-manager)
  // Only sync columnVisibility and columnOrder to avoid infinite loops
  useEffect(() => {
    if (!activeViewConfig) return

    const storeVisibility = activeViewConfig.columnVisibility ?? {}
    const storeOrder = activeViewConfig.columnOrder ?? []

    // Only update if different (avoid infinite loop)
    setColumnVisibility((current) => {
      const currentStr = JSON.stringify(current)
      const storeStr = JSON.stringify(storeVisibility)
      return currentStr !== storeStr ? storeVisibility : current
    })

    setColumnOrder((current) => {
      const currentStr = JSON.stringify(current)
      const storeOrderWithSpecial = applySpecialColumnOrder(storeOrder)
      const storeStr = JSON.stringify(storeOrderWithSpecial)
      return currentStr !== storeStr ? storeOrderWithSpecial : current
    })
  }, [activeViewConfig, applySpecialColumnOrder])

  useEffect(() => {
    const viewId = currentView?.id ?? null

    // Skip if same view (no change)
    if (lastAppliedViewIdRef.current === viewId) {
      return
    }

    // Switching to "All rows" (no view) - reset filters to empty
    if (!viewId) {
      lastAppliedViewIdRef.current = null
      setLocalFilters([])
      return
    }

    // Switching to a view - apply its config including filters
    // Also clear session view since we're now using view filters
    const nextConfig = normalizeViewConfig(currentView.config)
    applyViewConfig(nextConfig)
    updateSessionView(tableId, { filters: [] })
    lastAppliedViewIdRef.current = viewId
  }, [applyViewConfig, currentView, tableId, updateSessionView])

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

  // Handle saved views with empty columnVisibility (legacy bug fix)
  // If a view was saved with empty columnVisibility, hide all hideable columns
  useEffect(() => {
    const config = baseViewConfig.columnVisibility

    // Only apply this fix for saved views with empty columnVisibility
    if (Object.keys(config).length === 0 && currentView) {
      const hideAll: VisibilityState = {}

      enhancedColumns.forEach((col) => {
        const columnId = col.id ?? (col as any).accessorKey
        if (!columnId) return

        // Only hide columns that CAN be hidden
        // Columns with enableHiding: false (checkbox, primary) stay visible
        if (col.enableHiding !== false) {
          hideAll[columnId] = false
        }
      })

      setColumnVisibility(hideAll)
    }
    // Only run when view changes or on mount, not when columns change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView?.id])

  // Note: Client-side filtering removed - filtering is now handled server-side
  // Data is passed through directly; useRecordList (Plan 06) handles server-side filtering

  const handleColumnOrderChange = useCallback(
    (updater: ColumnOrderState | ((old: ColumnOrderState) => ColumnOrderState)) => {
      setColumnOrder((previousOrder) => {
        const nextOrder = typeof updater === 'function' ? updater(previousOrder) : updater
        return applySpecialColumnOrder(nextOrder)
      })
    },
    [applySpecialColumnOrder]
  )

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
      columnVisibility,
      columnOrder,
      columnSizing,
      columnPinning,
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

  useEffect(() => {
    if (!controlledRowSelection) {
      return
    }
    const newSelection: RowSelectionState = {}
    controlledRowSelection.forEach((id) => {
      newSelection[id] = true
    })
    setRowSelection(newSelection)
  }, [controlledRowSelection])

  useEffect(() => {
    if (!onRowSelectionChange || !enableCheckbox || controlledRowSelection) {
      return
    }
    const selectedRows = new Set(Object.keys(rowSelection))
    onRowSelectionChange(selectedRows)
  }, [controlledRowSelection, enableCheckbox, onRowSelectionChange, rowSelection])

  // Notify parent of column visibility changes (for custom field value syncer)
  useEffect(() => {
    if (onColumnVisibilityChange) {
      onColumnVisibilityChange(columnVisibility)
    }
  }, [columnVisibility, onColumnVisibilityChange])

  // Track whether we've done the initial sync to avoid triggering save on mount
  const hasMountedRef = useRef(false)
  const lastSyncedConfigRef = useRef<string | null>(null)

  // Build current table config for dirty checking and saving
  const currentTableConfig = useMemo(
    () =>
      buildViewConfig({
        sorting,
        columnVisibility,
        columnOrder,
        columnSizing,
        columnPinning,
        columnLabels,
        columnFormatting,
        filters: localFilters,
      }),
    [
      sorting,
      columnVisibility,
      columnOrder,
      columnSizing,
      columnPinning,
      columnLabels,
      columnFormatting,
      localFilters,
    ]
  )

  // Sync table config changes to store (for table-level config, not kanban)
  // Skip initial mount to avoid triggering save on page load
  // Note: Filters are synced to pending config for useActiveViewConfig,
  // but excluded from DB save by the persistence hook
  useEffect(() => {
    if (!currentView?.id) {
      hasMountedRef.current = false
      lastSyncedConfigRef.current = null
      return
    }

    // Skip the first render - just record the initial config
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      lastSyncedConfigRef.current = JSON.stringify(currentTableConfig)
      return
    }

    // Serialize to check if actually changed
    const serialized = JSON.stringify(currentTableConfig)
    if (serialized === lastSyncedConfigRef.current) return

    // Update store with table config changes (preserves kanban config via deepMerge)
    // Filters are included here for useActiveViewConfig to work,
    // but the persistence hook will exclude them from DB save
    updateViewConfig(currentView.id, {
      sorting: currentTableConfig.sorting,
      columnVisibility: currentTableConfig.columnVisibility,
      columnOrder: currentTableConfig.columnOrder,
      columnSizing: currentTableConfig.columnSizing,
      columnPinning: currentTableConfig.columnPinning,
      columnLabels: currentTableConfig.columnLabels,
      columnFormatting: currentTableConfig.columnFormatting,
      filters: currentTableConfig.filters,
    })

    lastSyncedConfigRef.current = serialized
  }, [currentView?.id, currentTableConfig, updateViewConfig])

  // Sync session filters to store when no view is selected
  // This enables filtering without a view
  useEffect(() => {
    // Only sync when NO view is selected
    if (currentView?.id) return

    // Sync filters to session view store
    updateSessionView(tableId, { filters: localFilters })
  }, [currentView?.id, tableId, localFilters, updateSessionView])

  // Compute dirty/saving state from store
  const hasUnsavedViewChanges = currentView?.id ? hasUnsavedChanges(currentView.id) : false
  const isSavingView = currentView?.id ? isSaving(currentView.id) : false

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

  const setFilters = useCallback((filters: ConditionGroup[]) => {
    console.log('[useDynamicTable] Setting filters:', filters)
    setLocalFilters(filters)
  }, [])

  const setColumnLabel = useCallback((columnId: string, label: string | null) => {
    setColumnLabels((prev) => {
      if (label === null) {
        const { [columnId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [columnId]: label }
    })
  }, [])

  const setColumnFormatting = useCallback(
    (columnId: string, formatting: ColumnFormatting | null) => {
      setColumnFormattingState((prev) => {
        if (formatting === null) {
          const { [columnId]: _, ...rest } = prev
          return rest
        }
        return { ...prev, [columnId]: formatting }
      })
    },
    []
  )

  const setPinnedColumn = useCallback(
    (columnId: string | null) => {
      if (columnId === null) {
        setColumnPinning(resolveColumnPinning({}))
        return
      }

      const allColumns = table.getAllLeafColumns()
      const targetIndex = allColumns.findIndex((column) => column.id === columnId)
      if (targetIndex === -1) {
        return
      }

      const leftColumns = allColumns.slice(0, targetIndex + 1).map((column) => column.id)
      setColumnPinning({ left: leftColumns })
    },
    [resolveColumnPinning, table]
  )

  const pinnedColumnId = useMemo(() => {
    const leftPinned = columnPinning.left ?? []
    if (leftPinned.length === 0) {
      return null
    }
    const userPinned = leftPinned.filter((id) => id !== '_checkbox')
    return userPinned.length > 0
      ? userPinned[userPinned.length - 1]
      : leftPinned[leftPinned.length - 1]
  }, [columnPinning])

  // Use ref for table to make toggleRowSelection stable
  const tableRef = useRef(table)
  tableRef.current = table

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

          t.setRowSelection(newSelection)
        })
      } else {
        row.toggleSelected(checked)
        setLastSelectedIndex(rowIndex)
      }
    },
    [getLastSelectedIndex, setLastSelectedIndex]
  )

  const resetViewChanges = useCallback(() => {
    if (!currentView?.id) return

    // Reset store to saved state
    resetToSaved(currentView.id)

    // Re-apply config from the saved view
    const savedConfig = normalizeViewConfig(currentView.config)
    applyViewConfig(savedConfig)
    lastSyncedConfigRef.current = JSON.stringify(
      buildViewConfig({
        sorting: savedConfig.sorting,
        columnVisibility: savedConfig.columnVisibility,
        columnOrder: savedConfig.columnOrder,
        columnSizing: savedConfig.columnSizing,
        columnPinning: savedConfig.columnPinning,
        columnLabels: savedConfig.columnLabels,
        columnFormatting: savedConfig.columnFormatting,
        filters: savedConfig.filters,
      })
    )
  }, [applyViewConfig, currentView, resetToSaved])

  // saveCurrentView is now handled by useViewStorePersistence automatically
  // This is a no-op for backward compatibility (auto-save handles it)
  const saveCurrentView = useCallback(async () => {
    // The store persistence hook handles saving automatically
    // This function exists for API compatibility
  }, [])

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
    filters: localFilters,
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
