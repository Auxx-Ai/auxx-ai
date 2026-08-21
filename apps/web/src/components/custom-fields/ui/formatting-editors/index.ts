// apps/web/src/components/custom-fields/ui/formatting-editors/index.ts

import type { FieldOptions } from '@auxx/lib/field-values/client'
import { type DisplayOptions, displayOptionsSchema } from '@auxx/types/custom-field'

export type { DisplayOptions }

export { BooleanFormattingEditor } from './boolean-formatting-editor'
export { CurrencyFormattingEditor } from './currency-formatting-editor'
export { DateFormattingEditor } from './date-formatting-editor'
export { DateTimeFormattingEditor } from './datetime-formatting-editor'
export { NumberFormattingEditor } from './number-formatting-editor'
export { PhoneFormattingEditor } from './phone-formatting-editor'
export { TextFormattingEditor } from './text-formatting-editor'
export { TimeFormattingEditor } from './time-formatting-editor'
export { UrlFormattingEditor } from './url-formatting-editor'

/**
 * Keys that are display options (flat on `field.options`).
 *
 * 🛑 DERIVED from the canonical `displayOptionsSchema`, never hand-listed. This
 * used to be a web-local copy of both the type and the key array, and it
 * silently ate every option the canonical schema gained but the copy did not —
 * a filter that runs on BOTH save and load, so the key vanished before tRPC and
 * the switch read back off. Adding a key in `@auxx/types/custom-field` is now
 * the whole change.
 *
 * `ai` is excluded on purpose: it is a nested block that `custom-field-form`
 * assembles and strips itself, not a flat display option.
 */
const DISPLAY_OPTION_KEYS = (
  Object.keys(displayOptionsSchema.shape) as (keyof DisplayOptions)[]
).filter((key) => key !== 'ai')

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
