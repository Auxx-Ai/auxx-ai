// packages/lib/src/custom-fields/index.ts

export { getAiPrompt, isAiEligible, isAiField } from './ai'
export type {
  BuiltInFieldConfig,
  BuiltInFieldHandler,
  BuiltInFieldRegistry,
} from './built-in-fields'
// Export built-in field utilities
export { BUILT_IN_FIELDS, getBuiltInFieldHandler, isBuiltInField } from './built-in-fields'
export { getCalcOptions, getEffectiveFieldType } from './calc'
// Uniqueness checks
export {
  type CheckUniqueValueInput,
  checkExistingDuplicates,
  checkUniqueValue,
  type UniqueViolation,
} from './check-unique-value'
export { type CheckUniqueValueTypedInput, checkUniqueValueTyped } from './check-unique-value-typed'
export { type CreateCustomFieldInput, createCustomField } from './create-field'
export { CustomFieldService } from './custom-field-service'
// Export default display options (for converters and seeder)
export {
  DEFAULT_BOOLEAN_OPTIONS,
  DEFAULT_CURRENCY_OPTIONS,
  DEFAULT_DATE_OPTIONS,
  DEFAULT_DATETIME_OPTIONS,
  DEFAULT_FILE_OPTIONS,
  DEFAULT_NUMBER_OPTIONS,
  DEFAULT_PHONE_OPTIONS,
  DEFAULT_TEXT_OPTIONS,
  DEFAULT_TIME_OPTIONS,
  fieldTypeDisplayDefaults,
} from './defaults'
export { type DeleteCustomFieldInput, deleteAppFields, deleteCustomField } from './delete-field'
// Errors
export type {
  AccessDeniedError,
  CustomFieldError,
  CustomFieldNotFoundError,
  EntityNotFoundError,
  FieldValueValidationError,
} from './errors'
// Export field options types (for converters and seeder)
export type {
  BooleanFieldOptions,
  CalcFieldOptions,
  CalcOptions,
  DateFieldOptions,
  FieldOptions,
  NameFieldOptions,
  NumberFieldOptions,
  PhoneFieldOptions,
  SelectFieldOptions,
  TextFieldOptions,
} from './field-options'
export { type FindByUniqueValueInput, findByUniqueValue } from './find-by-unique-value'
export {
  extractFieldIds,
  extractFieldIdsFromString,
  type FormulaNode,
  formulaToString,
  stringToFormula,
} from './formula-converters'
// Relationship helper
export { type GetRelationshipPairInput, getRelationshipPair } from './get-relationship-pair'
export { isProtectedField } from './ownership'
// Note: getCustomFields and getFieldsByIds removed — use org cache via @auxx/lib/cache
export {
  type CustomFieldOptionsInput,
  type FieldTypeOption,
  fieldTypeOptions,
  getFieldTypeMaxWidth,
  getFieldTypeMinWidth,
  PRIMARY_DISPLAY_ELIGIBLE_TYPES,
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
