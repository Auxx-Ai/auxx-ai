// packages/lib/src/resources/registry/types.ts

import type { JoinScopingConfig } from './display-config'
import { RESOURCE_TABLE_REGISTRY, type TableId } from './field-registry'
import type { ResourceField } from './field-types'

/** Custom resource ID format (e.g., 'entity_product') */
export type CustomResourceId = `entity_${string}`

/** Any resource ID (system or custom) */
export type ResourceId = TableId | CustomResourceId

/** Base resource fields shared by both types */
interface BaseResource {
  id: string
  label: string
  plural: string
  icon: string
  /** Field definitions for this resource */
  fields: ResourceField[]
}

/** System resource with static display config */
export interface SystemResource extends BaseResource {
  type: 'system'
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
  color?: string
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
 * Type guard to check if a string is a custom resource ID
 */
export function isCustomResourceId(id: string): id is CustomResourceId {
  return id.startsWith('entity_')
}

/**
 * Extract the slug from a custom resource ID
 * @example getEntitySlug('entity_product') → 'product'
 */
export function getEntitySlug(resourceId: CustomResourceId): string {
  return resourceId.replace('entity_', '')
}

/**
 * Build a custom resource ID from a slug
 * @example buildCustomResourceId('product') → 'entity_product'
 */
export function buildCustomResourceId(slug: string): CustomResourceId {
  return `entity_${slug}`
}
