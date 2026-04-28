// packages/lib/src/custom-fields/client.ts
'use client'

// Re-export types from @auxx/types for client components
export {
  // AI
  type AiOptions,
  type AiTriggerOn,
  aiOptionsSchema,
  aiTriggerOnSchema,
  aiTriggerOnValues,
  DEFAULT_SELECT_OPTION_COLOR,
  type FileOptions,
  // Union
  fieldOptionsUnionSchema,
  // File
  fileOptionsSchema,
  type RichReferencePrompt,
  richReferencePromptSchema,
  // Color constants
  SELECT_OPTION_COLORS,
  type SelectOption,
  type SelectOptionColor,
  // Select Option
  selectOptionSchema,
  type TargetTimeInStatus,
  // Target Time
  targetTimeInStatusSchema,
} from '@auxx/types/custom-field'
export { getAiPrompt, isAiEligible, isAiField } from './ai'
export { getCalcOptions, getEffectiveFieldType } from './calc'

export type { CalcOptions, CurrencyFieldOptions, NameFieldOptions } from './field-options'
export {
  extractFieldIds,
  extractFieldIdsFromString,
  type FormulaNode,
  formulaToString,
  stringToFormula,
} from './formula-converters'
export { PRIMARY_DISPLAY_ELIGIBLE_TYPES } from './types'

import type { SelectOptionColor } from '@auxx/types/custom-field'

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
    badgeClasses:
      'bg-red-50 text-red-600 border-black/10 dark:bg-[#4e1b28] dark:text-[#FFD1D1] dark:border-[#692623]',
  },
  {
    id: 'orange',
    label: 'Orange',
    swatch: 'bg-orange-500',
    badgeClasses:
      'bg-[#feeee1] text-[#9E3F00] border-[#fee0c8] dark:bg-[#432410] dark:text-[#FFC89E] dark:border-[#593217]',
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: 'bg-amber-500',
    badgeClasses:
      'bg-amber-50 text-amber-600 border-amber-200 dark:bg-[#3d2c0a] dark:text-[#FFDEA7] dark:border-[#5c4216]',
  },
  {
    id: 'green',
    label: 'Green',
    swatch: 'bg-green-500',
    badgeClasses:
      'bg-green-50 text-green-600 border-green-200 dark:bg-[#1d4034] dark:text-[#A7F2CF] dark:border-[#244a3a]',
  },
  {
    id: 'teal',
    label: 'Teal',
    swatch: 'bg-teal-500',
    badgeClasses:
      'bg-teal-50 text-teal-600 border-teal-200 dark:bg-[#1a3946] dark:text-[#A9EBFC] dark:border-[#0a4e6b]',
  },
  {
    id: 'blue',
    label: 'Blue',
    swatch: 'bg-blue-500',
    badgeClasses:
      'bg-blue-50 text-blue-600 border-blue-200 dark:bg-[#1d2e55] dark:text-[#C2D6FF] dark:border-[#2b3e6d]',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    swatch: 'bg-indigo-500',
    badgeClasses:
      'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-[#252058] dark:text-[#D0C8FF] dark:border-[#3b3578]',
  },
  {
    id: 'purple',
    label: 'Purple',
    swatch: 'bg-purple-500',
    badgeClasses:
      'bg-purple-50 text-purple-600 border-purple-200 dark:bg-[#2f1e5a]/50 dark:text-[#D8C4FF] border-purple-500/10',
  },
  {
    id: 'pink',
    label: 'Pink',
    swatch: 'bg-pink-500',
    badgeClasses:
      'bg-pink-50 text-pink-600 border-pink-200 dark:bg-[#4e1a3e] dark:text-[#FFD1EE] dark:border-[#6b2458]',
  },
]

/** Get color configuration by ID */
export function getOptionColor(colorId: SelectOptionColor): OptionColor {
  return OPTION_COLORS.find((c) => c.id === colorId) ?? OPTION_COLORS[0]!
}

/** Get swatch class for a color (for picker dots). Supports named colors and hex. */
export function getColorSwatch(color: string): string {
  // Handle hex colors with Tailwind arbitrary value
  if (color.startsWith('#')) {
    return `bg-[${color}]`
  }
  // Named color lookup
  return getOptionColor(color as SelectOptionColor).swatch
}

/** Get badge classes for a color (for displaying option values) */
export function getColorBadgeClasses(colorId: SelectOptionColor): string {
  return getOptionColor(colorId).badgeClasses
}
