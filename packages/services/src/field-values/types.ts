// packages/services/src/field-values/types.ts

import type { TypedFieldValue, TypedFieldValueInput } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'

// =============================================================================
// ERROR TYPES
// =============================================================================

/** Field not found error */
export type FieldNotFoundError = {
  code: 'FIELD_NOT_FOUND'
  message: string
  fieldId: string
}

/** Field value not found error */
export type FieldValueNotFoundError = {
  code: 'FIELD_VALUE_NOT_FOUND'
  message: string
  entityId: string
  fieldId: string
}

/** Entity not found error */
export type EntityNotFoundError = {
  code: 'ENTITY_NOT_FOUND'
  message: string
  entityId: string
}

/** All field value errors */
export type FieldValueError =
  | FieldNotFoundError
  | FieldValueNotFoundError
  | EntityNotFoundError

// =============================================================================
// QUERY INPUT/OUTPUT TYPES
// =============================================================================

/** Input for getting a field with its entity definition */
export interface GetFieldWithDefinitionInput {
  fieldId: string
  organizationId: string
}

/** Result of getting a field with its entity definition */
export interface FieldWithDefinition {
  id: string
  name: string
  type: string
  options: unknown
  entityDefinitionId: string | null
  entityDefinition: {
    id: string
    primaryDisplayFieldId: string | null
    secondaryDisplayFieldId: string | null
  } | null
}

/** Input for checking if a field value exists */
export interface GetExistingValueInput {
  entityId: string
  fieldId: string
  organizationId: string
}

/** Existing field value row */
export interface ExistingFieldValueRow {
  id: string
  entityDefinitionId: string
  valueText: string | null
  valueNumber: number | null
  valueBoolean: boolean | null
  valueDate: string | null
  valueJson: unknown | null
  optionId: string | null
  relatedEntityId: string | null
  relatedEntityDefinitionId: string | null
  sortKey: string
}

/** Input for inserting a field value - uses RecordId */
export interface InsertFieldValueInput {
  recordId: RecordId
  fieldId: string
  organizationId: string
  sortKey: string
  valueText?: string | null
  valueNumber?: number | null
  valueBoolean?: boolean | null
  valueDate?: string | null
  valueJson?: unknown | null
  optionId?: string | null
  relatedEntityId?: string | null
  relatedEntityDefinitionId?: string | null
}

/** Input for updating a field value */
export interface UpdateFieldValueInput {
  id: string
  organizationId: string
  valueText?: string | null
  valueNumber?: number | null
  valueBoolean?: boolean | null
  valueDate?: string | null
  valueJson?: unknown | null
  optionId?: string | null
  relatedEntityId?: string | null
  relatedEntityDefinitionId?: string | null
}

/** Input for deleting field values */
export interface DeleteFieldValuesInput {
  entityId: string
  fieldId: string
  organizationId: string
}

/** Input for updating entity display name */
export interface UpdateDisplayNameInput {
  entityId: string
  organizationId: string
  displayName: string | null
}

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
