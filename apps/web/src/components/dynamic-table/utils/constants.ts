// apps/web/src/components/dynamic-table/utils/constants.ts

import type { FieldType } from '@auxx/database/types'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type {
  ColumnOrderState,
  ColumnSizingState,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowDown10,
  ArrowDownZA,
  ArrowUp,
  ArrowUp01,
  ArrowUpAZ,
  CalendarArrowDown,
  CalendarArrowUp,
} from 'lucide-react'
import type { ColumnFormatting, SortOption, TableView } from '../types'

// ============================================================================
// STABLE EMPTY REFERENCES (prevent re-renders)
// ============================================================================

export const EMPTY_VIEWS: TableView[] = []
export const EMPTY_FILTERS: ConditionGroup[] = []
export const EMPTY_SORTING: SortingState = []
export const EMPTY_COLUMN_ORDER: ColumnOrderState = []
export const EMPTY_COLUMN_VISIBILITY: VisibilityState = {}
export const EMPTY_COLUMN_SIZING: ColumnSizingState = {}
export const EMPTY_COLUMN_LABELS: Record<string, string> = {}
export const EMPTY_COLUMN_FORMATTING: Record<string, ColumnFormatting> = {}
export const EMPTY_ROW_SELECTION: RowSelectionState = {}

/** Text-like sort options (A-Z) */
const TEXT_SORT: SortOption[] = [
  { value: 'asc', label: 'Sort A-Z', icon: ArrowUpAZ },
  { value: 'desc', label: 'Sort Z-A', icon: ArrowDownZA },
]

/** Numeric sort options (1-9) */
const NUMBER_SORT: SortOption[] = [
  { value: 'asc', label: 'Sort Ascending', icon: ArrowUp01 },
  { value: 'desc', label: 'Sort Descending', icon: ArrowDown10 },
]

/** Date sort options (calendar) */
const DATE_SORT: SortOption[] = [
  { value: 'asc', label: 'Sort Oldest First', icon: CalendarArrowUp },
  { value: 'desc', label: 'Sort Newest First', icon: CalendarArrowDown },
]

/** Default sort options */
const DEFAULT_SORT: SortOption[] = [
  { value: 'asc', label: 'Sort Ascending', icon: ArrowUp },
  { value: 'desc', label: 'Sort Descending', icon: ArrowDown },
]

/**
 * Sort options keyed by FieldType
 */
export const SORT_OPTIONS: Partial<Record<FieldType, SortOption[]>> & { default: SortOption[] } = {
  // Text-like types
  TEXT: TEXT_SORT,
  EMAIL: TEXT_SORT,
  URL: TEXT_SORT,
  RICH_TEXT: TEXT_SORT,
  NAME: TEXT_SORT,
  SINGLE_SELECT: TEXT_SORT,
  MULTI_SELECT: TEXT_SORT,
  TAGS: TEXT_SORT,
  PHONE_INTL: TEXT_SORT,
  ADDRESS: TEXT_SORT,
  ADDRESS_STRUCT: TEXT_SORT,

  // Numeric types
  NUMBER: NUMBER_SORT,
  CURRENCY: NUMBER_SORT,

  // Date types
  DATE: DATE_SORT,
  DATETIME: DATE_SORT,
  TIME: DATE_SORT,

  // Default fallback
  default: DEFAULT_SORT,
}

/**
 * Get sort options for a field type
 */
export function getSortOptionsForFieldType(fieldType?: FieldType): SortOption[] {
  if (!fieldType) return SORT_OPTIONS.default
  return SORT_OPTIONS[fieldType] ?? SORT_OPTIONS.default
}

/**
 * Fixed row height for all rows
 */
export const ROW_HEIGHT = 38

/**
 * Toolbar height (py-2 + content height)
 */
export const TOOLBAR_HEIGHT = 44

/**
 * Header row height
 */
export const HEADER_HEIGHT = 40

/**
 * Checkbox column width
 */
export const CHECKBOX_WIDTH = 40

/**
 * Actions column width
 */
export const ACTIONS_WIDTH = 70

/**
 * Default column widths
 */
export const DEFAULT_COLUMN_WIDTHS = {
  select: 40,
  star: 36,
  actions: 70,
} as const
