// packages/lib/src/resources/index.ts

// Resource fetcher exports
export {
  enrichResource,
  enrichResources,
  executeResourceQuery,
  fetchResourceById,
  getResourceTypeFromEvent,
  getResourceIdField,
} from './resource-fetcher'

// Resource picker service (server-side)
export { ResourcePickerService } from './picker'
export type {
  GetResourcesInput,
  ResourcePickerItem,
  PaginatedResourcesResult,
  GetResourceByIdInput,
} from './picker'

// Resource registry service (server-side)
export { ResourceRegistryService } from './registry/resource-registry-service'

// Registry exports
export {
  RESOURCE_FIELD_REGISTRY,
  RESOURCE_TABLE_REGISTRY,
  RESOURCE_TABLE_MAP,
  RESOURCE_DISPLAY_CONFIG,
  isValidTableId,
  getAllFields,
  getField,
  getFilterableFields,
  getSortableFields,
  getCreatableFields,
  getUpdatableFields,
  getRequiredFields,
  getReadOnlyFields,
  isValidEnumValue,
  getEnumValues,
  getEnumLabel,
  isFieldRequired,
  isFieldCreatable,
  isFieldUpdatable,
  isFieldFilterable,
  isFieldSortable,
  getFieldOperators,
  isValidOperatorForField,
  setResourceVariables,
  setEntityVariables,
} from './registry'

// Type exports
export type { TableId } from './registry'
export type {
  ResourceField,
  EnumValue,
  FieldCapabilities,
  FieldValidation,
  ResourceFieldRegistry,
  ResourceTableDefinition,
} from './registry'
export type { ResourceDisplayConfig, OrgScopingStrategy, JoinScopingConfig } from './registry'

// Field capability utilities
export { canUpdateField, canSortField, canFilterField, canCreateField } from './capabilities/field-capabilities'

// Resource types (system + custom)
export {
  isSystemResource,
  isCustomResource,
  isSystemResourceId,
  isCustomResourceId,
} from './registry'
export type {
  Resource,
  SystemResource,
  CustomResource,
  DisplayFieldConfig,
  ResourceId,
  CustomResourceId,
} from './registry'

// CRUD service and handlers
export {
  ResourceCrudService,
  UnifiedCrudHandler,
  getHandler,
  contactHandler,
  ticketHandler,
  entityHandler,
  trackChanges,
  hasChanges,
  setCustomFields,
  fromDbResult,
  isNotFound,
  parseTags,
} from './crud'
export type {
  CrudOptions,
  CrudResult,
  CrudResultSuccess,
  CrudResultFailure,
  CrudContext,
  TransformedData,
  BulkResult,
  CreateRecordOptions,
  UpdateRecordOptions,
  FindByFieldOptions,
  ResourceHandler,
  FieldChange,
} from './crud'

// Merge service (server-side)
export { EntityMergeService } from './merge'
export type { MergeEntitiesInput, MergeEntitiesResult } from './merge'
