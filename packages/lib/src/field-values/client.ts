// packages/lib/src/field-values/client.ts

/**
 * Client-side utilities for working with TypedFieldValue.
 * Import types directly from '@auxx/types/field-value'.
 */

import type { TypedFieldValue } from '@auxx/types/field-value'
import type { FieldValueRow } from './types'

// NEW: Centralized Formatter API (preferred)
export {
  formatToTypedInput,
  formatToRawValue,
  formatToDisplayValue,
  isMultiValueFieldType,
  isArrayReturnFieldType,
  extractValues,
  isValueEmpty,
  areValuesEqual,
  type ConverterOptions,
  type FieldOptions,
  type NumberFieldOptions,
  type DateFieldOptions,
  type BooleanFieldOptions,
  type TextFieldOptions,
  type SelectFieldOptions,
  type PhoneFieldOptions,
} from './formatter'

// Converters (for direct access if needed)
export { converters } from './converters'

// Re-export relationship type guards from converter (centralized location)
export {
  isRelationshipFieldValue,
  isRelationshipFieldValueArray,
  isRelationshipRawValue,
  type RelationshipRawValue,
} from './converters/relationship'

// Row types (for inferTypedValueFromRow)
export type { FieldValueRow } from './types'

// Relationship utilities
export {
  extractRelationshipRecordIds,
  isMultiRelationship,
  isSingleRelationship,
  type RelationshipType,
} from './relationship-field'

// Re-export RecordId utilities from resources
export {
  toRecordId,
  parseRecordId,
  isRecordId,
  toRecordIds,
  getInstanceId,
  getDefinitionId,
} from './relationship-field'
export type { RecordId } from '@auxx/types/resource'

/**
 * Infer TypedFieldValue from a raw FieldValue row by checking which column is populated.
 * Used when field type is not available (e.g., from Drizzle relations without joins).
 */
// export function inferTypedValueFromRow(row: FieldValueRow): TypedFieldValue {
//   const base = {
//     id: row.id,
//     entityId: row.entityId,
//     fieldId: row.fieldId,
//     sortKey: row.sortKey,
//     createdAt: row.createdAt,
//     updatedAt: row.updatedAt,
//   }

//   // Check which column is populated and infer type
//   if (row.optionId != null) {
//     return { ...base, type: 'option', optionId: row.optionId }
//   }
//   if (row.relatedEntityId != null) {
//     return {
//       ...base,
//       type: 'relationship',
//       relatedEntityId: row.relatedEntityId,
//       relatedEntityDefinitionId: row.relatedEntityDefinitionId ?? '',
//     }
//   }
//   if (row.valueBoolean != null) {
//     return { ...base, type: 'boolean', value: row.valueBoolean }
//   }
//   if (row.valueNumber != null) {
//     return { ...base, type: 'number', value: row.valueNumber }
//   }
//   if (row.valueDate != null) {
//     return { ...base, type: 'date', value: row.valueDate }
//   }
//   if (row.valueJson != null) {
//     return { ...base, type: 'json', value: row.valueJson as Record<string, unknown> }
//   }
//   // Default to text
//   return { ...base, type: 'text', value: row.valueText ?? '' }
// }
