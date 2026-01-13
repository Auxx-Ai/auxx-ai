// packages/lib/src/resources/registry/index.ts

import { RESOURCE_FIELD_REGISTRY, type TableId, isValidTableId } from './field-registry'
import type { ResourceField, EnumValue } from './field-types'

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
 * Validate enum value for a field
 * Accepts both dbValue (e.g., 'MEDIUM') and label (e.g., 'Medium') formats
 */
export function isValidEnumValue(resourceType: TableId, fieldKey: string, value: string): boolean {
  const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
  if (!field || !field.enumValues) return true

  return field.enumValues.some((ev) => ev.dbValue === value || ev.label === value)
}

/**
 * Get enum values for a field
 */
export function getEnumValues(resourceType: TableId, fieldKey: string): EnumValue[] {
  const field = RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
  return field?.enumValues || []
}

/**
 * Get enum label for a database value
 */
export function getEnumLabel(resourceType: TableId, fieldKey: string, dbValue: string): string {
  const enumValues = getEnumValues(resourceType, fieldKey)
  const enumValue = enumValues.find((ev) => ev.dbValue === dbValue)
  return enumValue?.label || dbValue
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
  RESOURCE_FIELD_REGISTRY,
  RESOURCE_TABLE_REGISTRY,
  RESOURCE_TABLE_MAP,
} from './field-registry'
export type {
  ResourceField,
  EnumValue,
  FieldCapabilities,
  FieldValidation,
  ResourceFieldRegistry,
  ResourceTableDefinition,
} from './field-types'
// export * from './enum-values'

// Re-export field utility functions
export {
  getFieldOperators,
  isValidOperatorForField,
  setResourceVariables,
  setEntityVariables,
  isFieldReadOnly,
  isSystemField,
  isComputedField,
  sortFieldsForDisplay,
  getDisplayFields,
} from './field-utils'

// Re-export display configuration
export { RESOURCE_DISPLAY_CONFIG } from './display-config'
export type { ResourceDisplayConfig, OrgScopingStrategy, JoinScopingConfig } from './display-config'

// Re-export resource registry service and types
export { ResourceRegistryService } from './resource-registry-service'

// Re-export entity instance system fields
export { ENTITY_INSTANCE_FIELDS, getEntityInstanceFields } from './entity-instance-fields'
export { isSystemResource, isCustomResource, isSystemResourceId, isCustomResourceId } from './types'
export type {
  Resource,
  SystemResource,
  CustomResource,
  DisplayFieldConfig,
  ResourceId,
  CustomResourceId,
} from './types'
