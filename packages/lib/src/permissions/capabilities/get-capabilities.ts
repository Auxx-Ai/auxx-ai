// packages/lib/src/permissions/capabilities/get-capabilities.ts

import type { ResourcePermission } from '@auxx/database/enums'
import {
  getCachedResources,
  getCachedRestrictedEntityDefIds,
  getCachedRestrictedInstanceIds,
  getCachedUserCapabilities,
  getOrgCache,
} from '../../cache'
import type { Resource } from '../../resources/registry/types'
import { CapabilitySet, type DefIdToSlug } from './capability-set'
import { PERMISSION_RANK } from './compose-user-capabilities'

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
 * Build the in-memory RecordId-def → canonical `entityDefinitionId` resolver
 * (§0 keying wrinkle). The def part of a RecordId can arrive as the system slug,
 * apiSlug, `id`, or `entityType` — every one maps to the entity's
 * `entityDefinitionId`, which is the keyspace of `defAccess` /
 * `restrictedEntityDefIds` (both sourced from `ResourceAccess.entityDefinitionId`).
 * Unlike {@link buildDefIdToSlug} (→ write-key slug), this resolves the other
 * direction. Pure map lookups; NEVER a DB query.
 */
function buildDefIdToDefinitionId(resources: Resource[]): DefIdToSlug {
  const defIdByKey = new Map<string, string>()
  for (const r of resources) {
    const defId = r.entityDefinitionId
    defIdByKey.set(r.id, defId)
    defIdByKey.set(r.apiSlug, defId)
    defIdByKey.set(r.entityDefinitionId, defId)
    if (r.entityType) defIdByKey.set(r.entityType, defId)
  }
  return (entityDefId) => defIdByKey.get(entityDefId) ?? entityDefId
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
  const [caps, roleMap, resources, restrictedDefIds, restrictedInstanceIds] = await Promise.all([
    getCachedUserCapabilities(userId, orgId),
    getOrgCache().get(orgId, 'memberRoleMap'),
    getCachedResources(orgId),
    getCachedRestrictedEntityDefIds(orgId),
    getCachedRestrictedInstanceIds(orgId),
  ])

  const entry = roleMap[userId]
  const role = entry?.role ?? 'USER'
  const seatType = entry?.seatType ?? 'full'

  // ResourceAccess rows are keyed inconsistently in practice — system entity
  // types by slug ('inbox'), custom defs by EntityDefinition CUID. Lookups in
  // `canViewEntity` normalize their argument through this resolver, so the SETS
  // must be normalized through the same resolver or slug-keyed grants silently
  // never match (§0 keying wrinkle applies to both sides).
  const toDefinitionId = buildDefIdToDefinitionId(resources)
  const defAccess: Record<string, ResourcePermission> = {}
  for (const [key, permission] of Object.entries(caps.defAccess)) {
    const defId = toDefinitionId(key)
    const existing = defAccess[defId]
    if (!existing || PERMISSION_RANK[permission] > PERMISSION_RANK[existing]) {
      defAccess[defId] = permission
    }
  }

  // instanceAccess keys on the globally-unique instance CUID (Dataset.id etc.),
  // so — unlike defAccess — no keyspace normalization is needed (§1.2).
  return new CapabilitySet(
    new Set(caps.keys),
    defAccess,
    role,
    seatType,
    buildDefIdToSlug(resources),
    new Set(restrictedDefIds.map(toDefinitionId)),
    toDefinitionId,
    caps.instanceAccess ?? {},
    new Set(restrictedInstanceIds)
  )
}
