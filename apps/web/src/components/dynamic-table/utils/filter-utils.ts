// apps/web/src/components/dynamic-table/utils/filter-utils.ts

import type { TableFilter, FilterOperator, ExtendedColumnDef } from '../types'
import { FILTER_OPERATORS } from './constants'

/**
 * Generate a unique ID for filters
 */
export const generateFilterId = (): string => {
  return `filter-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a default filter for a given column
 */
export const createDefaultFilter = <TData>(
  column: ExtendedColumnDef<TData> & { accessorKey: string }
): TableFilter | null => {
  if (!column) return null

  const columnType = column.columnType || 'text'
  const operators = FILTER_OPERATORS[columnType] || FILTER_OPERATORS.text
  const defaultOperator = operators[0]?.value || 'contains'

  return {
    id: generateFilterId(),
    columnId: column.accessorKey,
    operator: defaultOperator as FilterOperator,
    value: '',
  }
}

/**
 * Validate if a filter has all required values
 */
export const validateFilter = (filter: TableFilter): boolean => {
  // These operators don't require a value
  if (['isEmpty', 'isNotEmpty'].includes(filter.operator)) {
    return true
  }

  // Check if value is provided for operators that require it
  return filter.value !== null && filter.value !== undefined && filter.value !== ''
}

/**
 * Get operators for a specific column type
 */
export const getOperatorsForColumnType = (columnType: string) => {
  return FILTER_OPERATORS[columnType] || FILTER_OPERATORS.text
}

/**
 * Check if an operator requires a value
 */
export const operatorRequiresValue = (operator: FilterOperator, columnType: string): boolean => {
  const operators = getOperatorsForColumnType(columnType)
  const op = operators.find((o) => o.value === operator)
  return op?.requiresValue ?? true
}

/**
 * Get default operator for a column type
 */
export const getDefaultOperator = (columnType: string): FilterOperator => {
  const operators = getOperatorsForColumnType(columnType)
  return (operators[0]?.value || 'contains') as FilterOperator
}

/**
 * Reset filter value based on operator requirements
 */
export const getFilterValueForOperator = (
  operator: FilterOperator,
  columnType: string,
  previousValue: any
): any => {
  if (!operatorRequiresValue(operator, columnType)) {
    return null
  }

  // If switching to an operator that requires value but previous was null,
  // provide a sensible default
  if (previousValue === null || previousValue === undefined) {
    switch (columnType) {
      case 'boolean':
        return false
      case 'number':
        return 0
      case 'date':
        return new Date().toISOString()
      default:
        return ''
    }
  }

  return previousValue
}
