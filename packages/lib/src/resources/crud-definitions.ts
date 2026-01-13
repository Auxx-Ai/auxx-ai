// packages/lib/src/workflow-engine/resources/crud-definitions.ts

import {
  RESOURCE_FIELD_REGISTRY,
  getCreatableFields,
  getUpdatableFields,
  getRequiredFields,
  getReadOnlyFields,
  type ResourceField,
} from './registry'
import { RESOURCE_CONFIGS } from './definitions'
import type { ResourceConfig } from './definitions'
import type { TableId } from './registry/field-registry'

/**
 * Resource configuration for CRUD operations
 * Built from the unified field registry
 */
export interface ResourceCrudConfig extends ResourceConfig {
  /** Fields that can be set during create operation */
  creatableFields: ResourceField[]

  /** Fields that can be modified during update operation */
  updatableFields: ResourceField[]

  /** Fields required for create operation */
  requiredFields: ResourceField[]

  /** Fields that are read-only (auto-generated, system-managed) */
  readOnlyFields: ResourceField[]

  /** Whether this resource supports custom fields */
  supportsCustomFields: boolean
}

/**
 * Build CRUD configuration from registry
 */
function buildCrudConfig(resourceType: TableId): ResourceCrudConfig {
  const baseConfig = RESOURCE_CONFIGS[resourceType]
  const allFields = RESOURCE_FIELD_REGISTRY[resourceType]

  if (!baseConfig || !allFields) {
    throw new Error(`Unknown resource type: ${resourceType}`)
  }

  const creatableFields = getCreatableFields(resourceType)
  const updatableFields = getUpdatableFields(resourceType)
  const requiredFields = getRequiredFields(resourceType)
  const readOnlyFields = getReadOnlyFields(resourceType)

  return {
    ...baseConfig,
    type: resourceType,
    creatableFields,
    updatableFields,
    requiredFields,
    readOnlyFields,
    supportsCustomFields: true, // Both contact and ticket support custom fields
  }
}

/**
 * Resource configurations for CRUD operations
 * Single source of truth built from registry
 *
 * Note: Thread is action-based (update only) - threads are created via email sync,
 * not through CRUD operations. See thread-fields.ts for action field details.
 */
export const CRUD_RESOURCE_CONFIGS: Record<TableId, ResourceCrudConfig> = {
  // contact: buildCrudConfig('contact'),
  ticket: buildCrudConfig('ticket'),
  thread: buildCrudConfig('thread'), // Action-based: update only (no create/delete)
  // user: buildCrudConfig('user'),
  // inbox: buildCrudConfig('inbox'),
  // participant: buildCrudConfig('participant'),
  // message: buildCrudConfig('message'),
}

/**
 * Get fields for a specific CRUD operation mode
 * Replaces getFieldsForMode() from field-definitions.ts
 */
export function getCrudFieldsForMode(
  resourceType: TableId,
  mode: 'create' | 'update' | 'delete'
): ResourceField[] {
  const config = CRUD_RESOURCE_CONFIGS[resourceType]
  if (!config) return []

  switch (mode) {
    case 'create':
      return config.creatableFields
    case 'update':
      return config.updatableFields
    case 'delete':
      return [] // Delete mode doesn't need field inputs
    default:
      return []
  }
}

/**
 * Check if a field is required for create operation
 * Convenience function for validation
 */
export function isCrudFieldRequired(resourceType: TableId, fieldKey: string): boolean {
  const config = CRUD_RESOURCE_CONFIGS[resourceType]
  if (!config) return false

  return config.requiredFields.some((f) => f.key === fieldKey)
}

/**
 * Get field definition by key
 * Convenience function for CRUD operations
 */
export function getCrudField(resourceType: TableId, fieldKey: string): ResourceField | undefined {
  return RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldKey]
}
