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
 * Result from setValueWithBuiltIn
 */
export interface SetValueResult {
  id?: string
  value: TypedFieldValue | null
}

/**
 * Result from setValuesForEntity
 */
export interface SetValuesResult {
  fieldId: string
  id?: string
  value: TypedFieldValue | null
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

/** Input for getting values with field metadata */
export interface GetValuesWithFieldsInput {
  entityId: string
  modelType: 'contact' | 'ticket' | 'thread' | 'entity'
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
  entityIds: string[]
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

/** Value with joined field metadata */
export interface FieldValueWithField {
  id: string
  entityId: string
  fieldId: string
  value: TypedFieldValue | TypedFieldValue[]
  sortKey: string
  createdAt: string
  updatedAt: string
  field: {
    id: string
    name: string
    type: string
    modelType: string
    position: number
    required: boolean
    description: string | null
    defaultValue: string | null
    options: unknown
    icon: string | null
    isCustom: boolean
    active: boolean
  }
}

/** Single result from batch get */
export interface TypedFieldValueResult {
  resourceId: string
  fieldId: string
  value: TypedFieldValue | TypedFieldValue[] | null
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
  sortKey: string
  createdAt: string
  updatedAt: string
}
