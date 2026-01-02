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
import type { SortOption } from '../types'

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
