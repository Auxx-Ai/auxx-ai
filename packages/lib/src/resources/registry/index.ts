// packages/lib/src/resources/registry/index.ts

import { isValidTableId, RESOURCE_FIELD_REGISTRY, type TableId } from './field-registry'
import type { ResourceField } from './field-types'
import { getFieldOptions, getOptionLabel, hasOptions, isValidOptionValue } from './option-helpers'

// Re-export for easy access
export { isValidTableId }
export type { TableId }

/**
 * Get all fields for a resource type
 */
export function getAllFields(resourceType: TableId): ResourceField[] {
  const fields = RESOURCE_FIELD_REGISTRY[resourceType]
  if (!fields) return []

  return Object.values(fields)
}

/**
 * Get a specific field by key
 */
export function getField(resourceType: TableId, fieldKey: string): ResourceField | undefined {
  return RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
}

/**
 * Get all filterable fields for a resource (for Find node)
 */
export function getFilterableFields(resourceType: TableId): ResourceField[] {
  const fields = RESOURCE_FIELD_REGISTRY[resourceType]
  if (!fields) return []

  return Object.values(fields).filter((f) => f.capabilities.filterable)
}

/**
 * Get all sortable fields for a resource (for Find node)
 */
export function getSortableFields(resourceType: TableId): ResourceField[] {
  const fields = RESOURCE_FIELD_REGISTRY[resourceType]
  if (!fields) return []

  return Object.values(fields).filter((f) => f.capabilities.sortable)
}

/**
 * Get all creatable fields for a resource (for CRUD create)
 */
export function getCreatableFields(resourceType: TableId): ResourceField[] {
  const fields = RESOURCE_FIELD_REGISTRY[resourceType]
  if (!fields) return []

  return Object.values(fields).filter((f) => f.capabilities.creatable)
}

/**
 * Get all updatable fields for a resource (for CRUD update)
 */
export function getUpdatableFields(resourceType: TableId): ResourceField[] {
  const fields = RESOURCE_FIELD_REGISTRY[resourceType]
  if (!fields) return []

  return Object.values(fields).filter((f) => f.capabilities.updatable)
}

/**
 * Get required fields for resource creation
 */
export function getRequiredFields(resourceType: TableId): ResourceField[] {
  const fields = RESOURCE_FIELD_REGISTRY[resourceType]
  if (!fields) return []

  return Object.values(fields).filter((f) => f.capabilities.required === true)
}

/**
 * Get read-only fields (cannot be created or updated)
 */
export function getReadOnlyFields(resourceType: TableId): ResourceField[] {
  const fields = RESOURCE_FIELD_REGISTRY[resourceType]
  if (!fields) return []

  return Object.values(fields).filter((f) => !f.capabilities.creatable && !f.capabilities.updatable)
}

/**
 * Validate option value for a field.
 * Accepts both value (e.g., 'MEDIUM') and label (e.g., 'Medium') formats.
 */
export function isValidFieldOptionValue(
  resourceType: TableId,
  fieldKey: string,
  value: string
): boolean {
  const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
  return isValidOptionValue(field, value)
}

/**
 * Get options for a field.
 */
export function getFieldOptionsForResource(resourceType: TableId, fieldKey: string) {
  const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
  return getFieldOptions(field)
}

/**
 * Get option label for a stored value.
 */
export function getFieldOptionLabel(
  resourceType: TableId,
  fieldKey: string,
  value: string
): string {
  const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
  return getOptionLabel(field, value)
}

/**
 * Check if a field is required for creation
 */
export function isFieldRequired(resourceType: TableId, fieldKey: string): boolean {
  const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
  return field?.capabilities.required === true
}

/**
 * Check if a field can be created
 */
export function isFieldCreatable(resourceType: TableId, fieldKey: string): boolean {
  const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
  return field?.capabilities.creatable === true
}

/**
 * Check if a field can be updated
 */
export function isFieldUpdatable(resourceType: TableId, fieldKey: string): boolean {
  const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
  return field?.capabilities.updatable === true
}

/**
 * Check if a field can be filtered
 */
export function isFieldFilterable(resourceType: TableId, fieldKey: string): boolean {
  const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
  return field?.capabilities.filterable === true
}

/**
 * Check if a field can be sorted
 */
export function isFieldSortable(resourceType: TableId, fieldKey: string): boolean {
  const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
  return field?.capabilities.sortable === true
}

// Re-export types and registries
export {
  EXCLUDED_RESOURCE_TYPES,
  RESOURCE_FIELD_REGISTRY,
  RESOURCE_TABLE_MAP,
  RESOURCE_TABLE_REGISTRY,
} from './field-registry'
export type {
  FieldCapabilities,
  FieldValidation,
  ResourceField,
  ResourceFieldRegistry,
  ResourceTableDefinition,
} from './field-types'

// Re-export option helpers
export {
  type FieldOptionItem,
  getFieldOptions,
  getOptionLabel,
  hasOptions,
  isValidOptionValue,
  labelToValue,
} from './option-helpers'

// export * from './enum-values'

// Re-export common fields (shared across all entity types)
export { CREATED_BY_FIELD } from './common-fields'
// Re-export detail view configuration
export {
  DETAIL_VIEW_CONFIG_REGISTRY,
  getDetailViewConfig,
  hasDetailViewConfig,
} from './detail-view-config'
export type {
  DetailViewActions,
  DetailViewConfig,
  DetailViewConfigRegistry,
  DetailViewEntityType,
  MainTabDefinition,
  SidebarTabDefinition,
} from './detail-view-config-types'
export type { JoinScopingConfig, OrgScopingStrategy, ResourceDisplayConfig } from './display-config'
// Re-export display configuration
export { RESOURCE_DISPLAY_CONFIG } from './display-config'
// Re-export drawer configuration
export { DRAWER_CONFIG_REGISTRY, getEntityDrawerConfig, hasDrawerConfig } from './drawer-config'
export type {
  DrawerActions,
  DrawerConfig,
  DrawerConfigRegistry,
  DrawerTabDefinition,
} from './drawer-config-types'
// Re-export entity definition resolver (server-side only)
export { resolveNewSystemEntityDefId } from './entity-def-resolver'
// Re-export entity instance system fields
export { ENTITY_INSTANCE_FIELDS, getEntityInstanceFields } from './entity-instance-fields'
// Re-export entity type constants (client-safe)
export { NEW_SYSTEM_ENTITY_TYPES, type NewSystemEntityType } from './entity-types'
// Re-export field utility functions
export {
  getDisplayFields,
  getFieldOperators,
  isComputedField,
  isSystemField,
  isValidOperatorForField,
  setEntityVariables,
  setResourceVariables,
  sortFieldsForDisplay,
} from './field-utils'
// Re-export resource registry service and types
export { ResourceRegistryService } from './resource-registry-service'
export type {
  CustomResource,
  CustomResourceId,
  DisplayFieldConfig,
  Resource,
  ResourceId,
  SystemResource,
} from './types'
export { isCustomResource, isCustomResourceId, isSystemResource, isSystemResourceId } from './types'
