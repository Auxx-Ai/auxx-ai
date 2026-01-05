// packages/lib/src/field-values/index.ts

// Services
export { FieldValueService } from './field-value-service'
export { DisplayFieldService } from './display-field-service'

// Utilities
export { convertToTypedInput, getDisplayValue, rowToTypedValue } from './value-converter'

// Display field types and config
export type {
  DisplayFieldType,
  DisplayFieldConfig,
  RecalculateDisplayFieldInput,
  RecalculateDisplayFieldsInput,
  RecalculateDisplayFieldResult,
} from './display-field-types'
export { DISPLAY_FIELD_CONFIG, DEFINITION_COLUMN_TO_TYPE } from './display-field-types'

// Service types
export type {
  // Model types
  ModelType,
  // Existing input types
  SetValueInput,
  SetValueWithTypeInput,
  AddValueInput,
  GetValueInput,
  GetValuesInput,
  BatchGetValuesInput,
  DeleteValueInput,
  // New input types (replaces CustomFieldService methods)
  SetValueWithBuiltInInput,
  SetValuesForEntityInput,
  SetBulkValuesInput,
  // Result types
  SetValueResult,
  SetValuesResult,
  TypedFieldValueResult,
  BatchFieldValueResult,
  FieldValueRow,
} from './types'
