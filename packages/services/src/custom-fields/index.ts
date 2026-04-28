// packages/services/src/custom-fields/index.ts

// Uniqueness checks
export {
  type CheckUniqueValueInput,
  checkExistingDuplicates,
  checkUniqueValue,
  type UniqueViolation,
} from './check-unique-value'
export { type CreateCustomFieldInput, createCustomField } from './create-field'
export { type DeleteCustomFieldInput, deleteCustomField } from './delete-field'
// Errors
export type {
  AccessDeniedError,
  CustomFieldError,
  CustomFieldNotFoundError,
  EntityNotFoundError,
  FieldValueValidationError,
} from './errors'
export { type FindByUniqueValueInput, findByUniqueValue } from './find-by-unique-value'
// Field queries
// export { type GetFieldByIdInput, getFieldByIdQuery } from './get-field-by-id'
// Field CRUD operations
// Note: getCustomFields and getFieldsByIds removed — use org cache via @auxx/lib/cache
// Relationship helper
export { type GetRelationshipPairInput, getRelationshipPair } from './get-relationship-pair'
// Relationship types
export type { RelationshipConfig, RelationshipOptions } from './types'
// Types - unified types from @auxx/database
// Consolidated field option types (single source of truth)
export {
  canFieldBeUnique,
  DEFAULT_SELECT_OPTION_COLOR,
  type DisplayOptions,
  // Display options (flat structure for NUMBER, CURRENCY, DATE, CHECKBOX, etc.)
  displayOptionsSchema,
  type FileOptions,
  // Field options union
  fieldOptionsUnionSchema,
  // File options
  fileOptionsSchema,
  type ModelType,
  ModelTypes,
  // Select option colors
  SELECT_OPTION_COLORS,
  type SelectOption,
  type SelectOptionColor,
  // Select option
  selectOptionSchema,
  type TargetTimeInStatus,
  // Target time in status
  targetTimeInStatusSchema,
  UNIQUEABLE_FIELD_TYPES,
} from './types'
export { type UpdateCustomFieldInput, updateCustomField } from './update-field'
// Utils
export { normalizeFieldValue } from './utils/normalize-value'
// AI options validation
export {
  type AiOptionsValidationError,
  type ValidateAiOptionsInput,
  validateAiOptions,
} from './validate-ai-options'
export { type VerifyEntityInput, verifyEntityExistsQuery } from './verify-entity'
