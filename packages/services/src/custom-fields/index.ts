// packages/services/src/custom-fields/index.ts

// Field CRUD operations
export { getCustomFields, type GetCustomFieldsInput } from './get-fields'
export { createCustomField, type CreateCustomFieldInput } from './create-field'
export { updateCustomField, type UpdateCustomFieldInput } from './update-field'
export { deleteCustomField, type DeleteCustomFieldInput } from './delete-field'
export { updateFieldPositions, type UpdateFieldPositionsInput } from './update-positions'

// Field queries
export { getFieldByIdQuery, type GetFieldByIdInput } from './get-field-by-id'
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

// Consolidated field option types (single source of truth)
export {
  // Select option colors
  SELECT_OPTION_COLORS,
  DEFAULT_SELECT_OPTION_COLOR,
  type SelectOptionColor,
  // Target time in status
  targetTimeInStatusSchema,
  type TargetTimeInStatus,
  // Select option
  selectOptionSchema,
  type SelectOption,
  // Currency options
  currencyOptionsSchema,
  decimalPlacesValues,
  currencyDisplayTypeValues,
  currencyGroupsValues,
  type CurrencyOptions,
  type DecimalPlaces,
  type CurrencyDisplayType,
  type CurrencyGroups,
  // File options
  fileOptionsSchema,
  type FileOptions,
  // Field options union
  fieldOptionsUnionSchema,
} from './types'

// Errors
export type {
  CustomFieldError,
  CustomFieldNotFoundError,
  EntityNotFoundError,
  FieldValueValidationError,
  AccessDeniedError,
} from './errors'
