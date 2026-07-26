// packages/lib/src/permissions/capabilities/resolve-capability-inputs.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { Resource } from '../../resources/registry/types'
import type { DefIdToSlug } from './capability-set'
import { PERMISSION_RANK, type UserCapabilities } from './compose-user-capabilities'
import { levelToRecordBasePermission } from './entity-access'
import { areaLevelFromKeys, type PermissionKey } from './registry'
import { ENTITY_BASE_AREAS } from './seat-policy'

/**
 * Build the in-memory RecordId-def → entity-slug resolver from the cached
 * `resources` array (§6.1). The def part of a RecordId can arrive as the system
 * slug (`work_order`), the apiSlug, or the `entityDefinitionId`/`id` — every one
 * maps to the entity's system slug (`entityType`), falling back to `apiSlug`.
 * Pure map lookups; NEVER a DB query.
 */
export function buildDefIdToSlug(resources: Resource[]): DefIdToSlug {
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
export function buildDefIdToDefinitionId(resources: Resource[]): DefIdToSlug {
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
 * The composed capability blob, normalized against one org's `resources`
 * projection — everything a {@link import('./entity-access').ResolvedRecordAccess}
 * needs except `role`/`seatType` and the two org-wide restricted sets.
 */
export interface ResolvedCapabilityInputs {
  keys: Set<PermissionKey>
  /** `defAccess` re-keyed into the canonical `entityDefinitionId` keyspace. */
  defAccess: Record<string, ResourcePermission>
  /** Per-def record base for definitions backed by another Layer-2 area. */
  defBaseOverrides: Record<string, ResourcePermission | null>
  toDefinitionId: DefIdToSlug
  toSlug: DefIdToSlug
}

/**
 * Resolve a composed {@link UserCapabilities} blob against the org's `resources`
 * projection — the seam where slug-keyed data becomes `entityDefinitionId`-keyed.
 *
 * Extracted from `getCapabilities` so the doc-19 §6.1 escalation guard can build
 * the SAME `ResolvedRecordAccess` inputs from a transaction-local composition
 * without duplicating this normalization. A second copy is how the guard and
 * enforcement drift apart (§6.1.4).
 *
 * Pure: `resources` is the only lookup table and every step is a map read.
 */
export function resolveCapabilityInputs(
  caps: UserCapabilities,
  resources: Resource[]
): ResolvedCapabilityInputs {
  const keys = new Set(caps.keys)

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

  // Resolve the handful of feature-backed record defs from entity slug to the
  // canonical definition-id keyspace once. `null` is intentional: it
  // distinguishes an explicitly closed derived base from an absent override,
  // which falls back to the Records area on both server and client.
  const defBaseOverrides: Record<string, ResourcePermission | null> = {}
  for (const resource of resources) {
    const slug = resource.entityType ?? resource.apiSlug
    const area = ENTITY_BASE_AREAS[slug]
    if (!area) continue
    defBaseOverrides[resource.entityDefinitionId] =
      levelToRecordBasePermission(areaLevelFromKeys(keys, area)) ?? null
  }

  return {
    keys,
    defAccess,
    defBaseOverrides,
    toDefinitionId,
    toSlug: buildDefIdToSlug(resources),
  }
}
