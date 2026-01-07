// packages/lib/src/field-values/types.ts

import type { TypedFieldValue, TypedFieldValueInput } from '@auxx/types'

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
  entityId: string
  fieldId: string
  /** Raw value - service will convert based on field type */
  value: unknown
}

/**
 * Input for setValueWithBuiltIn - handles both built-in and custom fields.
 * Replaces CustomFieldService.setValue
 */
export interface SetValueWithBuiltInInput {
  entityId: string
  fieldId: string
  value: unknown
  modelType: ModelType
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
  entityId: string
  values: Array<{ fieldId: string; value: unknown }>
  modelType: ModelType
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
  entityIds: string[]
  values: Array<{ fieldId: string; value: unknown }>
  modelType: ModelType
}

/**
 * Result from setValueWithBuiltIn - always returns arrays for consistency
 */
export interface SetValueResult {
  ids: string[]
  values: TypedFieldValue[]
}

/**
 * Result from setValuesForEntity
 */
export interface SetValuesResult {
  fieldId: string
  ids: string[]
  values: TypedFieldValue[]
}

/**
 * Input for setting a field value when caller already has field type info.
 * Skips CustomField lookup for better performance.
 * Does NOT update displayName - caller is responsible for that.
 */
export interface SetValueWithTypeInput {
  entityId: string
  fieldId: string
  fieldType: string
  value: TypedFieldValueInput | TypedFieldValueInput[] | null
  /** Skip inverse relationship sync (used by bulk operations that handle sync separately) */
  skipInverseSync?: boolean
}

/** Input for adding a value to a multi-value field */
export interface AddValueInput {
  entityId: string
  fieldId: string
  fieldType: string
  value: TypedFieldValueInput
  position?: 'start' | 'end' | { after: string }
}

/** Input for getting a single field value */
export interface GetValueInput {
  entityId: string
  fieldId: string
}

/** Input for getting multiple values */
export interface GetValuesInput {
  entityId: string
  fieldIds?: string[]
}

/** Input for batch getting values */
export interface BatchGetValuesInput {
  resourceType: 'contact' | 'ticket' | 'entity'
  entityDefId?: string
  resourceIds: string[]
  fieldIds: string[]
}

/** Input for deleting values */
export interface DeleteValueInput {
  entityId: string
  fieldId: string
}

// =============================================================================
// SERVICE RETURN TYPES
// =============================================================================

/** Single result from batch get */
export interface TypedFieldValueResult {
  resourceId: string
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
