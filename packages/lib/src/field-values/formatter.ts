// packages/lib/src/field-values/formatter.ts

import type {
  ActorFieldOptions,
  TypedFieldValue,
  TypedFieldValueInput,
} from '@auxx/types/field-value'
import {
  isArrayReturnFieldType as isArrayReturnType,
  isMultiValueFieldType as isMultiValueType,
} from '@auxx/types/field-value'

/**
 * Options for field type checking.
 * - `actor`: ACTOR fields with `multiple: true` count as multi-value.
 * - `multi`: scalar types (TEXT/EMAIL/URL/PHONE/…) with `multi: true`
 *   are treated as multi-value — array on read, DELETE+INSERT on write.
 */
export interface FieldTypeOptions {
  actor?: ActorFieldOptions
  multi?: boolean
}

import type { FieldType } from '@auxx/database/types'
import {
  type ConverterOptions,
  converters,
  type FieldOptions,
  type FieldValueConverter,
} from './converters'

/**
 * Get converter for a field type.
 * Throws if field type is unknown.
 */
function getConverter(fieldType: FieldType): FieldValueConverter {
  const converter = converters[fieldType]
  if (!converter) {
    throw new Error(`Unknown field type: ${fieldType}`)
  }
  return converter
}

/**
 * Convert raw input → TypedFieldValueInput (for saving to database).
 *
 * - Accepts any input format
 * - Validates and coerces to correct type based on fieldType
 * - Returns null if value should be cleared
 * - For multi-value fields, handles arrays automatically
 *
 * @example
 * formatToTypedInput('john@example.com', 'EMAIL')
 * // → { type: 'text', value: 'john@example.com' }
 *
 * @example
 * formatToTypedInput(['tag1', 'tag2'], 'TAGS')
 * // → [{ type: 'option', optionId: 'tag1' }, { type: 'option', optionId: 'tag2' }]
 *
 * @example
 * formatToTypedInput('vendor:abc123', 'RELATIONSHIP')
 * // → { type: 'relationship', recordId: 'vendor:abc123' }
 */
export function formatToTypedInput(
  value: unknown,
  fieldType: FieldType,
  options?: ConverterOptions & { fieldOptions?: FieldTypeOptions }
): TypedFieldValueInput | TypedFieldValueInput[] | null {
  const converter = getConverter(fieldType)

  // Handle arrays for multi-value field types
  // For ACTOR: if caller sends an array, process as multi-value (options may not be available)
  const isMultiValue =
    isMultiValueFieldType(fieldType, options?.fieldOptions) ||
    (fieldType === 'ACTOR' && Array.isArray(value))

  if (Array.isArray(value) && isMultiValue) {
    const results: TypedFieldValueInput[] = []
    for (const item of value) {
      const converted = converter.toTypedInput(item, options)
      if (converted !== null) {
        results.push(converted)
      }
    }
    return results.length > 0 ? results : null
  }

  // Handle arrays for single-value fields that use array format (SINGLE_SELECT)
  // UI sends arrays for uniform handling, but these are single-value fields
  if (Array.isArray(value) && isArrayReturnFieldType(fieldType, options?.fieldOptions)) {
    return value.length > 0 ? converter.toTypedInput(value[0], options) : null
  }

  // Single value
  return converter.toTypedInput(value, options)
}

/**
 * Convert TypedFieldValue/Input → raw primitive value (for API calls).
 *
 * - Strips out metadata (id, timestamps)
 * - For relationships: returns RecordId string
 * - Called before sending to API
 *
 * @example
 * formatToRawValue({ id: 'fv-1', type: 'text', value: 'john@example.com', ... }, 'EMAIL')
 * // → 'john@example.com'
 *
 * @example
 * formatToRawValue([{ type: 'relationship', recordId: 'vendor:abc123' }], 'RELATIONSHIP')
 * // → ['vendor:abc123']
 */
export function formatToRawValue(
  value: TypedFieldValue | TypedFieldValueInput | TypedFieldValue[] | unknown,
  fieldType: FieldType
): unknown {
  const converter = getConverter(fieldType)

  // Handle arrays
  if (Array.isArray(value)) {
    const rawValues = value.map((v) => converter.toRawValue(v))
    // Filter out nulls for cleaner output
    return rawValues.filter((v) => v !== null && v !== undefined)
  }

  return converter.toRawValue(value)
}

/**
 * Convert TypedFieldValue → display value for UI.
 *
 * - Returns human-readable formatted string for most field types
 * - For RELATIONSHIP: returns raw relationship object for frontend hydration
 * - Applies options (decimals, currency, date format, etc.)
 * - options come from CustomField.options (unified source of truth)
 *
 * @example
 * formatToDisplayValue(
 *   { id: 'fv-1', type: 'date', value: '2024-01-15', ... },
 *   'DATE',
 *   { format: 'medium' }
 * )
 * // → 'Jan 15, 2024'
 *
 * @example
 * formatToDisplayValue(
 *   { id: 'fv-1', type: 'number', value: 1234.5, ... },
 *   'CURRENCY',
 *   { currencyCode: 'USD', decimals: 2 }
 * )
 * // → '$1,234.50'
 *
 * @example
 * formatToDisplayValue(
 *   { id: 'fv-1', type: 'relationship', recordId: 'vendor:abc123' },
 *   'RELATIONSHIP'
 * )
 * // → 'vendor:abc123'
 * // (frontend then uses useRelationship hook to fetch display names)
 */
