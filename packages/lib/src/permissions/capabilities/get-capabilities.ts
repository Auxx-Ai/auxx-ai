// packages/lib/src/permissions/capabilities/get-capabilities.ts

import {
  getCachedGoverningInstanceIds,
  getCachedResources,
  getCachedRestrictedEntityDefIds,
  getCachedUserCapabilities,
  getOrgCache,
} from '../../cache'
import { CapabilitySet } from './capability-set'
import { resolveCapabilityInputs } from './resolve-capability-inputs'

/**
 * Resolve a member's {@link CapabilitySet} for one org (§6.1) — the check-path
 * entry point. Reads the composed capability blob via `getCachedUserCapabilities`
 * (ONE user-cache read, L1-fronted so warm calls are a local Map hit) plus the
 * cached `memberRoleMap` (role + seatType) and `resources` (the def→slug
 * resolver). No composition happens here — that's the provider's job.
 *
 * The slug→`entityDefinitionId` normalization lives in
 * {@link resolveCapabilityInputs}, shared with the doc-19 §6.1 escalation guard
 * so a transaction-local recomputation resolves identically (§6.1.4).
 *
 * The `db` parameter is accepted for signature symmetry with the other guards;
 * every read on this path is cache-backed, so it is not used.
 */
export async function getCapabilities(
  userId: string,
  orgId: string,
  _db?: unknown
): Promise<CapabilitySet> {
  const [caps, roleMap, resources, restrictedDefIds, governingInstanceIds] = await Promise.all([
    getCachedUserCapabilities(userId, orgId),
    getOrgCache().get(orgId, 'memberRoleMap'),
    getCachedResources(orgId),
    getCachedRestrictedEntityDefIds(orgId),
    getCachedGoverningInstanceIds(orgId),
  ])

  const entry = roleMap[userId]
  const role = entry?.role ?? 'USER'
  const seatType = entry?.seatType ?? 'full'
  const resolved = resolveCapabilityInputs(caps, resources)

  // instanceAccess keys on the globally-unique instance CUID (Dataset.id etc.),
  // so — unlike defAccess — no keyspace normalization is needed (§1.2).
  return new CapabilitySet(
    resolved.keys,
    resolved.defAccess,
    role,
    seatType,
    resolved.toSlug,
    new Set(restrictedDefIds.map(resolved.toDefinitionId)),
    resolved.toDefinitionId,
    caps.instanceAccess ?? {},
    new Set(governingInstanceIds),
    resolved.defBaseOverrides,
    // Composed, not recomputed here: `instanceDerivedKeys` is type-aware, and the
    // type lives on the ResourceAccess row that only the composer reads. `?? []`
    // covers a blob composed before the field existed — a missing derived key
    // fails CLOSED (the member simply sees the coarse gate they saw before).
    new Set(caps.instanceDerivedKeys ?? []),
    // The BASELINE lane (plan 43 §4.1). `?? {}` covers a pre-`v16` blob — and
    // UNLIKE `instanceDerivedKeys` above, that default fails **OPEN**: such a
    // blob's `instanceAccess` still holds the merged union of both lanes, so
    // step 1 of `effectiveInstanceLevel` hands back the workspace baseline as if
    // it were an individual grant and the area gate never runs. That is why the
    // `v15 → v16` bump is mandatory rather than hygienic; see the reason recorded
    // at the key in `cache/user-cache-keys.ts`.
    caps.baselineInstanceAccess ?? {}
  )
}
