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
export {
  FIELD_TYPE_COMPATIBILITY_MAP,
  isFieldTypeCompatible,
  PRIMARY_DISPLAY_ELIGIBLE_TYPES,
} from './types'

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
  /**
   * Raw hex (the `swatch`'s Tailwind-500 shade) for surfaces that need an actual color value
   * rather than a class — e.g. the calendar chip's `--ec-color`. Some palette ids (`amber`,
   * `forest`) are NOT valid CSS color names, so consumers must resolve to this, never the id.
   */
  hex: string
  /** Badge-style classes for displaying option values */
  badgeClasses: string
  /** Darker border classes for the selected/active state (overrides badgeClasses' border) */
  selectedBorderClasses: string
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
    hex: '#71717a',
    badgeClasses: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    selectedBorderClasses: 'border-zinc-400 dark:border-zinc-400',
  },
  {
    id: 'red',
    label: 'Red',
    swatch: 'bg-red-500',
    hex: '#ef4444',
    badgeClasses:
      'bg-red-50 text-red-600 border-black/10 dark:bg-[#4e1b28] dark:text-[#FFD1D1] dark:border-[#692623]',
    selectedBorderClasses: 'border-red-400 dark:border-red-400',
  },
  {
    id: 'orange',
    label: 'Orange',
    swatch: 'bg-orange-500',
    hex: '#f97316',
    badgeClasses:
      'bg-[#feeee1] text-[#9E3F00] border-[#fee0c8] dark:bg-[#432410] dark:text-[#FFC89E] dark:border-[#593217]',
    selectedBorderClasses: 'border-orange-400 dark:border-orange-400',
  },
  {
    id: 'amber',
    label: 'Amber',
    swatch: 'bg-amber-500',
    hex: '#f59e0b',
    badgeClasses:
      'bg-amber-50 text-amber-600 border-amber-200 dark:bg-[#3d2c0a] dark:text-[#FFDEA7] dark:border-[#5c4216]',
    selectedBorderClasses: 'border-amber-400 dark:border-amber-400',
  },
  {
    id: 'green',
    label: 'Green',
    swatch: 'bg-green-500',
    hex: '#22c55e',
    badgeClasses:
      'bg-green-50 text-green-600 border-green-200 dark:bg-[#1d4034] dark:text-[#A7F2CF] dark:border-[#244a3a]',
    selectedBorderClasses: 'border-green-400 dark:border-green-400',
  },
  {
    id: 'forest',
    label: 'Forest',
    swatch: 'bg-green-800',
    hex: '#166534',
    badgeClasses:
      'bg-green-100 text-green-900 border-green-500 dark:bg-[#0f2e21] dark:text-[#7ECFA6] dark:border-[#1a4631]',
    selectedBorderClasses: 'border-green-600 dark:border-green-500',
  },
  {
    id: 'teal',
    label: 'Teal',
    swatch: 'bg-teal-500',
    hex: '#14b8a6',
    badgeClasses:
      'bg-teal-50 text-teal-600 border-teal-200 dark:bg-[#1a3946] dark:text-[#A9EBFC] dark:border-[#0a4e6b]',
    selectedBorderClasses: 'border-teal-400 dark:border-teal-400',
  },
  {
    id: 'blue',
    label: 'Blue',
    swatch: 'bg-blue-500',
    hex: '#3b82f6',
    badgeClasses:
      'bg-blue-50 text-blue-600 border-blue-200 dark:bg-[#1d2e55] dark:text-[#C2D6FF] dark:border-[#2b3e6d]',
    selectedBorderClasses: 'border-blue-400 dark:border-blue-400',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    swatch: 'bg-indigo-500',
    hex: '#6366f1',
    badgeClasses:
      'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-[#252058] dark:text-[#D0C8FF] dark:border-[#3b3578]',
    selectedBorderClasses: 'border-indigo-400 dark:border-indigo-400',
  },
  {
    id: 'purple',
    label: 'Purple',
    swatch: 'bg-purple-500',
    hex: '#a855f7',
    badgeClasses:
      'bg-purple-50 text-purple-600 border-purple-200 dark:bg-[#2f1e5a]/50 dark:text-[#D8C4FF] border-purple-500/10',
    selectedBorderClasses: 'border-purple-400 dark:border-purple-400',
  },
  {
    id: 'pink',
    label: 'Pink',
    swatch: 'bg-pink-500',
    hex: '#ec4899',
    badgeClasses:
      'bg-pink-50 text-pink-600 border-pink-200 dark:bg-[#4e1a3e] dark:text-[#FFD1EE] dark:border-[#6b2458]',
    selectedBorderClasses: 'border-pink-400 dark:border-pink-400',
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

/**
 * Resolve a color to a raw hex string for surfaces that feed an actual CSS color value (e.g. the
 * calendar chip's `--ec-color`). Passes hex through untouched; otherwise maps the palette id to
 * its `hex`. Critical because several palette ids (`amber`, `forest`) are not valid CSS color
 * names — feeding the id straight into `color-mix()` renders as nothing.
 */
export function getOptionColorHex(color: string): string {
  if (color.startsWith('#')) return color
  return getOptionColor(color as SelectOptionColor).hex
}

/** Get badge classes for a color (for displaying option values) */
export function getColorBadgeClasses(colorId: SelectOptionColor): string {
  return getOptionColor(colorId).badgeClasses
}

/** Get darker border classes for a color's selected/active state */
export function getColorSelectedBorderClasses(colorId: SelectOptionColor): string {
  return getOptionColor(colorId).selectedBorderClasses
}
