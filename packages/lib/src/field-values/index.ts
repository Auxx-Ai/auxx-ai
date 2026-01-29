// packages/lib/src/field-values/index.ts

// Services
export { FieldValueService } from './field-value-service'
export { DisplayFieldService } from './display-field-service'

// Helpers (context and shared utilities)
export {
  type FieldValueContext,
  createFieldValueContext,
  getField,
  getInverseInfoFromField,
  rowToTypedValue,
  rowsToTypedValues,
  isValidTypedValue,
  validateRowReferences,
  validateAndConvertValue,
  validateSingleValue,
  preBatchValidateRelationships,
  maybeUpdateDisplayValue,
  getFieldTypeMapByDefinition,
} from './field-value-helpers'

// Queries (for direct usage)
export {
  getValue,
  getValues,
  batchGetValues,
} from './field-value-queries'

// Mutations (for direct usage)
export {
  setValue,
  setValueWithType,
  addValue,
  removeValue,
  deleteValue,
  setValueWithBuiltIn,
  setValuesForEntity,
  setBulkValues,
  extractRelatedIdsFromRaw,
} from './field-value-mutations'

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
  calcConverter,
} from './converters'

// CALC expression evaluator - re-exported from @auxx/utils
export {
  evaluateCalcExpression,
  validateCalcExpression,
  getAvailableFunctions,
  type CalcFunction,
  type ParsedExpression,
} from '@auxx/utils/calc-expression'

// Relationship utilities
export {
  extractRelationshipRecordIds,
  isRelationshipFieldValue,
  isRelationshipFieldValueArray,
  isMultiRelationship,
  isSingleRelationship,
  toRecordId,
  parseRecordId,
  isRecordId,
  toRecordIds,
  getInstanceId,
  getDefinitionId,
  type RelationshipType,
} from './relationship-field'
export type { RecordId } from '@auxx/types/resource'

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

// Relationship validators (self-referential constraints)
export {
  getDescendantIds,
  hasCircularReference,
  calculateDepth,
  validateSelfReferentialChange,
  validateSelfReferentialDelete,
  type ValidationContext,
  type ValidationResult,
} from './relationship-validators'

// Relationship error types
export {
  RelationshipValidationError,
  createCircularReferenceError,
  createMaxDepthError,
  createHasChildrenError,
  type RelationshipErrorCode,
} from './relationship-errors'

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
