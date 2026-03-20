// packages/lib/src/resources/index.ts

// Field capability utilities
export {
  canCreateField,
  canFilterField,
  canSortField,
  canUpdateField,
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
  TransformedData,
  UpdateRecordOptions,
} from './crud'
// CRUD service and handlers
export {
  fromDbResult,
  hasChanges,
  isNotFound,
  parseTags,
  setCustomFields,
  trackChanges,
  UnifiedCrudHandler,
} from './crud'
export { listAll } from './crud/unified-handler-queries'
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
  getResourceTypeFromEvent,
} from './resource-fetcher'
