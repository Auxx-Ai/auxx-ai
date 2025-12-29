// apps/web/src/components/dynamic-table/utils/filter-functions.ts

import type { TableFilter, FilterOperator } from '../types'

/**
 * Text filter functions
 */
const textFilters = {
  contains: (value: any, filterValue: string) =>
    String(value).toLowerCase().includes(filterValue.toLowerCase()),
  notContains: (value: any, filterValue: string) =>
    !String(value).toLowerCase().includes(filterValue.toLowerCase()),
  is: (value: any, filterValue: string) =>
    String(value).toLowerCase() === filterValue.toLowerCase(),
  isNot: (value: any, filterValue: string) =>
    String(value).toLowerCase() !== filterValue.toLowerCase(),
  isEmpty: (value: any) => !value || String(value).trim() === '',
  isNotEmpty: (value: any) => !!value && String(value).trim() !== '',
}

/**
 * Number filter functions
 */
const numberFilters = {
  equals: (value: any, filterValue: number) => Number(value) === filterValue,
  notEquals: (value: any, filterValue: number) => Number(value) !== filterValue,
  greaterThan: (value: any, filterValue: number) => Number(value) > filterValue,
  lessThan: (value: any, filterValue: number) => Number(value) < filterValue,
  greaterThanOrEqual: (value: any, filterValue: number) => Number(value) >= filterValue,
  lessThanOrEqual: (value: any, filterValue: number) => Number(value) <= filterValue,
  isEmpty: (value: any) => value === null || value === undefined || value === '',
  isNotEmpty: (value: any) => value !== null && value !== undefined && value !== '',
}

/**
 * Date filter functions
 */
const dateFilters = {
  is: (value: any, filterValue: Date) => {
    const date = new Date(value)
    const filter = new Date(filterValue)
    return date.toDateString() === filter.toDateString()
  },
  isNot: (value: any, filterValue: Date) => {
    const date = new Date(value)
    const filter = new Date(filterValue)
    return date.toDateString() !== filter.toDateString()
  },
  before: (value: any, filterValue: Date) => new Date(value) < new Date(filterValue),
  after: (value: any, filterValue: Date) => new Date(value) > new Date(filterValue),
  onOrBefore: (value: any, filterValue: Date) => new Date(value) <= new Date(filterValue),
  onOrAfter: (value: any, filterValue: Date) => new Date(value) >= new Date(filterValue),
  isEmpty: (value: any) => !value,
  isNotEmpty: (value: any) => !!value,
}

/**
 * Boolean filter functions
 */
const booleanFilters = {
  is: (value: any, filterValue: boolean) => Boolean(value) === filterValue,
  isNot: (value: any, filterValue: boolean) => Boolean(value) !== filterValue,
}

/**
 * Get filter function for a specific operator
 */
export function getFilterFunction(columnType: string, operator: FilterOperator) {
  switch (columnType) {
    case 'text':
    case 'email':
    case 'phone':
      return textFilters[operator as keyof typeof textFilters]
    case 'number':
      return numberFilters[operator as keyof typeof numberFilters]
    case 'date':
      return dateFilters[operator as keyof typeof dateFilters]
    case 'boolean':
      return booleanFilters[operator as keyof typeof booleanFilters]
    default:
      return textFilters[operator as keyof typeof textFilters]
  }
}

/**
 * Apply filter to a value
 */
export function applyFilter(value: any, filter: TableFilter, columnType: string): boolean {
  const filterFn = getFilterFunction(columnType, filter.operator)

  if (!filterFn) {
    console.warn(`No filter function found for operator: ${filter.operator}`)
    return true
  }

  // Handle operators that don't require a value
  if (filter.operator === 'isEmpty' || filter.operator === 'isNotEmpty') {
    return filterFn(value)
  }

  return filterFn(value, filter.value)
}

/**
 * Apply multiple filters to a row
 */
export function applyFilters<TData extends Record<string, any>>(
  row: TData,
  filters: TableFilter[],
  columnTypes: Record<string, string>
): boolean {
  return filters.every((filter) => {
    const value = row[filter.columnId]
    const columnType = columnTypes[filter.columnId] || 'text'
    return applyFilter(value, filter, columnType)
  })
}
