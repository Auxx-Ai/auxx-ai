// packages/lib/src/field-values/index.ts

// Services
export { FieldValueService } from './field-value-service'
export { DisplayFieldService } from './display-field-service'

// NEW: Centralized Formatter API (preferred)
export {
  formatToTypedInput,
  formatToRawValue,
  formatToDisplayValue,
  isMultiValueFieldType,
  extractValues,
  isValueEmpty,
  areValuesEqual,
  type ConverterOptions,
  type FieldOptions,
  type FieldValueConverter,
  type NumberFieldOptions,
  type DateFieldOptions,
  type BooleanFieldOptions,
  type TextFieldOptions,
  type SelectFieldOptions,
} from './formatter'

// Converters (for direct access if needed)
export {
  converters,
  textConverter,
  numberConverter,
  currencyConverter,
  booleanConverter,
  dateConverter,
  selectConverter,
  relationshipConverter,
  jsonConverter,
  nameConverter,
  fileConverter,
} from './converters'

// Row types (exported from types.ts, not value-converter.ts)
export {
  extractRelationshipData,
  extractRelationshipRefs,
  normalizeRelationshipValue,
  validateRelationshipValue,
  validateEntityDefinitionId,
  isRelationshipFieldValue,
  isRelationshipFieldValueArray,
  convertRawToRelationshipInput,
  type RelationshipData,
} from './relationship-field'

// Relationship sync (bidirectional integrity)
export {
  getExistingRelatedIds,
  batchGetExistingRelatedIds,
  syncInverseRelationships,
  syncInverseRelationshipsBulk,
  type RelationshipSyncContext,
  type InverseFieldInfo,
  type SyncInverseInput,
  type InverseSyncResult,
  type BulkRelationshipUpdate,
  type BulkSyncInput,
} from './relationship-sync'

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
