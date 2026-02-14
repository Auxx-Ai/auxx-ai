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
export { type GetFieldByIdInput, getFieldByIdQuery } from './get-field-by-id'
// Field CRUD operations
export { type GetCustomFieldsInput, getCustomFields } from './get-fields'
export { type GetFieldsByIdsInput, getFieldsByIds } from './get-fields-by-ids'
// Relationship helper
export { type GetRelationshipPairInput, getRelationshipPair } from './get-relationship-pair'
// Relationship types
export type { RelationshipConfig, RelationshipOptions } from './types'
// Types - unified types from @auxx/database
// Consolidated field option types (single source of truth)
export {
  type CurrencyDisplayType,
  type CurrencyGroups,
  type CurrencyOptions,
  canFieldBeUnique,
  currencyDisplayTypeValues,
  currencyGroupsValues,
  // Currency options
  currencyOptionsSchema,
  DEFAULT_SELECT_OPTION_COLOR,
  type DecimalPlaces,
  type DisplayOptions,
  decimalPlacesValues,
  // Display options (flat structure for NUMBER, DATE, CHECKBOX, etc.)
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
export { normalizeCustomFieldValue } from './utils/normalize-value'
export { type VerifyEntityInput, verifyEntityExistsQuery } from './verify-entity'
