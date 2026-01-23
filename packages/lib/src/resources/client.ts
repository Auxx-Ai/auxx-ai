// packages/lib/src/resources/client.ts
// Client-safe exports (types only, no server dependencies)
// NOTE: Import directly from specific files to avoid server-side code in barrel exports

// Model types - single source of truth for frontend
export { ModelTypes, ModelTypeMeta, ModelTypeValues } from '@auxx/database/enums'
export type { ModelType } from '@auxx/database/types'

// Registry constants (these are static, safe for client)
export {
  RESOURCE_TABLE_REGISTRY,
  RESOURCE_TABLE_MAP,
  isValidTableId,
} from './registry/field-registry'
export type {
  TableId,
  ResourceFieldRegistry,
  ResourceTableDefinition,
} from './registry/field-registry'

// Field types
export type {
  ResourceField,
  FieldOptionItem,
  FieldCapabilities,
  FieldValidation,
} from './registry/field-types'

// Display config types
export type {
  ResourceDisplayConfig,
  OrgScopingStrategy,
  JoinScopingConfig,
} from './registry/display-config'

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
} from './registry/types'
export type {
  Resource,
  SystemResource,
  CustomResource,
  DisplayFieldConfig,
  CustomResourceId,
} from './registry/types'

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
  isSystemField,
  isComputedField,
  sortFieldsForDisplay,
  getDisplayFields,
  getFieldOperators,
  isValidOperatorForField,
  setResourceVariables,
  setEntityVariables,
} from './registry/field-utils'

// Merge utilities (client-safe)
export { mergeFieldValue } from './merge/client'
export type { MergeFieldInput, MergeFieldResult } from './merge/client'

// Drawer configuration (client-safe)
export {
  DRAWER_CONFIG_REGISTRY,
  getEntityDrawerConfig,
  hasDrawerConfig,
} from './registry/drawer-config'
export type {
  DrawerConfig,
  DrawerTabDefinition,
  DrawerActions,
  DrawerConfigRegistry,
} from './registry/drawer-config-types'

// Detail view configuration (client-safe)
export {
  DETAIL_VIEW_CONFIG_REGISTRY,
  getDetailViewConfig,
  hasDetailViewConfig,
} from './registry/detail-view-config'
export type {
  DetailViewConfig,
  DetailViewEntityType,
  DetailViewConfigRegistry,
  MainTabDefinition,
  SidebarTabDefinition,
  DetailViewActions,
} from './registry/detail-view-config-types'

// Entity type constants (client-safe)
export { NEW_SYSTEM_ENTITY_TYPES, type NewSystemEntityType } from './registry/entity-types'

// Relationship helpers (for deriving values from RelationshipConfig)
export {
  getRelatedEntityDefinitionId,
  getInverseFieldId,
  type RelationshipConfig,
} from '@auxx/types/custom-field'
