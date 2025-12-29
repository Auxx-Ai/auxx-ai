// apps/web/src/components/dynamic-table/utils/constants.ts

import {
  ArrowUpAZ,
  ArrowDownZA,
  ArrowUp01,
  ArrowDown10,
  CalendarArrowUp,
  CalendarArrowDown,
  ArrowUp,
  ArrowDown,
  Text,
  Hash,
  Calendar,
  ToggleLeft,
  AtSign,
  Phone,
  FileText,
} from 'lucide-react'
import type { ColumnTypeConfig, FilterOperatorConfig, SortOption } from '../types'

/**
 * Filter operators by column type
 */
export const FILTER_OPERATORS: Record<string, FilterOperatorConfig[]> = {
  text: [
    { value: 'contains', label: 'contains', requiresValue: true },
    { value: 'notContains', label: 'does not contain', requiresValue: true },
    { value: 'is', label: 'is', requiresValue: true },
    { value: 'isNot', label: 'is not', requiresValue: true },
    { value: 'isEmpty', label: 'is empty', requiresValue: false },
    { value: 'isNotEmpty', label: 'is not empty', requiresValue: false },
  ],
  number: [
    { value: 'equals', label: 'is', requiresValue: true },
    { value: 'notEquals', label: 'is not', requiresValue: true },
    { value: 'greaterThan', label: 'is greater than', requiresValue: true },
    { value: 'lessThan', label: 'is less than', requiresValue: true },
    { value: 'greaterThanOrEqual', label: 'is greater than or equal', requiresValue: true },
    { value: 'lessThanOrEqual', label: 'is less than or equal', requiresValue: true },
    { value: 'isEmpty', label: 'is empty', requiresValue: false },
    { value: 'isNotEmpty', label: 'is not empty', requiresValue: false },
  ],
  date: [
    { value: 'is', label: 'is', requiresValue: true },
    { value: 'isNot', label: 'is not', requiresValue: true },
    { value: 'before', label: 'is before', requiresValue: true },
    { value: 'after', label: 'is after', requiresValue: true },
    { value: 'onOrBefore', label: 'is on or before', requiresValue: true },
    { value: 'onOrAfter', label: 'is on or after', requiresValue: true },
    { value: 'isEmpty', label: 'is empty', requiresValue: false },
    { value: 'isNotEmpty', label: 'is not empty', requiresValue: false },
  ],
  boolean: [
    { value: 'is', label: 'is', requiresValue: true },
    { value: 'isNot', label: 'is not', requiresValue: true },
  ],
  email: [
    { value: 'contains', label: 'contains', requiresValue: true },
    { value: 'notContains', label: 'does not contain', requiresValue: true },
    { value: 'is', label: 'is', requiresValue: true },
    { value: 'isNot', label: 'is not', requiresValue: true },
    { value: 'isEmpty', label: 'is empty', requiresValue: false },
    { value: 'isNotEmpty', label: 'is not empty', requiresValue: false },
  ],
  phone: [
    { value: 'contains', label: 'contains', requiresValue: true },
    { value: 'notContains', label: 'does not contain', requiresValue: true },
    { value: 'is', label: 'is', requiresValue: true },
    { value: 'isNot', label: 'is not', requiresValue: true },
    { value: 'isEmpty', label: 'is empty', requiresValue: false },
    { value: 'isNotEmpty', label: 'is not empty', requiresValue: false },
  ],
}

/**
 * Column type configurations
 */
export const COLUMN_TYPE_CONFIGS: Record<string, ColumnTypeConfig> = {
  text: {
    type: 'text',
    operators: FILTER_OPERATORS.text,
    defaultOperator: 'contains',
    inputType: 'text',
  },
  number: {
    type: 'number',
    operators: FILTER_OPERATORS.number,
    defaultOperator: 'equals',
    inputType: 'number',
    parseValue: (value: string) => parseFloat(value),
  },
  date: {
    type: 'date',
    operators: FILTER_OPERATORS.date,
    defaultOperator: 'is',
    inputType: 'date',
    formatValue: (value: Date) => value.toISOString().split('T')[0],
    parseValue: (value: string) => new Date(value),
  },
  boolean: {
    type: 'boolean',
    operators: FILTER_OPERATORS.boolean,
    defaultOperator: 'is',
    inputType: 'boolean',
  },
  email: {
    type: 'email',
    operators: FILTER_OPERATORS.email,
    defaultOperator: 'contains',
    inputType: 'text',
  },
  phone: {
    type: 'phone',
    operators: FILTER_OPERATORS.phone,
    defaultOperator: 'contains',
    inputType: 'text',
  },
}

/**
 * Sort options by column type
 */
export const SORT_OPTIONS: Record<string, SortOption[]> = {
  text: [
    { value: 'asc', label: 'Sort A-Z', icon: ArrowUpAZ },
    { value: 'desc', label: 'Sort Z-A', icon: ArrowDownZA },
  ],
  number: [
    { value: 'asc', label: 'Sort Ascending', icon: ArrowUp01 },
    { value: 'desc', label: 'Sort Descending', icon: ArrowDown10 },
  ],
  date: [
    { value: 'asc', label: 'Sort Oldest First', icon: CalendarArrowUp },
    { value: 'desc', label: 'Sort Newest First', icon: CalendarArrowDown },
  ],
  default: [
    { value: 'asc', label: 'Sort Ascending', icon: ArrowUp },
    { value: 'desc', label: 'Sort Descending', icon: ArrowDown },
  ],
}

/**
 * Column type icons
 */
export const COLUMN_TYPE_ICONS = {
  text: Text,
  number: Hash,
  date: Calendar,
  boolean: ToggleLeft,
  email: AtSign,
  phone: Phone,
  custom: FileText,
}

/**
 * Fixed row height for all rows
 */
export const ROW_HEIGHT = 38

/**
 * Default column widths
 */
export const DEFAULT_COLUMN_WIDTHS = {
  select: 40,
  star: 36,
  actions: 70,
} as const
