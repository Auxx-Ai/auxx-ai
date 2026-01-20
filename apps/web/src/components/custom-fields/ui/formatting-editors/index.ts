// apps/web/src/components/custom-fields/ui/formatting-editors/index.ts

import type { FieldOptions } from '@auxx/lib/field-values/client'

export { NumberFormattingEditor } from './number-formatting-editor'
export { DateFormattingEditor } from './date-formatting-editor'
export { DateTimeFormattingEditor } from './datetime-formatting-editor'
export { TimeFormattingEditor } from './time-formatting-editor'
export { BooleanFormattingEditor } from './boolean-formatting-editor'
export { PhoneFormattingEditor } from './phone-formatting-editor'

/**
 * Display options type for internal state.
 * Flat structure containing all display-related options.
 */
export interface DisplayOptions {
  // NUMBER options
  decimals?: number
  useGrouping?: boolean
  displayAs?: 'number' | 'percentage' | 'compact' | 'bytes'
  prefix?: string
  suffix?: string
  // DATE/DATETIME/TIME options
  format?: 'short' | 'medium' | 'long' | 'relative' | 'iso' | 'time-only'
  timeFormat?: '12h' | '24h'
  // CHECKBOX options
  trueLabel?: string
  falseLabel?: string
  // PHONE options
  phoneFormat?: 'raw' | 'national' | 'international'
}

/** Keys that are display options (flat on field.options) */
const DISPLAY_OPTION_KEYS: (keyof DisplayOptions)[] = [
  'decimals',
  'useGrouping',
  'displayAs',
  'prefix',
  'suffix',
  'format',
  'timeFormat',
  'trueLabel',
  'falseLabel',
  'phoneFormat',
]

/**
 * Parse stored field options into display options state.
 * Extracts flat display option properties from field.options.
 */
export function parseDisplayOptions(fieldOptions?: FieldOptions): DisplayOptions {
  if (!fieldOptions) return {}
  const result: DisplayOptions = {}
  for (const key of DISPLAY_OPTION_KEYS) {
    if (key in fieldOptions && fieldOptions[key as keyof FieldOptions] !== undefined) {
      ;(result as any)[key] = fieldOptions[key as keyof FieldOptions]
    }
  }
  return result
}

/**
 * Format display options state into storage format.
 * Returns object with flat display option properties.
 * Filters out undefined values.
 */
export function formatDisplayOptions(options: DisplayOptions): Partial<DisplayOptions> {
  const result: Partial<DisplayOptions> = {}
  for (const key of DISPLAY_OPTION_KEYS) {
    if (options[key] !== undefined) {
      ;(result as any)[key] = options[key]
    }
  }
  return result
}
