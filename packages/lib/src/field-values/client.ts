// packages/lib/src/field-values/client.ts
'use client'

/**
 * Client-side utilities for working with TypedFieldValue.
 * Import types directly from '@auxx/types/field-value'.
 */

import type {
  TypedFieldValue,
  TypedFieldValueInput,
  OptionFieldValue,
  RelationshipFieldValue,
} from '@auxx/types/field-value'
import type { SelectOption } from '@auxx/types/custom-field'

// Re-export converter utilities for client use
export { typedValueToLegacy, getDisplayValue } from './value-converter'

// =============================================================================
// CLIENT-SPECIFIC HELPERS
// =============================================================================

/**
 * Check if a typed value is empty (null, undefined, or empty string/array).
 */
export function isEmptyValue(value: TypedFieldValue | TypedFieldValue[] | null): boolean {
  if (value === null) return true
  if (Array.isArray(value)) return value.length === 0

  switch (value.type) {
    case 'text':
      return value.value === ''
    case 'option':
      return value.optionId === ''
    case 'relationship':
      return value.relatedEntityId === ''
    default:
      return false
  }
}

/**
 * Get the option label from an OptionFieldValue.
 * Falls back to optionId if label is not denormalized.
 */
export function getOptionLabel(value: OptionFieldValue, options?: SelectOption[]): string {
  if (value.label) return value.label

  if (options) {
    const option = options.find((o) => o.id === value.optionId || o.value === value.optionId)
    if (option) return option.label
  }

  return value.optionId
}

/**
 * Get all option labels from multi-select value.
 */
export function getOptionLabels(
  values: OptionFieldValue[],
  options?: SelectOption[]
): string[] {
  return values.map((v) => getOptionLabel(v, options))
}

/**
 * Get the display name from a RelationshipFieldValue.
 * Falls back to relatedEntityId if displayName is not denormalized.
 */
export function getRelationshipDisplay(value: RelationshipFieldValue): string {
  return value.displayName ?? value.relatedEntityId
}

/**
 * Compare two typed values for equality.
 */
export function valuesEqual(
  a: TypedFieldValue | TypedFieldValue[] | null,
  b: TypedFieldValue | TypedFieldValue[] | null
): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((av, i) => valuesEqual(av, b[i]!))
  }

  if (Array.isArray(a) || Array.isArray(b)) return false

  if (a.type !== b.type) return false

  switch (a.type) {
    case 'text':
    case 'date':
      return a.value === (b as typeof a).value
    case 'number':
      return a.value === (b as typeof a).value
    case 'boolean':
      return a.value === (b as typeof a).value
    case 'option':
      return a.optionId === (b as OptionFieldValue).optionId
    case 'relationship':
      return a.relatedEntityId === (b as RelationshipFieldValue).relatedEntityId
    case 'json':
      return JSON.stringify(a.value) === JSON.stringify((b as typeof a).value)
    default:
      return false
  }
}
