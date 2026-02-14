// packages/lib/src/resources/client.ts
// Client-safe exports (types only, no server dependencies)
// NOTE: Import directly from specific files to avoid server-side code in barrel exports

// Model types - single source of truth for frontend
export { ModelTypeMeta, ModelTypes, ModelTypeValues } from '@auxx/database/enums'
export type { ModelType } from '@auxx/database/types'
// Relationship helpers (for deriving values from RelationshipConfig)
export {
  getInverseFieldId,
  getRelatedEntityDefinitionId,
  type RelationshipConfig,
} from '@auxx/types/custom-field'
export type { RecordId } from '@auxx/types/resource'
export type { MergeFieldInput, MergeFieldResult } from './merge/client'
// Merge utilities (client-safe)
export { mergeFieldValue } from './merge/client'

// Picker types
export type {
  GetResourceByIdInput,
  GetResourcesInput,
  PaginatedResourcesResult,
  RecordPickerItem,
} from './picker'
// Detail view configuration (client-safe)
export {
  DETAIL_VIEW_CONFIG_REGISTRY,
  getDetailViewConfig,
  hasDetailViewConfig,
} from './registry/detail-view-config'
export type {
  DetailViewActions,
  DetailViewConfig,
  DetailViewConfigRegistry,
  DetailViewEntityType,
  MainTabDefinition,
  SidebarTabDefinition,
} from './registry/detail-view-config-types'
// Display config types
export type {
  JoinScopingConfig,
  OrgScopingStrategy,
  ResourceDisplayConfig,
} from './registry/display-config'
// Drawer configuration (client-safe)
export {
  DRAWER_CONFIG_REGISTRY,
  getEntityDrawerConfig,
  hasDrawerConfig,
} from './registry/drawer-config'
export type {
  DrawerActions,
  DrawerConfig,
  DrawerConfigRegistry,
  DrawerTabDefinition,
} from './registry/drawer-config-types'
// Entity type constants (client-safe)
export { NEW_SYSTEM_ENTITY_TYPES, type NewSystemEntityType } from './registry/entity-types'
export type {
  ResourceFieldRegistry,
  ResourceTableDefinition,
  TableId,
} from './registry/field-registry'
// Registry constants (these are static, safe for client)
export {
  isValidTableId,
  RESOURCE_TABLE_MAP,
  RESOURCE_TABLE_REGISTRY,
} from './registry/field-registry'
// Field types
export type {
  FieldCapabilities,
  FieldOptionItem,
  FieldValidation,
  ResourceField,
} from './registry/field-types'
// Field utility functions (client-safe)
export {
  getDisplayFields,
  getFieldOperators,
  isComputedField,
  isSystemField,
  isValidOperatorForField,
  setEntityVariables,
  setResourceVariables,
  sortFieldsForDisplay,
} from './registry/field-utils'
export type {
  CustomResource,
  CustomResourceId,
  DisplayFieldConfig,
  Resource,
  SystemResource,
} from './registry/types'
// Resource types (system + custom)
export {
  isCustomResource,
  isCustomResourceId,
  isSystemResource,
  isSystemResourceId,
} from './registry/types'
// RecordId utilities (branded string format: entityDefinitionId:entityInstanceId)
export {
  getDefinitionId,
  getInstanceId,
  getModelType,
  isRecordId,
  isSystemModelType,
  parseRecordId,
  toRecordId,
  toRecordIds,
} from './resource-id'
