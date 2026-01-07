// packages/lib/src/field-values/converters/select.ts

import type { TypedFieldValueInput, TypedFieldValue, OptionFieldValue } from '@auxx/types/field-value'
import type { FieldValueConverter, ConverterOptions, SelectDisplayOptions } from './index'

/**
 * Converter for select-based field types:
 * SINGLE_SELECT, MULTI_SELECT, TAGS
 *
 * All store as optionId in the database.
 * Note: Multi-value handling (MULTI_SELECT, TAGS) is done at the formatter level,
 * not in this converter. This converter handles individual option values.
 */
export const selectConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts option ID string, option object, or null/undefined.
   */
  toTypedInput(value: unknown, options?: ConverterOptions): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'option') {
        const optionId = (typed as OptionFieldValue).optionId
        if (!optionId) return null
        return { type: 'option', optionId }
      }
    }

    // Handle empty string
    if (typeof value === 'string' && value.trim() === '') {
      return null
    }

    // Handle string value (could be option ID, value, or label)
    if (typeof value === 'string') {
      const stringValue = value.trim()
      const optionId = findOptionId(stringValue, options?.selectOptions)
      return { type: 'option', optionId: optionId ?? stringValue }
    }

    // Handle object with id or value
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>
      if ('optionId' in obj && typeof obj.optionId === 'string') {
        return { type: 'option', optionId: obj.optionId }
      }
      if ('id' in obj && typeof obj.id === 'string') {
        return { type: 'option', optionId: obj.id }
      }
      if ('value' in obj && typeof obj.value === 'string') {
        const optionId = findOptionId(obj.value, options?.selectOptions)
        return { type: 'option', optionId: optionId ?? obj.value }
      }
    }

    return null
  },

  /**
   * Convert TypedFieldValue/Input to raw option ID string.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): string | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle TypedFieldValue or TypedFieldValueInput
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as TypedFieldValue
      if (typed.type === 'option') {
        return (typed as OptionFieldValue).optionId ?? null
      }
      return null
    }

    // Handle object with optionId
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>
      if ('optionId' in obj && typeof obj.optionId === 'string') {
        return obj.optionId
      }
      if ('id' in obj && typeof obj.id === 'string') {
        return obj.id
      }
    }

    // Handle raw string passthrough
    if (typeof value === 'string') {
      return value || null
    }

    return null
  },

  /**
   * Convert TypedFieldValue to display value.
   * Returns the label if available, otherwise the option ID.
   */
  toDisplayValue(value: TypedFieldValue, displayOptions?: SelectDisplayOptions): string {
    if (!value) {
      return ''
    }

    const typed = value as OptionFieldValue

    // Use denormalized label if available
    if (typed.label) {
      return applyTruncation(typed.label, displayOptions)
    }

    // Fall back to option ID
    return applyTruncation(typed.optionId ?? '', displayOptions)
  },
}

/**
 * Find option ID from a value, label, or id.
 * Options can have stable IDs, or we fall back to the value.
 */
function findOptionId(
  value: string,
  options?: { id?: string; value: string; label: string }[]
): string | null {
  if (!options || options.length === 0) {
    return null
  }

  const option = options.find(
    (opt) => opt.value === value || opt.label === value || opt.id === value
  )

  if (option) {
    // Prefer stable ID if available, otherwise use value
    return option.id ?? option.value
  }

  return null
}

/**
 * Apply truncation to label if specified in display options.
 */
function applyTruncation(label: string, displayOptions?: SelectDisplayOptions): string {
  if (!displayOptions?.truncateLabel) {
    return label
  }

  // Default truncation length of 30 characters
  const maxLength = 30
  if (label.length > maxLength) {
    return label.substring(0, maxLength) + '...'
  }

  return label
}
