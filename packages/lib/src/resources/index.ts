// packages/lib/src/resources/index.ts

// Field capability utilities
export {
  canCreateField,
  canFilterField,
  canSortField,
  canUpdateField,
  isFieldHidden,
} from './capabilities/field-capabilities'
export type {
  BulkResult,
  CreateEntityResult,
  CreateRecordOptions,
  CrudContext,
  CrudOptions,
  CrudResult,
  CrudResultFailure,
  CrudResultSuccess,
  FieldChange,
  FindByFieldOptions,
  LookupByFieldResult,
  LookupCandidate,
  LookupMatch,
  TransformedData,
  UpdateRecordOptions,
} from './crud'
// CRUD service and handlers
// Write-origin sessions (plan 03 §4) — exposed here so packages/seed can build
// seed sessions via the constructors instead of inline literals.
export {
  fromDbResult,
  hasChanges,
  interactiveSession,
  isNotFound,
  parseTags,
  seedSession,
  setCustomFields,
  trackChanges,
  UnifiedCrudHandler,
  type WriteOrigin,
  type WriteSession,
} from './crud'
// The per-row record write gate (plan v3/03 §5.3)
export type { StampedRow } from './crud/record-row-access'
export {
  assertRecordRowsEditable,
  assertRecordRowsEditableWithDb,
  assertRowsEditableFromStamps,
  defDeniedRecordIds,
} from './crud/record-row-access'
export { listAll } from './crud/unified-handler-queries'
// Field-value lookup core (extracted from UnifiedCrudHandler.lookupByField)
export type { LookupEntitiesByFieldValueParams } from './lookup'
export {
  AmbiguousLookupError,
  buildLookupCondition,
  lookupEntitiesByFieldValue,
} from './lookup'
export type { MergeEntitiesInput, MergeEntitiesResult } from './merge'
// Merge service (server-side)
export { EntityMergeService } from './merge'
export type {
  GetResourceByIdInput,
  GetResourcesInput,
  PaginatedResourcesResult,
  RecordPickerItem,
} from './picker'
// Record picker service (server-side)
export { RecordPickerService } from './picker'
// Condition query builders (WHERE/ORDER BY SQL for generic record queries)
export {
  BaseConditionBuilder,
  type ConditionGroup,
  ConditionQueryBuilder,
  type ConditionQueryResult,
  type DroppedCondition,
  type DroppedConditionReason,
  EntityConditionBuilder,
  type EntityQueryContext,
  entityConditionBuilder,
  type GenericCondition,
  SystemConditionBuilder,
  systemConditionBuilder,
  type ValidationResult,
} from './query-builder'
// Positive existence check for relation targets (NOT the inverse of hydration)
export type { FindMissingRecordTargetsParams } from './record-existence'
export { findMissingRecordTargets, MAX_EXISTENCE_BATCH } from './record-existence'
// Type exports
export type {
  CustomResource,
  CustomResourceId,
  DisplayFieldConfig,
  EntityDefinitionType,
  FieldCapabilities,
  FieldValidation,
  JoinScopingConfig,
  OrgScopingStrategy,
  Resource,
  ResourceDisplayConfig,
  ResourceField,
  ResourceFieldRegistry,
  ResourceId, // Note: This is registry's ResourceId (TableId | CustomResourceId), different from RecordId
  ResourceTableDefinition,
  SystemResource,
  TableId,
} from './registry'
// Registry exports
// Resource types (system + custom)
export {
  ENTITY_DEFINITION_TYPES,
  fieldMatchesRef,
  findNamedImporter,
  getAllFields,
  getCreatableFields,
  getField,
  getFieldOperators,
  getFieldOutputKey,
  getFilterableFields,
  getReadOnlyFields,
  getRequiredFields,
  getSortableFields,
  getUpdatableFields,
  isCustomResource,
  isCustomResourceId,
  isEntityDefinitionType,
  isFieldCreatable,
  isFieldFilterable,
  isFieldRequired,
  isFieldSortable,
  isFieldUpdatable,
  isSystemResource,
  isSystemResourceId,
  isValidOperatorForField,
  isValidTableId,
  RESOURCE_DISPLAY_CONFIG,
  RESOURCE_FIELD_REGISTRY,
  RESOURCE_TABLE_MAP,
  RESOURCE_TABLE_REGISTRY,
  resolveFieldRef,
  setEntityVariables,
  setResourceVariables,
} from './registry'
// Resource registry service (server-side)
export { ResourceRegistryService } from './registry/resource-registry-service'
// Resource fetcher exports
export {
  enrichResource,
  enrichResources,
  executeResourceQuery,
  fetchResourceById,
  getRecordIdField,
} from './resource-fetcher'
