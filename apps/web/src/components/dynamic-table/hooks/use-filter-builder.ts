// apps/web/src/components/dynamic-table/hooks/use-filter-builder.ts

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { TableFilter, ExtendedColumnDef, FilterOperator } from '../types'
import {
  createDefaultFilter,
  validateFilter,
  getOperatorsForColumnType,
  getDefaultOperator,
  getFilterValueForOperator,
} from '../utils/filter-utils'

interface UseFilterBuilderProps<TData> {
  columns: ExtendedColumnDef<TData>[]
  filters: TableFilter[]
  onFiltersChange: (filters: TableFilter[]) => void
}

/**
 * Custom hook for filter builder logic
 */
export function useFilterBuilder<TData>({
  columns,
  filters,
  onFiltersChange,
}: UseFilterBuilderProps<TData>) {
  const [localFilters, setLocalFilters] = useState<TableFilter[]>([])
  const [isOpen, setIsOpen] = useState(false)

  // Store initial filters when popover opens to handle cancel properly
  const initialFiltersRef = useRef<TableFilter[]>([])

  // Get filterable columns
  const filterableColumns = useMemo(
    () =>
      columns.filter(
        (col): col is ExtendedColumnDef<TData> & { accessorKey: string } =>
          col.enableFiltering !== false &&
          'accessorKey' in col &&
          typeof col.accessorKey === 'string'
      ),
    [columns]
  )

  // Create column lookup map for performance
  const columnMap = useMemo(() => {
    return new Map(filterableColumns.map((col) => [col.accessorKey, col]))
  }, [filterableColumns])

  // Sync localFilters with filters prop when popover opens
  useEffect(() => {
    if (isOpen) {
      // Store initial state for cancel functionality
      initialFiltersRef.current = [...filters]

      if (filters.length === 0 && filterableColumns.length > 0) {
        const defaultFilter = createDefaultFilter(filterableColumns[0])
        if (defaultFilter) {
          setLocalFilters([defaultFilter])
        }
      } else {
        setLocalFilters([...filters])
      }
    }
  }, [isOpen, filters, filterableColumns])

  // Get operators for a column
  const getOperatorsForColumn = useCallback(
    (columnId: string) => {
      const column = columnMap.get(columnId)
      const columnType = column?.columnType || 'text'
      return getOperatorsForColumnType(columnType)
    },
    [columnMap]
  )

  // Add a new filter
  const addFilter = useCallback(() => {
    const firstColumn = filterableColumns[0]
    if (!firstColumn) return

    const newFilter = createDefaultFilter(firstColumn)
    if (newFilter) {
      setLocalFilters((prev) => [...prev, newFilter])
    }
  }, [filterableColumns])

  // Update a filter
  const updateFilter = useCallback(
    (index: number, field: keyof TableFilter, value: any) => {
      setLocalFilters((prev) => {
        const updated = [...prev]
        const filter = { ...updated[index] }

        if (field === 'columnId') {
          // When changing column, reset operator and value
          const column = columnMap.get(value)
          const columnType = column?.columnType || 'text'
          filter.columnId = value
          filter.operator = getDefaultOperator(columnType)
          filter.value = ''
        } else if (field === 'operator') {
          // When changing operator, adjust value if needed
          const column = columnMap.get(filter.columnId)
          const columnType = column?.columnType || 'text'
          filter.operator = value as FilterOperator
          filter.value = getFilterValueForOperator(
            value as FilterOperator,
            columnType,
            filter.value
          )
        } else {
          filter[field] = value
        }

        updated[index] = filter
        return updated
      })
    },
    [columnMap]
  )

  // Remove a filter
  const removeFilter = useCallback((index: number) => {
    setLocalFilters((prev) => {
      // Don't remove if it's the only filter
      if (prev.length <= 1) return prev
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  // Apply filters
  const applyFilters = useCallback(() => {
    const validFilters = localFilters.filter(validateFilter)
    onFiltersChange(validFilters)
    setIsOpen(false)
  }, [localFilters, onFiltersChange])

  // Clear all filters
  const clearFilters = useCallback(() => {
    if (filterableColumns.length > 0) {
      const defaultFilter = createDefaultFilter(filterableColumns[0])
      if (defaultFilter) {
        setLocalFilters([defaultFilter])
      }
    } else {
      setLocalFilters([])
    }
    onFiltersChange([])
    setIsOpen(false)
  }, [filterableColumns, onFiltersChange])

  // Cancel and restore initial state
  const handleCancel = useCallback(() => {
    setLocalFilters(initialFiltersRef.current)
    setIsOpen(false)
  }, [])

  // Get column info for a filter
  const getColumnInfo = useCallback(
    (columnId: string) => {
      const column = columnMap.get(columnId)
      return {
        column,
        columnType: column?.columnType || 'text',
        header: column ? (typeof column.header === 'string' ? column.header : columnId) : columnId,
      }
    },
    [columnMap]
  )

  // Count of valid filters
  const validFilterCount = useMemo(() => {
    return localFilters.filter(validateFilter).length
  }, [localFilters])

  return {
    // State
    isOpen,
    setIsOpen,
    localFilters,
    filterableColumns,

    // Computed
    validFilterCount,
    hasFilters: filters.length > 0,
    canAddMore: filterableColumns.length > 0,

    // Actions
    addFilter,
    updateFilter,
    removeFilter,
    applyFilters,
    clearFilters,
    handleCancel,

    // Utilities
    getOperatorsForColumn,
    getColumnInfo,
    validateFilter,
  }
}
