// packages/lib/src/cache/org-cache-helpers.ts

import type { CustomFieldEntity } from '@auxx/database/types'
import type { ResourceField } from '../resources/registry/field-types'
import type { Resource } from '../resources/registry/types'
import { getOrgCache } from './index'
import type { CachedGroup, OrgMemberInfo } from './org-cache-keys'

/**
 * Get a cached resource by ID (system TableId or custom entity UUID).
 * Searches the full `resources` cache array.
 */
export async function getCachedResource(
  orgId: string,
  resourceId: string
): Promise<Resource | null> {
  const resources = await getOrgCache().get(orgId, 'resources')
  return resources.find((r) => r.id === resourceId) ?? null
}

/**
 * Find a cached resource by ID, entityType, or apiSlug.
 * Useful when the input could be any of these (e.g., 'contact', a CUID, or 'contacts').
 */
export async function findCachedResource(orgId: string, key: string): Promise<Resource | null> {
  const resources = await getOrgCache().get(orgId, 'resources')
  return resources.find((r) => r.id === key || r.entityType === key || r.apiSlug === key) ?? null
}

/**
 * Get all cached resources for an organization.
 */
export async function getCachedResources(orgId: string): Promise<Resource[]> {
  return getOrgCache().get(orgId, 'resources')
}

/**
 * Get cached fields for a resource by ID.
 */
export async function getCachedResourceFields(
  orgId: string,
  resourceId: string
): Promise<ResourceField[]> {
  const resource = await getCachedResource(orgId, resourceId)
  return resource?.fields ?? []
}

/**
 * Get cached custom fields for an entity definition.
 */
export async function getCachedCustomFields(
  orgId: string,
  entityDefId: string
): Promise<CustomFieldEntity[]> {
  const customFields = await getOrgCache().get(orgId, 'customFields')
  return customFields[entityDefId] ?? []
}

/**
 * Get all cached custom fields across all entity definitions.
 */
export async function getAllCachedCustomFields(orgId: string): Promise<CustomFieldEntity[]> {
  const customFields = await getOrgCache().get(orgId, 'customFields')
  return Object.values(customFields).flat()
}

/**
 * Resolve an entityType to its entityDefinitionId using the cache.
 * Returns undefined if not found.
 */
export async function getCachedEntityDefId(
  orgId: string,
  entityType: string
): Promise<string | undefined> {
  const entityDefs = await getOrgCache().get(orgId, 'entityDefs')
  return entityDefs[entityType]
}

/**
 * Resolve an entityType to its entityDefinitionId using the cache.
 * Throws if not found.
 */
export async function requireCachedEntityDefId(orgId: string, entityType: string): Promise<string> {
  const id = await getCachedEntityDefId(orgId, entityType)
  if (!id) {
    throw new Error(`EntityDefinition not found for entityType: ${entityType}`)
  }
  return id
}

// ── Member cache helpers ──

/**
 * Get cached org members, optionally filtered by status and roles.
 */
export async function getCachedMembers(
  orgId: string,
  options?: { status?: string; roles?: string[] }
): Promise<OrgMemberInfo[]> {
  const members = await getOrgCache().get(orgId, 'members')
  let filtered = members

  if (options?.status) {
    filtered = filtered.filter((m) => m.status === options.status)
  }
  if (options?.roles?.length) {
    filtered = filtered.filter((m) => options.roles!.includes(m.role))
  }

  return filtered
}

/**
 * Get cached org members by user IDs.
 */
export async function getCachedMembersByUserIds(
  orgId: string,
  userIds: string[]
): Promise<OrgMemberInfo[]> {
  const members = await getOrgCache().get(orgId, 'members')
  const idSet = new Set(userIds)
  return members.filter((m) => idSet.has(m.userId))
}

// ── Group cache helpers ──

/**
 * Get all cached groups for an organization.
 */
export async function getCachedGroups(orgId: string): Promise<CachedGroup[]> {
  return getOrgCache().get(orgId, 'groups')
}
