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
export { type CheckUniqueValueTypedInput, checkUniqueValueTyped } from './check-unique-value-typed'
export { CustomFieldService, normalizeFieldValue } from './custom-field-service'
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
export {
  extractFieldIds,
  extractFieldIdsFromString,
  type FormulaNode,
  formulaToString,
  stringToFormula,
} from './formula-converters'
// Export unified types from @auxx/database
export {
  type FieldTypeOption,
  fieldTypeOptions,
  getFieldTypeMaxWidth,
  getFieldTypeMinWidth,
  type ModelType,
  ModelTypes,
  PRIMARY_DISPLAY_ELIGIBLE_TYPES,
} from './types'
