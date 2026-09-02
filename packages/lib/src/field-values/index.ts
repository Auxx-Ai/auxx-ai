// packages/lib/src/field-values/index.ts

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
// Server-side CALC resolution
export { type CalcResolution, resolveCalcForRecord } from './calc-resolver'
// Converters (for direct access if needed)
export {
  booleanConverter,
  calcConverter,
  converters,
  currencyConverter,
  dateConverter,
  type FileValue,
  fileConverter,
  jsonConverter,
  nameConverter,
  numberConverter,
  relationshipConverter,
  selectConverter,
  textConverter,
} from './converters'
// The create-only batched write
export { createValuesForEntity } from './create-values'
export {
  cascadeDependentDisplayNames,
  type DisplayFieldDep,
  getDisplayFieldDeps,
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
  flattenTypedFieldValue,
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
  addRelationValues,
  addRelationValuesBulk,
  addValue,
  buildFieldValueRow,
  deleteValue,
  extractRelatedIdsFromRaw,
  removeRelationValues,
  removeRelationValuesBulk,
  removeValue,
  setBulkValues,
  setPrimaryValue,
  setValue,
  setValuesForEntity,
  setValueWithBuiltIn,
  setValueWithType,
  type WriteValuesForEntityResult,
  writeValuesForEntity,
} from './field-value-mutations'
// Queries (for direct usage)
export {
  batchGetValues,
  getValue,
  getValues,
} from './field-value-queries'
// FieldValue row → flat scalar (shared by resource-fetcher + record-rules snapshot-fetcher)
export { extractFieldValueScalar } from './field-value-scalar'
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
export { getExistingFieldValue } from './get-existing-value'
export { getFieldWithDefinition } from './get-field-with-definition'
export { batchInsertFieldValues, insertFieldValue } from './insert-value'
// Read-side value normalization for lookupByField
export { normalizeForLookup } from './normalize-for-lookup'
// Multi-value scalar helpers (first-is-primary convention)
export { MAX_MULTI_VALUES, primaryValue } from './primary-value'
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
  getRelationshipRedactedCount,
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
  articleDoesNotHaveTags,
  articleHasAnyTags,
  articleHasNoTags,
  articleHasTags,
  batchGetArticleTagIds,
  batchGetThreadTagIds,
  getArticleTagIds,
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
// EntityInstance.searchText corpus (field-type policy, bounds, refresh helpers)
export {
  isSearchTextIndexedFieldType,
  SEARCH_TEXT_ADDRESS_KEYS,
  SEARCH_TEXT_INDEXED_FIELD_TYPES,
  SEARCH_TEXT_JSON_FIELD_TYPES,
  SEARCH_TEXT_MAX_VALUES,
  SEARCH_TEXT_NAME_KEYS,
  SEARCH_TEXT_OPTION_FIELD_TYPES,
  SEARCH_TEXT_TEXT_FIELD_TYPES,
  SEARCH_TEXT_TOTAL_LIMIT,
  SEARCH_TEXT_VALUE_LIMIT,
  searchTextExpressionSql,
  updateSearchText,
  updateSearchTextForEntityDefinition,
  updateSearchTextForInstances,
} from './search-text'
// Low-level FieldValue row service types (moved from @auxx/services)
export type {
  EntityNotFoundError,
  ExistingFieldValueRow,
  FieldNotFoundError,
  FieldValueError,
  FieldValueNotFoundError,
  FieldWithDefinition,
  GetExistingValueInput,
  GetFieldWithDefinitionInput,
  InsertFieldValueInput,
  ServiceFieldValueRow,
  UpdateDisplayNameInput,
  UpdateFieldValueInput,
} from './service-types'
export {
  type SweepEntityFieldValuesParams,
  type SweepEntityFieldValuesResult,
  sweepEntityFieldValues,
} from './sweep-entity-references'
// Typed column match (shared between write-path dedup and read-path lookup)
export { type TypedColumnMatch, typedColumnMatch } from './typed-column-match'
// Service types
export type {
  AddRelationValuesBulkInput,
  AddRelationValuesInput,
  AddValueInput,
  ApplyBulkInput,
  ApplyBulkResult,
  BatchFieldValueResult,
  BatchGetValuesInput,
  BulkValueItem,
  BulkWriteMode,
  DeleteValueInput,
  FieldValueRow,
  GetValueInput,
  GetValuesInput,
  // Model types
  ModelType,
  RemoveRelationValuesBulkInput,
  RemoveRelationValuesInput,
  SetBulkValuesInput,
  SetPrimaryValueInput,
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
export { type UpdateAiMarkerInput, updateAiMarker } from './update-ai-marker'
export { updateEntityDisplayName } from './update-display-name'
export { updateFieldValue } from './update-value'
// Server-side read-only guard for app/connector-owned fields (Phase 3)
export { assertOriginMayWriteFields } from './write-guard'
// writeKey (id | systemAttribute) → CustomField.id resolution
export { buildWriteKeyToFieldIdMap } from './write-key-map'
