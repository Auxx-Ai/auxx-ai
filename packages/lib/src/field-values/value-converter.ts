// packages/lib/src/field-values/value-converter.ts

import { FieldType } from '@auxx/database/enums'
import {
  type TypedFieldValueInput,
  type TypedFieldValue,
  getValueType,
  isMultiValueFieldType,
} from '@auxx/types'
import type { SelectOption } from '@auxx/types'

/**
 * Extract raw value from {"data": x} wrapper if present (legacy format)
 */
function unwrapValue(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'data' in value &&
    Object.keys(value).length === 1
  ) {
    return (value as { data: unknown }).data
  }
  return value
}

/**
 * Find option ID from option value or label.
 * Options can have stable IDs, or we fall back to value.
 */
function findOptionId(
  value: string,
  options: SelectOption[]
): string | null {
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
 * Convert a raw value to TypedFieldValueInput based on field type.
 * Handles unwrapping of legacy { data: value } format.
 *
 * @param rawValue - Raw value (possibly wrapped in { data: x })
 * @param fieldType - The field type
 * @param options - Field options (for select fields)
 * @returns TypedFieldValueInput or array of inputs for multi-value, or null
 */
export function convertToTypedInput(
  rawValue: unknown,
  fieldType: string,
  options?: SelectOption[]
): TypedFieldValueInput | TypedFieldValueInput[] | null {
  // Handle null/undefined
  if (rawValue === null || rawValue === undefined) {
    return null
  }

  // Unwrap if in {"data": x} format
  const value = unwrapValue(rawValue)

  // Handle null/undefined after unwrapping
  if (value === null || value === undefined) {
    return null
  }

  // Empty string handling
  if (typeof value === 'string' && value.trim() === '') {
    return null
  }

  const valueType = getValueType(fieldType)

  switch (valueType) {
    case 'text':
      return { type: 'text', value: String(value) }

    case 'number': {
      if (typeof value === 'number') {
        return { type: 'number', value }
      }
      if (typeof value === 'string') {
        const parsed = parseFloat(value)
        if (!isNaN(parsed) && isFinite(parsed)) {
          return { type: 'number', value: parsed }
        }
      }
      return null
    }

    case 'boolean': {
      if (typeof value === 'boolean') {
        return { type: 'boolean', value }
      }
      if (typeof value === 'string') {
        const lower = value.toLowerCase().trim()
        if (lower === 'true' || lower === '1' || lower === 'yes') {
          return { type: 'boolean', value: true }
        }
        return { type: 'boolean', value: false }
      }
      return { type: 'boolean', value: Boolean(value) }
    }

    case 'date': {
      if (value instanceof Date) {
        return { type: 'date', value: value.toISOString() }
      }
      if (typeof value === 'string') {
        const date = new Date(value)
        if (!isNaN(date.getTime())) {
          return { type: 'date', value: date.toISOString() }
        }
      }
      return null
    }

    case 'json': {
      if (typeof value === 'object' && value !== null) {
        return { type: 'json', value: value as Record<string, unknown> }
      }
      return null
    }

    case 'option': {
      // Handle multi-select (array of values)
      if (isMultiValueFieldType(fieldType)) {
        let values: string[]
        if (Array.isArray(value)) {
          values = value.map((v) => String(v).trim()).filter(Boolean)
        } else if (typeof value === 'string') {
          values = value.split(',').map((v) => v.trim()).filter(Boolean)
        } else {
          values = [String(value).trim()]
        }

        // Convert each value to option input
        return values.map((v): TypedFieldValueInput => {
          const optionId = options ? findOptionId(v, options) : v
          return { type: 'option', optionId: optionId ?? v }
        })
      }

      // Single select
      const stringValue = String(value).trim()
      const optionId = options ? findOptionId(stringValue, options) : stringValue
      return { type: 'option', optionId: optionId ?? stringValue }
    }

    case 'relationship': {
      // Handle multi-relationship (array of IDs)
      if (isMultiValueFieldType(fieldType) && Array.isArray(value)) {
        return value.map((v): TypedFieldValueInput => ({
          type: 'relationship',
          relatedEntityId: String(v),
        }))
      }
      return { type: 'relationship', relatedEntityId: String(value) }
    }

    default:
      return { type: 'text', value: String(value) }
  }
}

/**
 * Extract the display value from a TypedFieldValue.
 * Returns a string suitable for display.
 */
export function getDisplayValue(
  typedValue: TypedFieldValue | TypedFieldValue[] | null,
  options?: SelectOption[]
): string {
  if (typedValue === null) {
    return ''
  }

  if (Array.isArray(typedValue)) {
    return typedValue.map((v) => getDisplayValue(v, options)).join(', ')
  }

  switch (typedValue.type) {
    case 'text':
    case 'date':
      return typedValue.value
    case 'number':
      return String(typedValue.value)
    case 'boolean':
      return typedValue.value ? 'Yes' : 'No'
    case 'json': {
      // Handle NAME field compound value { firstName, lastName }
      const jsonVal = typedValue.value as Record<string, unknown>
      if (jsonVal && typeof jsonVal === 'object' && ('firstName' in jsonVal || 'lastName' in jsonVal)) {
        const firstName = (jsonVal.firstName as string) ?? ''
        const lastName = (jsonVal.lastName as string) ?? ''
        return [firstName, lastName].filter(Boolean).join(' ').trim() || ''
      }
      // Fallback to JSON string for other json values
      return JSON.stringify(typedValue.value)
    }
    case 'option':
      // Use denormalized label if available, otherwise look up in options
      if (typedValue.label) {
        return typedValue.label
      }
      if (options) {
        const opt = options.find((o) => o.id === typedValue.optionId || o.value === typedValue.optionId)
        return opt?.label ?? typedValue.optionId
      }
      return typedValue.optionId
    case 'relationship':
      // Use denormalized displayName if available
      return typedValue.displayName ?? typedValue.relatedEntityId
  }
}
