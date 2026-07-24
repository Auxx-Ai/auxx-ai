// packages/lib/src/permissions/capabilities/compose-user-capabilities.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import {
  type Area,
  buildAreaLevels,
  expandLevelsToKeys,
  Level,
  type PermissionKey,
} from './registry'
import { ROLE_DEFAULTS, SEAT_CEILINGS } from './seat-policy'

/**
 * A user's composed Layer-2 capability set for one org.
 *  - `keys`: the coarse capability verbs the member holds (already seat-clamped).
 *  - `defAccess`: highest type-level ResourceAccess permission per entity
 *    definition (Layer-3 data scoping folded into the same blob, §9.0). Defs
 *    without any type-level grant are ABSENT = unrestricted (today's behavior).
 */
export interface UserCapabilities {
  keys: PermissionKey[]
  defAccess: Record<string, ResourcePermission>
  /**
   * Highest instance-level ResourceAccess permission per `entityInstanceId`
   * (CUID) for the instance-access resources (datasets etc., §1.2). Keys are
   * globally-unique instance ids, so no `resourceKey` disambiguation is needed.
   * Unlike `defAccess`, explicit `'none'` rows are KEPT — they are the per-
   * instance downward marker (a real grant outranks them via {@link PERMISSION_RANK}).
   */
  instanceAccess: Record<string, ResourcePermission>
}

/**
 * Hierarchy rank for picking the highest ResourceAccess permission. `none` is
 * the baseline lockdown marker (grants nobody) and ranks below every positive
 * level; it is skipped entirely when building `defAccess` (see below).
 */
export const PERMISSION_RANK: Record<ResourcePermission, number> = {
  none: 0,
  view: 1,
  edit: 2,
  admin: 3,
}

/**
 * Pure, leveled composition of a member's capabilities (§5) from sparse,
 * per-tier level maps. IO (reading + parsing the jsonb rows into these tiers)
 * lives in {@link computeUserCapabilities}; this is the tested core.
 *
 * Per area `a` (every tier is a SPARSE map — an absent area falls through):
 * ```
 *   base   = role ∈ {OWNER, ADMIN} ? Full
 *          : orgPolicy[a] ?? ROLE_DEFAULTS.USER[a]        // L4: per-area policy override
 *   raised = max(base, maxOverGroups(group[a]), user[a]) // L3: Camp-1, raise-only
 *   level  = min(raised, SEAT_CEILINGS[seatType][a])     // L5: seat clamp LAST
 * ```
 * Org policy replaces the USER default ONLY for the areas it explicitly sets;
 * an area absent from the policy stays at the code default (not None). Areas
 * expand to their key set (union) = the resolved PermissionKey[]. An undefined
 * role (non-member) fails closed to an empty set.
 */
export function composeUserCapabilities(input: {
  /** From the cached memberRoleMap; undefined when not a member (→ no access). */
  role: OrganizationRole | undefined
  seatType: SeatType
  /** Sparse levels on the `role:org_member` policy grant (per-area override, L4). */
  orgPolicyLevels?: Partial<Record<Area, Level>>
  /** Sparse levels on each of the member's group grants (raise-only, L3). */
  groupLevels?: Array<Partial<Record<Area, Level>>>
  /** Sparse levels on the member's direct user grant (raise-only, L3). */
  userLevels?: Partial<Record<Area, Level>>
  typeAccessRows: Array<{ entityDefinitionId: string; permission: ResourcePermission }>
  /** Instance-level rows (entityInstanceId IS NOT NULL) for the instance-access resources. */
  instanceAccessRows?: Array<{ entityInstanceId: string; permission: ResourcePermission }>
}): UserCapabilities {
  const {
    role,
    seatType,
    orgPolicyLevels,
    groupLevels,
    userLevels,
    typeAccessRows,
    instanceAccessRows = [],
  } = input

  // instanceAccess: highest permission wins per instance. `'none'` is KEPT here
  // (unlike defAccess) — it is the per-instance downward marker; a real grant
  // outranks it via PERMISSION_RANK.
  const instanceAccess: Record<string, ResourcePermission> = {}
  for (const row of instanceAccessRows) {
    const existing = instanceAccess[row.entityInstanceId]
    if (!existing || PERMISSION_RANK[row.permission] > PERMISSION_RANK[existing]) {
      instanceAccess[row.entityInstanceId] = row.permission
    }
  }

  // defAccess: highest permission wins per definition. Computed regardless of
  // role so admins carry it too (they simply also hold every capability key).
  const defAccess: Record<string, ResourcePermission> = {}
  for (const row of typeAccessRows) {
    // `none` is the baseline lockdown marker: it flags the def restricted (via
    // `restrictedEntityDefIds`) but grants nobody, so it must NOT seed a
    // `defAccess` entry — otherwise the `role:org_member @ none` row would make
    // every member a grantee, defeating the lockdown.
    if (row.permission === 'none') continue
    const existing = defAccess[row.entityDefinitionId]
    if (!existing || PERMISSION_RANK[row.permission] > PERMISSION_RANK[existing]) {
      defAccess[row.entityDefinitionId] = row.permission
    }
  }

  // Fail closed: a non-member holds no capabilities.
  if (!role) return { keys: [], defAccess, instanceAccess }

  const isAdmin = role === 'OWNER' || role === 'ADMIN'
  const ceiling = SEAT_CEILINGS[seatType]
  const userDefault = ROLE_DEFAULTS.USER

  const resolved = buildAreaLevels((area) => {
    // L4: OWNER/ADMIN are always Full; for everyone else org policy overrides the
    // USER default PER AREA — an area the policy doesn't set falls through to the
    // code default (the only downward lever, applied only where explicitly set).
    const base = isAdmin ? Level.Full : (orgPolicyLevels?.[area] ?? userDefault[area])

    // L3: Camp-1, raise-only. Groups + direct user grant can only lift `base`.
    let raised = base
    if (groupLevels) {
      for (const group of groupLevels) raised = Math.max(raised, group[area] ?? Level.None)
    }
    if (userLevels) raised = Math.max(raised, userLevels[area] ?? Level.None)

    // L5: the seat ceiling dominates everything, applied last.
    return Math.min(raised, ceiling[area]) as Level
  })

  return { keys: expandLevelsToKeys(resolved), defAccess, instanceAccess }
}
