// packages/lib/src/field-values/client.ts
'use client'

/**
 * Client-side utilities for working with TypedFieldValue.
 * Import types directly from '@auxx/types/field-value'.
 */

import type {
  TypedFieldValue,
  OptionFieldValue,
  RelationshipFieldValue,
} from '@auxx/types/field-value'
import type { SelectOption } from '@auxx/types/custom-field'

// Re-export converter utilities for client use (now includes rowToTypedValue)
export {
  convertToTypedInput,
  getDisplayValue,
  rowToTypedValue,
  type FieldValueRow,
} from './value-converter'

/**
 * Infer TypedFieldValue from a raw FieldValue row by checking which column is populated.
 * Used when field type is not available (e.g., from Drizzle relations without joins).
 */
export function inferTypedValueFromRow(row: FieldValueRow): TypedFieldValue {
  const base = {
    id: row.id,
    entityId: row.entityId,
    fieldId: row.fieldId,
    sortKey: row.sortKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }

  // Check which column is populated and infer type
  if (row.optionId != null) {
    return { ...base, type: 'option', optionId: row.optionId }
  }
  if (row.relatedEntityId != null) {
    return { ...base, type: 'relationship', relatedEntityId: row.relatedEntityId }
  }
  if (row.valueBoolean != null) {
    return { ...base, type: 'boolean', value: row.valueBoolean }
  }
  if (row.valueNumber != null) {
    return { ...base, type: 'number', value: row.valueNumber }
  }
  if (row.valueDate != null) {
    return { ...base, type: 'date', value: row.valueDate }
  }
  if (row.valueJson != null) {
    return { ...base, type: 'json', value: row.valueJson as Record<string, unknown> }
  }
  // Default to text
  return { ...base, type: 'text', value: row.valueText ?? '' }
}
