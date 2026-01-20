// packages/types/field-value/index.ts

import { z } from 'zod'
import { FieldType } from '@auxx/database/enums'
import { type RecordId, recordIdSchema, toRecordId, isRecordId } from '@auxx/types/resource'

// =============================================================================
// VALUE TYPE CONSTANTS
// =============================================================================

/**
 * Maps database FieldType enum to the value type used for storage.
 * Determines which column in FieldValue table is populated.
 */
export const FIELD_TYPE_TO_VALUE_TYPE = {
  [FieldType.TEXT]: 'text',
  [FieldType.RICH_TEXT]: 'text',
  [FieldType.EMAIL]: 'text',
  [FieldType.URL]: 'text',
  [FieldType.PHONE_INTL]: 'text',
  [FieldType.NAME]: 'json', // Compound field: { firstName, lastName }
  [FieldType.NUMBER]: 'number',
  [FieldType.CURRENCY]: 'number',
  [FieldType.CHECKBOX]: 'boolean',
  [FieldType.DATE]: 'date',
  [FieldType.DATETIME]: 'date',
  [FieldType.TIME]: 'date',
  [FieldType.SINGLE_SELECT]: 'option',
  [FieldType.MULTI_SELECT]: 'option',
  [FieldType.TAGS]: 'option',
  [FieldType.RELATIONSHIP]: 'relationship',
  [FieldType.FILE]: 'json',
  [FieldType.ADDRESS]: 'text',
  [FieldType.ADDRESS_STRUCT]: 'json',
} as const

/** Value type discriminator */
export type ValueType = (typeof FIELD_TYPE_TO_VALUE_TYPE)[keyof typeof FIELD_TYPE_TO_VALUE_TYPE]

/**
 * Maps database FieldType enum to the FieldValue table column name.
 */
export const FIELD_TYPE_TO_COLUMN = {
  [FieldType.TEXT]: 'valueText',
  [FieldType.RICH_TEXT]: 'valueText',
  [FieldType.EMAIL]: 'valueText',
  [FieldType.URL]: 'valueText',
  [FieldType.PHONE_INTL]: 'valueText',
  [FieldType.NAME]: 'valueJson', // Compound field: { firstName, lastName }
  [FieldType.NUMBER]: 'valueNumber',
  [FieldType.CURRENCY]: 'valueNumber',
  [FieldType.CHECKBOX]: 'valueBoolean',
  [FieldType.DATE]: 'valueDate',
  [FieldType.DATETIME]: 'valueDate',
  [FieldType.TIME]: 'valueDate',
  [FieldType.SINGLE_SELECT]: 'optionId',
  [FieldType.MULTI_SELECT]: 'optionId',
  [FieldType.TAGS]: 'optionId',
  [FieldType.RELATIONSHIP]: 'relatedEntityId',
  [FieldType.FILE]: 'valueJson',
  [FieldType.ADDRESS]: 'valueText',
  [FieldType.ADDRESS_STRUCT]: 'valueJson',
} as const

/** Column name in FieldValue table */
export type ValueColumn = (typeof FIELD_TYPE_TO_COLUMN)[keyof typeof FIELD_TYPE_TO_COLUMN]

/**
 * Field types that support multiple values (stored as multiple FieldValue rows).
 * RELATIONSHIP is included because it supports many-to-many cardinality.
 * Used for WRITE operations to determine DELETE+INSERT vs UPSERT strategy.
 */
export const MULTI_VALUE_FIELD_TYPES = new Set<string>([
  FieldType.MULTI_SELECT,
  FieldType.TAGS,
  FieldType.FILE,
  FieldType.RELATIONSHIP,
])

/**
 * Field types that return values as arrays from READ operations.
 * Includes SINGLE_SELECT for uniform handling with MULTI_SELECT in UI.
 * Note: This does NOT affect write strategy - use MULTI_VALUE_FIELD_TYPES for that.
 */
export const ARRAY_RETURN_FIELD_TYPES = new Set<string>([
  FieldType.SINGLE_SELECT,
  FieldType.MULTI_SELECT,
  FieldType.TAGS,
  FieldType.FILE,
  FieldType.RELATIONSHIP,
])

