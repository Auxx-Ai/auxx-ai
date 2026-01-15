// packages/lib/src/resources/registry/types.ts

import type { JoinScopingConfig } from './display-config'
import { RESOURCE_TABLE_REGISTRY, type TableId } from './field-registry'
import type { ResourceField } from './field-types'

/**
 * Entity definition UUID (custom resource ID, e.g., 'cm1234abc567def890...')
 * No entity_ prefix - this is the raw UUID
 */
export type EntityDefinitionId = string & { readonly __brand: 'EntityDefinitionId' }

/** Custom resource ID is now just the UUID (EntityDefinitionId) */
export type CustomResourceId = EntityDefinitionId

/** Any resource ID (system or custom) */
export type ResourceId = TableId | CustomResourceId

/** Base resource fields shared by both types */
interface BaseResource {
  id: string
  label: string
  plural: string
  icon: string
  color: string
  /** Field definitions for this resource */
  fields: ResourceField[]
  entityType?: string
}

/** System resource with static display config */
export interface SystemResource extends BaseResource {
  type: 'system'
  /** API slug (e.g., 'contacts', 'tickets') */
  apiSlug: string
  /** Entity definition ID (same as id for system resources) */
  entityDefinitionId: string
  dbName: string
  display: {
    identifierField: string
    displayNameField: string | ((row: Record<string, unknown>) => string)
    secondaryInfoField?: string | ((row: Record<string, unknown>) => string)
    avatarField?: string
    searchFields: string[]
    defaultSortField?: string
    defaultSortDirection?: 'asc' | 'desc'
    orgScopingStrategy: 'direct' | 'join'
    joinScoping?: JoinScopingConfig
  }
}

/** Display field with full metadata */
export interface DisplayFieldConfig {
  id: string
  /** Field display name */
  name: string
  /** Field type (CustomFieldType) */
  type: string
}

/** Custom entity resource with field-based display config */
export interface CustomResource extends BaseResource {
  type: 'custom'
  apiSlug: string
  entityDefinitionId: string
  organizationId: string
  display: {
    /** Primary display field with full metadata */
    primaryDisplayField: DisplayFieldConfig | null
    /** Secondary display field with full metadata */
    secondaryDisplayField: DisplayFieldConfig | null
    /** Avatar field with full metadata */
    avatarField: DisplayFieldConfig | null
    /** Default sort is always updatedAt desc for custom entities */
    defaultSortField: 'updatedAt'
    defaultSortDirection: 'desc'
    /** Custom entities always use direct org scoping via EntityInstance table */
    orgScopingStrategy: 'direct'
  }
}

/** Union type for any resource */
export type Resource = SystemResource | CustomResource

/**
 * Type guard to check if resource is a system resource
 */
export function isSystemResource(resource: Resource): resource is SystemResource {
  return resource.type === 'system'
}

/**
 * Type guard to check if resource is a custom entity resource
 */
export function isCustomResource(resource: Resource): resource is CustomResource {
  return resource.type === 'custom'
}

/**
 * Type guard to check if a string is a valid system TableId
 */
export function isSystemResourceId(id: string): id is TableId {
  return RESOURCE_TABLE_REGISTRY.some((r) => r.id === id)
}

/**
 * Type guard to check if a string is a custom resource ID (UUID format)
 * A UUID is considered custom if it's not a known system TableId
 */
export function isCustomResourceId(id: string): id is CustomResourceId {
  // Not a system resource and has UUID format (minimum CUID2 length)
  return !isSystemResourceId(id) && id.length >= 20
}
