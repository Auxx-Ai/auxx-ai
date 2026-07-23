// packages/lib/src/permissions/capabilities/get-capabilities.ts

import { getCachedResources, getCachedUserCapabilities, getOrgCache } from '../../cache'
import type { Resource } from '../../resources/registry/types'
import { CapabilitySet, type DefIdToSlug } from './capability-set'

/**
 * Build the in-memory RecordId-def → entity-slug resolver from the cached
 * `resources` array (§6.1). The def part of a RecordId can arrive as the system
 * slug (`work_order`), the apiSlug, or the `entityDefinitionId`/`id` — every one
 * maps to the entity's system slug (`entityType`), falling back to `apiSlug`.
 * Pure map lookups; NEVER a DB query.
 */
function buildDefIdToSlug(resources: Resource[]): DefIdToSlug {
  const slugByKey = new Map<string, string>()
  for (const r of resources) {
    const slug = r.entityType ?? r.apiSlug
    slugByKey.set(r.id, slug)
    slugByKey.set(r.apiSlug, slug)
    slugByKey.set(r.entityDefinitionId, slug)
    if (r.entityType) slugByKey.set(r.entityType, slug)
  }
  return (entityDefId) => slugByKey.get(entityDefId) ?? entityDefId
}

/**
 * Resolve a member's {@link CapabilitySet} for one org (§6.1) — the check-path
 * entry point. Reads the composed capability blob via `getCachedUserCapabilities`
 * (ONE user-cache read, L1-fronted so warm calls are a local Map hit) plus the
 * cached `memberRoleMap` (role + seatType) and `resources` (the def→slug
 * resolver). No composition happens here — that's the provider's job.
 *
 * The `db` parameter is accepted for signature symmetry with the other guards;
 * every read on this path is cache-backed, so it is not used.
 */
export async function getCapabilities(
  userId: string,
  orgId: string,
  _db?: unknown
): Promise<CapabilitySet> {
  const [caps, roleMap, resources] = await Promise.all([
    getCachedUserCapabilities(userId, orgId),
    getOrgCache().get(orgId, 'memberRoleMap'),
    getCachedResources(orgId),
  ])

  const entry = roleMap[userId]
  const role = entry?.role ?? 'USER'
  const seatType = entry?.seatType ?? 'full'

  return new CapabilitySet(
    new Set(caps.keys),
    caps.defAccess,
    role,
    seatType,
    buildDefIdToSlug(resources)
  )
}
