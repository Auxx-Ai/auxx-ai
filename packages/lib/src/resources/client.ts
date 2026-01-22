// packages/lib/src/resources/client.ts
// Client-safe exports (types only, no server dependencies)

// Model types - single source of truth for frontend
export { ModelTypes, ModelTypeMeta, ModelTypeValues } from '@auxx/database/enums'
export type { ModelType } from '@auxx/database/types'

// Registry constants (these are static, safe for client)
export { RESOURCE_TABLE_REGISTRY, RESOURCE_TABLE_MAP, isValidTableId } from './registry'

// Type exports
export type { TableId } from './registry'
export type {
  ResourceField,
  FieldOptionItem,
  FieldCapabilities,
  FieldValidation,
  ResourceFieldRegistry,
  ResourceTableDefinition,
} from './registry'
export type { ResourceDisplayConfig, OrgScopingStrategy, JoinScopingConfig } from './registry'

// Picker types
export type {
  GetResourcesInput,
  RecordPickerItem,
  PaginatedResourcesResult,
  GetResourceByIdInput,
} from './picker'

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
  CustomResourceId,
} from './registry'

// RecordId utilities (branded string format: entityDefinitionId:entityInstanceId)
export {
  toRecordId,
  parseRecordId,
  isRecordId,
  toRecordIds,
  getInstanceId,
  getDefinitionId,
  isSystemModelType,
  getModelType,
} from './resource-id'
export type { RecordId } from '@auxx/types/resource'

// Field utility functions (client-safe)
export {
  isFieldReadOnly,
  isSystemField,
  isComputedField,
  sortFieldsForDisplay,
  getDisplayFields,
} from './registry'

// Merge utilities (client-safe)
export { mergeFieldValue } from './merge/client'
export type { MergeFieldInput, MergeFieldResult } from './merge/client'

// Drawer configuration (client-safe)
export { DRAWER_CONFIG_REGISTRY, getEntityDrawerConfig, hasDrawerConfig } from './registry'
export type { DrawerConfig, DrawerTabDefinition, DrawerActions, DrawerConfigRegistry } from './registry'

// Detail view configuration (client-safe)
export { DETAIL_VIEW_CONFIG_REGISTRY, getDetailViewConfig, hasDetailViewConfig } from './registry'
export type {
  DetailViewConfig,
  DetailViewEntityType,
  DetailViewConfigRegistry,
  MainTabDefinition,
  SidebarTabDefinition,
  DetailViewActions,
} from './registry'

// Relationship helpers (for deriving values from RelationshipConfig)
export {
  getRelatedEntityDefinitionId,
  getInverseFieldId,
  type RelationshipConfig,
} from '@auxx/types/custom-field'
