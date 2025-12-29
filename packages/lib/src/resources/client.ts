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
  EnumValue,
  FieldCapabilities,
  FieldValidation,
  ResourceFieldRegistry,
  ResourceTableDefinition,
} from './registry'
export type { ResourceDisplayConfig, OrgScopingStrategy, JoinScopingConfig } from './registry'

// Picker types
export type {
  GetResourcesInput,
  ResourcePickerItem,
  PaginatedResourcesResult,
  GetResourceByIdInput,
} from './picker'

// Resource types (system + custom)
export {
  isSystemResource,
  isCustomResource,
  isSystemResourceId,
  isCustomResourceId,
  getEntitySlug,
  buildCustomResourceId,
} from './registry'
export type {
  Resource,
  SystemResource,
  CustomResource,
  DisplayFieldConfig,
  ResourceId,
  CustomResourceId,
} from './registry'
