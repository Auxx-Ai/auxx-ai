// packages/lib/src/field-values/converters/boolean.ts

import type {
  BooleanFieldValue,
  TypedFieldValue,
  TypedFieldValueInput,
} from '@auxx/types/field-value'
import { DEFAULT_BOOLEAN_OPTIONS } from '../../custom-fields/defaults'
import type { FieldOptions, FieldValueConverter } from './index'

/**
 * Converter for CHECKBOX field type.
 * Stores as valueBoolean in the database.
 */
export const booleanConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts boolean, string ("true"/"false"/"yes"/"no"/"1"/"0"), or null/undefined.
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'boolean') {
        return { type: 'boolean', value: (typed as BooleanFieldValue).value }
      }
    }

    // Direct boolean
    if (typeof value === 'boolean') {
      return { type: 'boolean', value }
    }

    // Parse string representations
    if (typeof value === 'string') {
      const lower = value.toLowerCase().trim()
      if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') {
        return { type: 'boolean', value: true }
      }
      if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off' || lower === '') {
        return { type: 'boolean', value: false }
      }
    }

    // Parse number (0 = false, non-zero = true)
    if (typeof value === 'number') {
      return { type: 'boolean', value: value !== 0 }
    }

    // Default to false for other values
    return { type: 'boolean', value: Boolean(value) }
  },

  /**
   * Convert TypedFieldValue/Input to raw boolean value.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): boolean {
    if (value === null || value === undefined) {
      return false
    }

    // Handle TypedFieldValue or TypedFieldValueInput
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'boolean') {
        return (typed as BooleanFieldValue).value ?? false
      }
      return false
    }

    // Handle raw boolean passthrough
    if (typeof value === 'boolean') {
      return value
    }

    return Boolean(value)
  },

  /**
   * Convert TypedFieldValue to display string.
   * Applies display options for custom labels.
   */
  toDisplayValue(value: TypedFieldValue, options?: FieldOptions): string {
    if (!value) {
      return ''
    }

    const typed = value as BooleanFieldValue
    const boolValue = typed.value ?? false

    // Merge defaults with provided options
    const opts = { ...DEFAULT_BOOLEAN_OPTIONS, ...options }

    if (opts.checkboxStyle === 'icon') {
      // Return icon characters - frontend can render these as icons
      return boolValue ? '✓' : '✗'
    }

    return boolValue ? opts.trueLabel : opts.falseLabel
  },
}