export function formatToDisplayValue(
  value: TypedFieldValue | TypedFieldValue[] | null,
  fieldType: FieldType,
  options?: FieldOptions
): unknown {
  if (value === null || value === undefined) {
    return null
  }

  const converter = getConverter(fieldType)

  // Handle arrays for multi-value fields
  if (Array.isArray(value)) {
    return value.map((v) => converter.toDisplayValue(v, options))
  }

  return converter.toDisplayValue(value, options)
}

/**
 * Check if field type stores multiple values.
 * MULTI_SELECT, TAGS, FILE, and RELATIONSHIP can have multiple values.
 * ACTOR can also have multiple values when options.actor.multiple is true.
 * Used for WRITE operations to determine DELETE+INSERT vs UPSERT strategy.
 */
export function isMultiValueFieldType(fieldType: FieldType, options?: FieldTypeOptions): boolean {
  return isMultiValueType(fieldType, options)
}

/**
 * Check if field type should return values as an array.
 * Includes SINGLE_SELECT for uniform handling with MULTI_SELECT in UI.
 * ACTOR can also return arrays when options.actor.multiple is true.
 * Used for READ operations (getValue, batchGetValues, etc).
 */
export function isArrayReturnFieldType(fieldType: FieldType, options?: FieldTypeOptions): boolean {
  return isArrayReturnType(fieldType, options)
}

/**
 * Extract raw values from TypedFieldValue array.
 * Useful for displaying multi-value fields or comparisons.
 */
export function extractValues(
  values: TypedFieldValue | TypedFieldValue[] | null,
  fieldType: FieldType
): unknown[] {
  if (values === null || values === undefined) {
    return []
  }

  const converter = getConverter(fieldType)

  if (Array.isArray(values)) {
    return values.map((v) => converter.toRawValue(v)).filter((v) => v !== null && v !== undefined)
  }

  const raw = converter.toRawValue(values)
  return raw !== null && raw !== undefined ? [raw] : []
}

/**
 * Check if a value is empty based on field type.
 * Useful for conditional rendering and validation.
 */
export function isValueEmpty(value: unknown, fieldType: FieldType): boolean {
  if (value === null || value === undefined) {
    return true
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.length === 0 || value.every((v) => isValueEmpty(v, fieldType))
  }

  // Extract raw value and check
  const raw = formatToRawValue(value, fieldType)

  if (raw === null || raw === undefined) {
    return true
  }

  // String check
  if (typeof raw === 'string') {
    return raw.trim() === ''
  }

  // Array check
  if (Array.isArray(raw)) {
    return raw.length === 0
  }

  // Object check (for JSON types)
  if (typeof raw === 'object') {
    // Relationship with recordId: check if recordId is present
    if ('recordId' in raw) {
      return !(raw as { recordId: string }).recordId
    }
    // Generic object: check if empty
    return Object.keys(raw as object).length === 0
  }

  return false
}

/**
 * Compare two values for equality based on field type.
 * Handles TypedFieldValue, raw values, and arrays.
 */
export function areValuesEqual(value1: unknown, value2: unknown, fieldType: FieldType): boolean {
  const raw1 = formatToRawValue(value1, fieldType)
  const raw2 = formatToRawValue(value2, fieldType)

  // Handle null/undefined
  if (raw1 === null || raw1 === undefined) {
    return raw2 === null || raw2 === undefined
  }
  if (raw2 === null || raw2 === undefined) {
    return false
  }

  // Handle arrays
  if (Array.isArray(raw1) && Array.isArray(raw2)) {
    if (raw1.length !== raw2.length) return false
    return raw1.every((v, i) => deepEqual(v, raw2[i]))
  }

  // Handle objects
  if (typeof raw1 === 'object' && typeof raw2 === 'object') {
    return deepEqual(raw1, raw2)
  }

  // Primitive comparison
  return raw1 === raw2
}

/**
 * Deep equality check for objects and arrays.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return a === b

  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)

  if (keysA.length !== keysB.length) return false

  for (const key of keysA) {
    if (!keysB.includes(key)) return false
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false
    }
  }

  return true
}

// Re-export types for convenience
export type { ConverterOptions, FieldOptions, FieldValueConverter }
export type {
  BooleanFieldOptions,
  CurrencyFieldOptions,
  DateFieldOptions,
  EmailFieldOptions,
  NumberFieldOptions,
  PhoneFieldOptions,
  SelectFieldOptions,
  TextFieldOptions,
} from './converters'
