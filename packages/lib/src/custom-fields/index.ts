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
