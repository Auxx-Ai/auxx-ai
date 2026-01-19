// packages/lib/src/field-values/types.ts

import type { FieldType } from '@auxx/database/types'
import type { TypedFieldValue, TypedFieldValueInput } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'

// =============================================================================
// MODEL TYPES
// =============================================================================

/** Model type for field values (matches ModelTypes from custom-fields) */
export type ModelType = 'contact' | 'ticket' | 'thread' | 'entity'

// =============================================================================
// SERVICE INPUT TYPES
// =============================================================================

/**
 * Input for setting a single field value.
 * The service will fetch the CustomField to determine the type and convert the value.
 * Automatically updates EntityInstance.displayName if this is the primary display field.
 */
export interface SetValueInput {
  recordId: RecordId
  fieldId: string
  /** Raw value - service will convert based on field type */
  value: unknown
}

/**
 * Input for setValueWithBuiltIn - handles both built-in and custom fields.
 * Replaces CustomFieldService.setValue
 */
export interface SetValueWithBuiltInInput {
  recordId: RecordId
  fieldId: string
  value: unknown
  /** Whether to publish events (default: true) */
  publishEvents?: boolean
  /** Skip inverse relationship sync (used by bulk operations that handle sync separately) */
  skipInverseSync?: boolean
}

/**
 * Input for setValuesForEntity - batch set multiple fields on one entity.
 * Replaces CustomFieldService.setValues
 */
export interface SetValuesForEntityInput {
  recordId: RecordId
  values: Array<{ fieldId: string; value: unknown }>
  /** Whether to publish events (default: true) */
  publishEvents?: boolean
  /** Skip inverse relationship sync (used by bulk operations that handle sync separately) */
  skipInverseSync?: boolean
}

/**
 * Input for setBulkValues - set same values on multiple entities.
 * Replaces CustomFieldService.bulkSetValues
 */
export interface SetBulkValuesInput {
  recordIds: RecordId[]
  values: Array<{ fieldId: string; value: unknown }>
}

/**
 * Result state for field value mutations
 */
export type SetValueState = 'complete' | 'failed'

/**
 * Result from setValueWithBuiltIn - always returns arrays for consistency
 */
export interface SetValueResult {
  state: SetValueState
  performedAt: string
  values: TypedFieldValue[]
}

/**
 * Result from setValuesForEntity
 */
export interface SetValuesResult {
  fieldId: string
  state: SetValueState
  performedAt: string
  values: TypedFieldValue[]
}

/**
 * Input for setting a field value when caller already has field type info.
 * Skips CustomField lookup for better performance.
 * Does NOT update displayName - caller is responsible for that.
 */
export interface SetValueWithTypeInput {
  recordId: RecordId
  fieldId: string
  fieldType: FieldType
  value: TypedFieldValueInput | TypedFieldValueInput[] | null
  /** Skip inverse relationship sync (used by bulk operations that handle sync separately) */
  skipInverseSync?: boolean
}

/** Input for adding a value to a multi-value field */
export interface AddValueInput {
  recordId: RecordId
  fieldId: string
  fieldType: FieldType
  value: TypedFieldValueInput
  position?: 'start' | 'end' | { after: string }
}

/** Input for getting a single field value */
export interface GetValueInput {
  recordId: RecordId
  fieldId: string
}

/** Input for getting multiple values */
export interface GetValuesInput {
  recordId: RecordId
  fieldIds?: string[]
}

/** Input for batch getting values (uses RecordId format: entityDefinitionId:entityInstanceId) */
export interface BatchGetValuesInput {
  recordIds: RecordId[]
  fieldIds: string[]
}

/** Input for deleting values */
export interface DeleteValueInput {
  recordId: RecordId
  fieldId: string
}

// =============================================================================
// SERVICE RETURN TYPES
// =============================================================================

/** Single result from batch get */
export interface TypedFieldValueResult {
  recordId: RecordId
  fieldId: string
  value: TypedFieldValue | TypedFieldValue[] | null
  /** Issues found with this field (only present if there are issues) */
  issues?: string[]
}

/** Result from batch get values */
export interface BatchFieldValueResult {
  values: TypedFieldValueResult[]
}

// =============================================================================
// DATABASE ROW TYPES
// =============================================================================

/** Raw row from FieldValue table */
export interface FieldValueRow {
  id: string
  entityId: string
  entityDefinitionId: string
  fieldId: string
  organizationId: string
  valueText: string | null
  valueNumber: number | null
  valueBoolean: boolean | null
  valueDate: string | null
  valueJson: unknown | null
  optionId: string | null
  relatedEntityId: string | null
  relatedEntityDefinitionId: string | null
  sortKey: string
  createdAt: string
  updatedAt: string
}
