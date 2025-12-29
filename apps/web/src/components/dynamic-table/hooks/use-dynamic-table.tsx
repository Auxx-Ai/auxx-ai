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
import { api } from '~/trpc/react'
import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import type { DynamicTableProps, ViewConfig, ExtendedColumnDef, TableFilter, CellSelectionState, ColumnFormatting } from '../types'
import { applyFilters } from '../utils/filter-functions'
import { useViewPersistence } from './use-view-persistence'
import { CheckboxCell } from '../components/checkbox-cell'
import { CheckboxHeaderCell } from '../components/checkbox-header-cell'
import { computeInitialViewConfig, normalizeViewConfig } from '../utils/view-config'

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
    v: parseAsString,
    q: parseAsString,
  })

  const { data: views = [], isLoading: isLoadingViews } = api.tableView.list.useQuery(
    { tableId },
    {
      staleTime: 5 * 60 * 1000,
    }
  )

  const currentView = useMemo(() => {
    if (!urlState.v) {
      return null
    }
    return views.find((view) => view.id === urlState.v) ?? null
  }, [urlState.v, views])

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

  const [localFilters, setLocalFilters] = useState<TableFilter[]>(() => baseViewConfig.filters)
  const [activeDragItems, setActiveDragItems] = useState<TData[] | null>(null)
  const [selectedCell, setSelectedCell] = useState<CellSelectionState | null>(null)
  const [editingCell, setEditingCell] = useState<CellSelectionState | null>(null)

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

  // Update pinning when baseViewConfig changes (handles async column loading with defaultPinned)
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

  useEffect(() => {
    const viewId = currentView?.id ?? null
    if (!viewId) {
      lastAppliedViewIdRef.current = null
      return
    }

    if (lastAppliedViewIdRef.current === viewId) {
      return
    }

    const nextConfig = normalizeViewConfig(currentView.config)
    applyViewConfig(nextConfig)
    lastAppliedViewIdRef.current = viewId
  }, [applyViewConfig, currentView])

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

  const columnTypes = useMemo(() => {
    const types: Record<string, string> = {}
    columns.forEach((column) => {
      if ('accessorKey' in column && typeof column.accessorKey === 'string') {
        types[column.accessorKey] = (column as ExtendedColumnDef).columnType ?? 'text'
      }
    })
    return types
  }, [columns])

  const filteredData = useMemo(() => {
    if (!enableFiltering || localFilters.length === 0) {
      return data
    }
    return data.filter((row) => applyFilters(row, localFilters, columnTypes))
  }, [columnTypes, data, enableFiltering, localFilters])

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
    data: filteredData,
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

  const viewPersistence = useViewPersistence({
    table,
    currentView,
    enabled: Boolean(currentView),
    filters: localFilters,
    columnVisibility,
    columnSizing,
    columnOrder,
    columnPinning,
    columnLabels,
    columnFormatting,
    sorting,
  })

  const { hasUnsavedChanges, isSaving, save, markClean, getLastSavedConfig } = viewPersistence

  const setActiveView = useCallback(
    (viewId: string | null) => {
      setUrlState({ v: viewId })
    },
    [setUrlState]
  )

  const setSearchQuery = useCallback(
    (query: string) => {
      setUrlState({ q: query || null })
      setGlobalFilter(query)
    },
    [setUrlState]
  )

  const setFilters = useCallback((filters: TableFilter[]) => {
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


  const toggleRowSelection = useCallback(
    (rowId: string, event: React.MouseEvent) => {
      const row = table.getRowModel().rows.find((tableRow) => tableRow.id === rowId)
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
          const allRows = table.getRowModel().rows
          const newSelection: Record<string, boolean> = { ...table.getState().rowSelection }

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

          table.setRowSelection(newSelection)
        })
      } else {
        row.toggleSelected(checked)
        setLastSelectedIndex(rowIndex)
      }
    },
    [getLastSelectedIndex, setLastSelectedIndex, table]
  )

  const resetViewChanges = useCallback(() => {
    const savedConfig = getLastSavedConfig()
    if (!savedConfig) {
      return
    }
    applyViewConfig(savedConfig)
    markClean(savedConfig)
  }, [applyViewConfig, getLastSavedConfig, markClean])

  const saveCurrentView = useCallback(() => save(), [save])

  const markViewClean = useCallback(() => {
    markClean()
  }, [markClean])

  const isBulkMode = enableCheckbox && table.getFilteredSelectedRowModel().rows.length > 0

  return {
    table,
    views,
    currentView,
    isLoadingViews,
    isSavingView: isSaving,
    hasUnsavedViewChanges: hasUnsavedChanges,
    saveCurrentView,
    markViewClean,
    resetViewChanges,
    searchQuery: globalFilter,
    setSearchQuery,
    setActiveView,
    columnTypes,
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
    selectedCell,
    setSelectedCell,
    editingCell,
    setEditingCell,
  }
}
