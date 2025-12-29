// packages/lib/src/workflow-engine/types/resource-reference.ts

import type { TableId } from '../client'

// import type { TableId } from '../../resources/field-registry'

/**
 * Lightweight resource reference marker
 * Stored instead of full resource objects to reduce memory
 */
export interface ResourceReference {
  __resourceRef: true
  resourceType: TableId
  resourceId: string
  organizationId: string
}

/**
 * Check if value is a resource reference
 */
export function isResourceReference(value: unknown): value is ResourceReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__resourceRef' in value &&
    value.__resourceRef === true
  )
}

/**
 * Create a resource reference
 */
export function createResourceReference(
  resourceType: TableId,
  resourceId: string,
  organizationId: string
): ResourceReference {
  return {
    __resourceRef: true,
    resourceType,
    resourceId,
    organizationId,
  }
}

/**
 * Cache entry for lazy-loaded resources
 */
export interface LazyLoadCacheEntry {
  /** Full resource data with fetched relationships */
  data: any

  /** When this was fetched */
  fetchedAt: Date

  /** Which relationship fields have been loaded */
  fetchedRelationships: Set<string>

  /** Preserve original ResourceReference for subsequent lookups.
   * When a ResourceReference is first accessed, it gets replaced with loaded data in variables.
   * Subsequent accesses to different fields on the same resource fail because isResourceReference()
   * returns false. By storing the original ref in cache, we can use it for path analysis.
   */
  resourceRef: ResourceReference
}

/**
 * Path analysis result for lazy loading
 */
export interface PathAnalysis {
  /** Base resource path (e.g., "crud1.ticket") */
  baseResourcePath: string

  /** Resource reference if found */
  baseResourceRef: ResourceReference | null

  /** Remaining path after base (e.g., "contact.firstName") */
  remainingPath: string

  /** Relationship fields that need fetching (e.g., ["contact"]) */
  relationshipsNeeded: string[]
}
