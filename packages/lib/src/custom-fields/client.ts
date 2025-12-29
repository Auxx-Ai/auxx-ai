// packages/lib/src/custom-fields/client.ts
'use client'

import type { SelectOptionColor } from './types'

// Re-export types and schemas for convenience
export {
  // Color constants
  SELECT_OPTION_COLORS,
  DEFAULT_SELECT_OPTION_COLOR,
  type SelectOptionColor,
  // Select Option
  selectOptionSchema,
  type SelectOption,
  // Target Time
  targetTimeInStatusSchema,
  type TargetTimeInStatus,
  // Currency
  currencyOptionsSchema,
  decimalPlacesValues,
  currencyDisplayTypeValues,
  currencyGroupsValues,
  type CurrencyOptions,
  type DecimalPlaces,
  type CurrencyDisplayType,
  type CurrencyGroups,
  // File
  fileOptionsSchema,
  type FileOptions,
  // Union
  fieldOptionsUnionSchema,
} from './types'

/**
 * Color configuration for select options
 * Matches ICON_COLORS from icon-picker for consistency
 */
export interface OptionColor {
  id: SelectOptionColor
  label: string
  /** Swatch class for color picker dots */
  swatch: string
  /** Badge-style classes for displaying option values */
  badgeClasses: string
}

/**
 * Available colors for select options with their styling classes
 * Matches ICON_COLORS from icon-picker
 */
export const OPTION_COLORS: OptionColor[] = [
  {
    id: 'gray',
    label: 'Gray',
    swatch: 'bg-zinc-500',
    badgeClasses: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
  {
    id: 'red',
    label: 'Red',
    swatch: 'bg-red-500',
    badgeClasses: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
  },
  {
    id: 'orange',
    label: 'Orange',
    swatch: 'bg-orange-500',
    badgeClasses: 'bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400',
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: 'bg-amber-500',
    badgeClasses: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  },
  {
    id: 'green',
    label: 'Green',
    swatch: 'bg-green-500',
    badgeClasses: 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400',
  },
  {
    id: 'teal',
    label: 'Teal',
    swatch: 'bg-teal-500',
    badgeClasses: 'bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400',
  },
  {
    id: 'blue',
    label: 'Blue',
    swatch: 'bg-blue-500',
    badgeClasses: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    swatch: 'bg-indigo-500',
    badgeClasses: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400',
  },
  {
    id: 'purple',
    label: 'Purple',
    swatch: 'bg-purple-500',
    badgeClasses: 'bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400',
  },
  {
    id: 'pink',
    label: 'Pink',
    swatch: 'bg-pink-500',
    badgeClasses: 'bg-pink-50 text-pink-600 dark:bg-pink-950 dark:text-pink-400',
  },
]

/** Get color configuration by ID */
export function getOptionColor(colorId: SelectOptionColor): OptionColor {
  return OPTION_COLORS.find((c) => c.id === colorId) ?? OPTION_COLORS[0]!
}

/** Get swatch class for a color (for picker dots) */
export function getColorSwatch(colorId: SelectOptionColor): string {
  return getOptionColor(colorId).swatch
}

/** Get badge classes for a color (for displaying option values) */
export function getColorBadgeClasses(colorId: SelectOptionColor): string {
  return getOptionColor(colorId).badgeClasses
}
