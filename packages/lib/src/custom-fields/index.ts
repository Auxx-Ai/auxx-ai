// packages/lib/src/custom-fields/index.ts

export { CustomFieldService, normalizeCustomFieldValue } from './custom-field-service'

// Export unified types from @auxx/database
export {
  ModelTypes,
  ModelTypeMeta,
  type ModelType,
  getFieldTypeMinWidth,
  getFieldTypeMaxWidth,
  UNIQUEABLE_FIELD_TYPES,
  canFieldBeUnique,
} from './types'

// Export built-in field utilities
export { isBuiltInField, getBuiltInFieldHandler, BUILT_IN_FIELDS } from './built-in-fields'
export type { BuiltInFieldHandler, BuiltInFieldConfig, BuiltInFieldRegistry } from './built-in-fields'
