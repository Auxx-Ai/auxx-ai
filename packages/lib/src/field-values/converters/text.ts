// packages/lib/src/field-values/converters/text.ts

import type { TypedFieldValueInput, TypedFieldValue, TextFieldValue } from '@auxx/types/field-value'
import type { FieldValueConverter, TextDisplayOptions } from './index'

/**
 * Converter for text-based field types:
 * TEXT, EMAIL, URL, PHONE_INTL, ADDRESS, RICH_TEXT
 *
 * All these types store as valueText in the database.
 * Field-specific validation (email format, URL format, etc.) is handled
 * separately by field-value-validator.
 */
export const textConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts string, number (converts to string), or null/undefined.
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values (pass through the string value)
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'text') {
        const textValue = (typed as TextFieldValue).value
        if (!textValue || textValue.trim() === '') return null
        return { type: 'text', value: textValue }
      }
    }

    // Convert to string and trim
    const stringValue = String(value).trim()

    // Empty strings should clear the value
    if (stringValue === '') {
      return null
    }

    return { type: 'text', value: stringValue }
  },

  /**
   * Convert TypedFieldValue/Input to raw string value.
   * Used before API calls and for comparisons.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): string {
    if (value === null || value === undefined) {
      return ''
    }

    // Handle TypedFieldValue or TypedFieldValueInput
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'text') {
        return (typed as TextFieldValue).value ?? ''
      }
      // Unexpected type - return empty string
      return ''
    }

    // Handle raw string passthrough
    return String(value)
  },

  /**
   * Convert TypedFieldValue to display string.
   * Applies display options like truncation if provided.
   */
  toDisplayValue(value: TypedFieldValue, displayOptions?: TextDisplayOptions): string {
    if (!value) {
      return ''
    }

    const typed = value as TextFieldValue
    let displayValue = typed.value ?? ''

    // Apply truncation if specified
    if (displayOptions?.truncateLength && displayValue.length > displayOptions.truncateLength) {
      displayValue = displayValue.substring(0, displayOptions.truncateLength) + '...'
    }

    return displayValue
  },
}
