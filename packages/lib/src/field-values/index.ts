// packages/lib/src/field-values/index.ts

export type { RecordId } from '@auxx/types/resource'
// CALC expression evaluator - re-exported from @auxx/utils
export {
  type CalcFunction,
  evaluateCalcExpression,
  getAvailableFunctions,
  type ParsedExpression,
  validateCalcExpression,
} from '@auxx/utils/calc-expression'
// AI autofill (server-only — these import orchestrator + DB helpers)
export {
  type AiValueMetadata,
  type GenerationResult,
  generateFieldValue,
  type PreviewResult,
  previewFieldValue,
} from './ai-autofill'
// Converters (for direct access if needed)
export {
  booleanConverter,
  calcConverter,
  converters,
  currencyConverter,
  dateConverter,
  fileConverter,
  jsonConverter,
  nameConverter,
  numberConverter,
  relationshipConverter,
  selectConverter,
  textConverter,
} from './converters'
export {
  cascadeDependentDisplayNames,
  type DisplayFieldDep,
  getDisplayFieldDeps,
  invalidateDisplayFieldDeps,
} from './display-field-deps'
export { DisplayFieldService } from './display-field-service'
// Display field types and config
export type {
  DisplayFieldConfig,
  DisplayFieldType,
  RecalculateDisplayFieldInput,
  RecalculateDisplayFieldResult,
  RecalculateDisplayFieldsInput,
} from './display-field-types'
export { DEFINITION_COLUMN_TO_TYPE, DISPLAY_FIELD_CONFIG } from './display-field-types'
// Helpers (context and shared utilities)
export {
  batchGetRelatedDisplayNames,
  type CachedField,
  createFieldValueContext,
  type FieldValueContext,
  getField,
  getFieldTypeMapByDefinition,
  getInverseInfoFromField,
  getRelatedDisplayName,
  isValidTypedValue,
  maybeUpdateDisplayValue,
  preBatchValidateRelationships,
  rowsToTypedValues,
  rowToTypedValue,
  validateAndConvertValue,
  validateRowReferences,
  validateSingleValue,
} from './field-value-helpers'
// Mutations (for direct usage)
export {
  addOptionValues,
  addRelationValues,
  addRelationValuesBulk,
  addValue,
  buildFieldValueRow,
  deleteValue,
  extractRelatedIdsFromRaw,
  removeOptionValues,
  removeRelationValues,
  removeRelationValuesBulk,
  removeValue,
  setBulkValues,
  setValue,
  setValuesForEntity,
  setValueWithBuiltIn,
  setValueWithType,
} from './field-value-mutations'
// Queries (for direct usage)
export {
  batchGetValues,
  getValue,
  getValues,
} from './field-value-queries'
// Services
export { FieldValueService } from './field-value-service'
// NEW: Centralized Formatter API (preferred)
export {
  areValuesEqual,
  type BooleanFieldOptions,
  type ConverterOptions,
  type DateFieldOptions,
  extractValues,
  type FieldOptions,
  type FieldValueConverter,
  formatToDisplayValue,
  formatToRawValue,
  formatToTypedInput,
  isMultiValueFieldType,
  isValueEmpty,
  type NumberFieldOptions,
  type SelectFieldOptions,
  type TextFieldOptions,
} from './formatter'
// Relationship error types
export {
  createCircularReferenceError,
  createHasChildrenError,
  createMaxDepthError,
  type RelationshipErrorCode,
  RelationshipValidationError,
} from './relationship-errors'
// Relationship utilities
export {
  extractRelationshipRecordIds,
  getDefinitionId,
  getInstanceId,
  isMultiRelationship,
  isRecordId,
  isRelationshipFieldValue,
  isRelationshipFieldValueArray,
  isSingleRelationship,
  parseRecordId,
  type RelationshipType,
  toRecordId,
  toRecordIds,
} from './relationship-field'

// Relationship query helpers (for TagsOnThread migration)
export {
  batchGetThreadTagIds,
  getThreadsWithTag,
  getThreadTagIds,
  threadDoesNotHaveTags,
  threadHasAnyTags,
  threadHasNoTags,
  threadHasTagMatchingSearch,
  threadHasTags,
} from './relationship-queries'
// Relationship sync (bidirectional integrity)
export {
  type BulkRelationshipUpdate,
  type BulkSyncInput,
  batchGetExistingRelatedIds,
  getExistingRelatedIds,
  type InverseFieldInfo,
  type InverseSyncResult,
  type RelationshipSyncContext,
  type SyncInverseInput,
  syncInverseRelationships,
  syncInverseRelationshipsBulk,
} from './relationship-sync'
// Relationship validators (self-referential constraints)
export {
  calculateDepth,
  getDescendantIds,
  hasCircularReference,
  type ValidationContext,
  type ValidationResult,
  validateSelfReferentialChange,
  validateSelfReferentialDelete,
} from './relationship-validators'

// Service types
export type {
  AddRelationValuesBulkInput,
  AddRelationValuesInput,
  AddValueInput,
  BatchFieldValueResult,
  BatchGetValuesInput,
  DeleteValueInput,
  FieldValueRow,
  GetValueInput,
  GetValuesInput,
  // Model types
  ModelType,
  RemoveRelationValuesBulkInput,
  RemoveRelationValuesInput,
  SetBulkValuesInput,
  // Existing input types
  SetValueInput,
  // Result types
  SetValueResult,
  SetValuesForEntityInput,
  SetValuesResult,
  // New input types (replaces CustomFieldService methods)
  SetValueWithBuiltInInput,
  SetValueWithTypeInput,
  TypedFieldValueResult,
} from './types'