// =============================================================================
// TYPED FIELD VALUE - DATABASE ENTITIES (full data from FieldValue table)
// =============================================================================

/** Base fields present on all FieldValue records */
interface BaseFieldValue {
  id: string
  entityId: string
  fieldId: string
  sortKey: string
  createdAt: string
  updatedAt: string
}

/** Text value for TEXT, RICH_TEXT, NAME, EMAIL, URL, PHONE_INTL, ADDRESS fields */
export interface TextFieldValue extends BaseFieldValue {
  type: 'text'
  value: string
}

/** Numeric value for NUMBER, CURRENCY fields */
export interface NumberFieldValue extends BaseFieldValue {
  type: 'number'
  value: number
}

/** Boolean value for CHECKBOX fields */
export interface BooleanFieldValue extends BaseFieldValue {
  type: 'boolean'
  value: boolean
}

/** Date/time value for DATE, DATETIME, TIME fields */
export interface DateFieldValue extends BaseFieldValue {
  type: 'date'
  value: string // ISO 8601 format
}

/** JSON value for FILE, ADDRESS_STRUCT, and complex types */
export interface JsonFieldValue extends BaseFieldValue {
  type: 'json'
  value: Record<string, unknown>
}

/** Option value for SINGLE_SELECT, MULTI_SELECT, TAGS fields */
export interface OptionFieldValue extends BaseFieldValue {
  type: 'option'
  optionId: string
  /** Denormalized for display (from SelectOption.label) */
  label?: string
  /** Denormalized for display (from SelectOption.color) */
  color?: string
}

/** Relationship value for RELATIONSHIP fields */
export interface RelationshipFieldValue extends BaseFieldValue {
  type: 'relationship'
  /** RecordId format: "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  /** Denormalized for display */
  displayName?: string
}

/** Discriminated union of all typed field values */
export type TypedFieldValue =
  | TextFieldValue
  | NumberFieldValue
  | BooleanFieldValue
  | DateFieldValue
  | JsonFieldValue
  | OptionFieldValue
  | RelationshipFieldValue

// =============================================================================
// TYPED FIELD VALUE INPUT - For mutations (no id/timestamps/sortKey)
// =============================================================================

/** Text value input */
export interface TextFieldValueInput {
  type: 'text'
  value: string
}

/** Number value input */
export interface NumberFieldValueInput {
  type: 'number'
  value: number
}

/** Boolean value input */
export interface BooleanFieldValueInput {
  type: 'boolean'
  value: boolean
}

/** Date value input */
export interface DateFieldValueInput {
  type: 'date'
  value: string | Date
}

/** JSON value input */
export interface JsonFieldValueInput {
  type: 'json'
  value: Record<string, unknown>
}

/** Option value input */
export interface OptionFieldValueInput {
  type: 'option'
  optionId: string
}

