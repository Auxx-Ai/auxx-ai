// packages/lib/src/custom-fields/index.ts

export { CustomFieldService, normalizeCustomFieldValue } from './custom-field-service'
export { checkUniqueValueTyped, type CheckUniqueValueTypedInput } from './check-unique-value-typed'

// Export unified types from @auxx/database
export {
  ModelTypes,
  type ModelType,
  type FieldTypeOption,
  getFieldTypeMinWidth,
  getFieldTypeMaxWidth,
  fieldTypeOptions,
} from './types'

// Export built-in field utilities
export { isBuiltInField, getBuiltInFieldHandler, BUILT_IN_FIELDS } from './built-in-fields'
export type {
  BuiltInFieldHandler,
  BuiltInFieldConfig,
  BuiltInFieldRegistry,
} from './built-in-fields'

// Export field options types (for converters and seeder)
export {
  type FieldOptions,
  type NumberFieldOptions,
  type DateFieldOptions,
  type BooleanFieldOptions,
  type TextFieldOptions,
  type PhoneFieldOptions,
  type SelectFieldOptions,
  type CalcOptions,
  type CalcFieldOptions,
} from './field-options'

// Export default display options (for converters and seeder)
export {
  DEFAULT_TEXT_OPTIONS,
  DEFAULT_NUMBER_OPTIONS,
  DEFAULT_CURRENCY_OPTIONS,
  DEFAULT_DATE_OPTIONS,
  DEFAULT_DATETIME_OPTIONS,
  DEFAULT_TIME_OPTIONS,
  DEFAULT_BOOLEAN_OPTIONS,
  DEFAULT_PHONE_OPTIONS,
  DEFAULT_FILE_OPTIONS,
  fieldTypeDisplayDefaults,
} from './defaults'
