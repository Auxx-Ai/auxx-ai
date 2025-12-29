// packages/services/src/custom-fields/index.ts

// Field CRUD operations
export { getCustomFields, type GetCustomFieldsInput } from './get-fields'
export {
  batchGetFieldValuesQuery,
  type BatchGetFieldValuesInput,
  type FieldValueResult,
} from './batch-get-field-values'
export { createCustomField, type CreateCustomFieldInput } from './create-field'
export { updateCustomField, type UpdateCustomFieldInput } from './update-field'
export { deleteCustomField, type DeleteCustomFieldInput } from './delete-field'
export { updateFieldPositions, type UpdateFieldPositionsInput } from './update-positions'

// Value DB operations
export { getFieldValuesQuery, type GetFieldValuesInput } from './get-field-values'
export { getFieldByIdQuery, type GetFieldByIdInput } from './get-field-by-id'
export { getExistingValueQuery, type GetExistingValueInput } from './get-existing-value'
export { upsertFieldValueQuery, type UpsertFieldValueInput } from './upsert-field-value'
export { deleteFieldValueQuery, type DeleteFieldValueInput } from './delete-field-value'
export { verifyEntityExistsQuery, type VerifyEntityInput } from './verify-entity'

// Relationship helper
export { getRelationshipPair, type GetRelationshipPairInput } from './get-relationship-pair'

// Utils
export { normalizeCustomFieldValue } from './utils/normalize-value'

// Uniqueness checks
export {
  checkUniqueValue,
  checkExistingDuplicates,
  type CheckUniqueValueInput,
  type UniqueViolation,
} from './check-unique-value'
export { findByUniqueValue, type FindByUniqueValueInput } from './find-by-unique-value'

// Types - unified types from @auxx/database
export { ModelTypes, type ModelType, UNIQUEABLE_FIELD_TYPES, canFieldBeUnique } from './types'

// Relationship types
export type { RelationshipConfig, RelationshipOptions } from './types'

// Errors
export type {
  CustomFieldError,
  CustomFieldNotFoundError,
  EntityNotFoundError,
  FieldValueValidationError,
  AccessDeniedError,
} from './errors'