/** Relationship value input */
export interface RelationshipFieldValueInput {
  type: 'relationship'
  /** RecordId format: "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
}

/** Discriminated union of all typed field value inputs */
export type TypedFieldValueInput =
  | TextFieldValueInput
  | NumberFieldValueInput
  | BooleanFieldValueInput
  | DateFieldValueInput
  | JsonFieldValueInput
  | OptionFieldValueInput
  | RelationshipFieldValueInput

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

/** Schema for text value input */
export const textFieldValueInputSchema = z.object({
  type: z.literal('text'),
  value: z.string(),
})

/** Schema for number value input */
export const numberFieldValueInputSchema = z.object({
  type: z.literal('number'),
  value: z.number(),
})

/** Schema for boolean value input */
export const booleanFieldValueInputSchema = z.object({
  type: z.literal('boolean'),
  value: z.boolean(),
})

/** Schema for date value input */
export const dateFieldValueInputSchema = z.object({
  type: z.literal('date'),
  value: z.union([z.string(), z.date()]),
})

/** Schema for json value input */
export const jsonFieldValueInputSchema = z.object({
  type: z.literal('json'),
  value: z.record(z.unknown()),
})

/** Schema for option value input */
export const optionFieldValueInputSchema = z.object({
  type: z.literal('option'),
  optionId: z.string(),
})

/** Schema for relationship value input */
export const relationshipFieldValueInputSchema = z.object({
  type: z.literal('relationship'),
  recordId: recordIdSchema,
})

/** Schema for typed field value input (discriminated union) */
export const typedFieldValueInputSchema = z.discriminatedUnion('type', [
  textFieldValueInputSchema,
  numberFieldValueInputSchema,
  booleanFieldValueInputSchema,
  dateFieldValueInputSchema,
  jsonFieldValueInputSchema,
  optionFieldValueInputSchema,
  relationshipFieldValueInputSchema,
])

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if a field type supports multiple values.
 * Used for WRITE operations to determine DELETE+INSERT vs UPSERT strategy.
 * @param fieldType - The database field type
 * @returns True if field can have multiple values
 */
export function isMultiValueFieldType(fieldType: string): boolean {
  return MULTI_VALUE_FIELD_TYPES.has(fieldType)
}

/**
 * Check if a field type should return values as an array.
 * Used for READ operations (getValue, batchGetValues, etc).
 * @param fieldType - The database field type
 * @returns True if getValue/batchGetValues should return array
 */
export function isArrayReturnFieldType(fieldType: string): boolean {
  return ARRAY_RETURN_FIELD_TYPES.has(fieldType)
}

/**
 * Get the value column name for a field type.
 * @param fieldType - The database field type
 * @returns Column name in FieldValue table
 */
export function getValueColumn(fieldType: string): ValueColumn {
  return (FIELD_TYPE_TO_COLUMN as Record<string, ValueColumn>)[fieldType] ?? 'valueText'
}

/**
 * Get the value type for a field type.
 * @param fieldType - The database field type
 * @returns Value type discriminator
 */
export function getValueType(fieldType: string): ValueType {
  return (FIELD_TYPE_TO_VALUE_TYPE as Record<string, ValueType>)[fieldType] ?? 'text'
}

/**
 * Extract the raw value from a TypedFieldValue based on its type.
 * Useful for displaying or comparing values.
 */
export function extractValue(
  typedValue: TypedFieldValue
): string | number | boolean | Record<string, unknown> {
  switch (typedValue.type) {
    case 'text':
    case 'date':
      return typedValue.value
    case 'number':
      return typedValue.value
    case 'boolean':
      return typedValue.value
    case 'json':
      return typedValue.value
    case 'option':
      return typedValue.optionId
    case 'relationship':
      return typedValue.recordId
  }
}

/**
 * Create a TypedFieldValueInput from a raw value and field type.
 * This is used when converting from legacy { data: value } format.
 */
export function createTypedValueInput(
  fieldType: string,
  rawValue: unknown
): TypedFieldValueInput | null {
  if (rawValue === null || rawValue === undefined) {
    return null
  }

  const valueType = getValueType(fieldType)

  switch (valueType) {
    case 'text':
      return { type: 'text', value: String(rawValue) }
    case 'number':
      return { type: 'number', value: Number(rawValue) }
    case 'boolean':
      return { type: 'boolean', value: Boolean(rawValue) }
    case 'date':
      return { type: 'date', value: rawValue instanceof Date ? rawValue.toISOString() : String(rawValue) }
    case 'json':
      return { type: 'json', value: rawValue as Record<string, unknown> }
    case 'option':
      return { type: 'option', optionId: String(rawValue) }
    case 'relationship':
      // Handle RecordId string directly
      if (typeof rawValue === 'string' && isRecordId(rawValue)) {
        return { type: 'relationship', recordId: rawValue }
      }
      // Handle legacy object input with relatedEntityId (for migration)
      if (typeof rawValue === 'object' && rawValue !== null && 'relatedEntityId' in rawValue) {
        const obj = rawValue as { relatedEntityId: string; relatedEntityDefinitionId?: string }
        if (obj.relatedEntityDefinitionId) {
          return {
            type: 'relationship',
            recordId: toRecordId(obj.relatedEntityDefinitionId, obj.relatedEntityId),
          }
        }
      }
      // Handle object with recordId already set
      if (typeof rawValue === 'object' && rawValue !== null && 'recordId' in rawValue) {
        const obj = rawValue as { recordId: RecordId }
        return { type: 'relationship', recordId: obj.recordId }
      }
      return null
  }
}
