// packages/lib/src/permissions/capabilities/compose-user-capabilities.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType, UserType } from '@auxx/database/types'
import type { ProfileCeiling } from '../profiles/types'
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
 * Pure, leveled composition of a member's capabilities from sparse, per-tier
 * level maps plus the ONE bound permission profile. IO (reading + parsing the
 * jsonb rows and resolving the profile) lives in {@link computeUserCapabilities};
 * this is the tested core.
 *
 * Per area `a` (every tier is a SPARSE map — an absent area falls through):
 * ```
 *   if (role === 'OWNER') return ALL_FULL clamped only by SEAT_CEILINGS  // §0.10
 *
 *   base    = profileLevels[a] ?? profileBaseLevel ?? ROLE_DEFAULTS[role][a]
 *   raised  = max(base, maxOverGroups(group[a]), user[a])   // Camp-1, raise-only
 *   capped  = min(raised, profileCeiling.areas[a] ?? Full)  // the same profile's cap
 *   level   = min(capped, SEAT_CEILINGS[seatType][a])       // billing invariant, LAST
 * ```
 *
 * **The bound profile IS the baseline** (doc 19 §0.8) — the old
 * `role:org_member` org-policy tier is gone, and with it the two-mechanisms
 * -for-one-job problem. Its downward power moved onto the profile: a `Level.None`
 * stored on a profile grant row genuinely zeroes the area for every holder, which
 * is why `grant-service` keeps (never strips) `None` for profile grantees.
 *
 * `profileBaseLevel` is the profile's fallback rung for areas it does not set
 * (`Full` on owner/admin). Leaving it `null` on the member/field-tech profiles is
 * what keeps a **newly added area automatically admin-accessible on deploy**:
 * unset areas fall through to `ROLE_DEFAULTS[role]`, so nothing needs a backfill
 * into every org's every profile (§0.6/§0.7).
 *
 * **OWNER is never clamped by a ceiling** (§0.10) — the short-circuit runs BEFORE
 * the ceiling. Last-owner protection guarantees ≥1 owner exists, so a mis-shaped
 * profile is always fixable. ADMIN goes through the normal path but lands all-Full
 * anyway (`ROLE_DEFAULTS.ADMIN` is all-Full and the seeded `admin` profile carries
 * `baseLevel: Full` with no ceiling); narrowing ADMIN's structural bypasses is
 * deliberately staged as doc 19 step 10.
 *
 * **Rollout window (doc 19 §9 step 2):** when the org has no `PermissionProfile`
 * rows yet — i.e. before data migration 041 runs — `profileBaseLevel` and
 * `profileLevels` arrive empty and `base` falls through to `ROLE_DEFAULTS[role]`.
 * An org that never customized its old baseline is unaffected; one that DID
 * customize composes from the code defaults until 041 copies its levels onto the
 * `member` profile. That is the documented, accepted window (no dual-read shim),
 * not a bug.
 *
 * Areas expand to their key set (union) = the resolved PermissionKey[]. An
 * undefined role (non-member) fails closed to an empty set.
 *
 * **AGENT grantees compose to NOTHING here** — their authority is the published
 * `AgentVersion.permissionPolicy` snapshot, not any grant row. See the long note
 * below this function for why, and `AgentPolicyCapabilities` for the enforcement.
 */
export function composeUserCapabilities(input: {
  /** From the cached memberRoleMap; undefined when not a member (→ no access). */
  role: OrganizationRole | undefined
  seatType: SeatType
  /**
   * Principal kind from the cached memberRoleMap. `'AGENT'` composes to an EMPTY
   * capability set (the published version policy is the sole authority — see the
   * note below this function); everything else composes with the human raise-only
   * model. Defaults to `'USER'`.
   */
  userType?: UserType
  /**
   * Sparse levels on the bound profile's `PermissionGrant` row
   * (`granteeType:'profile'`) — the per-area BASE. A stored `None` is
   * load-bearing here (it lowers), unlike on the group/user tiers.
   */
  profileLevels?: Partial<Record<Area, Level>>
  /**
   * The bound profile's fallback rung for areas `profileLevels` does not set.
   * `null`/absent ⇒ fall through to `ROLE_DEFAULTS[role]`.
   */
  profileBaseLevel?: Level | null
  /**
   * The bound profile's own intrinsic cap (§0.14) — applied after group/personal
   * raising, before the seat ceiling. `ceiling.defs` is carried but NOT enforced
   * here; definition-ceiling enforcement is doc 19 step 4.
   */
  profileCeiling?: ProfileCeiling | null
  /** Sparse levels on each of the member's group grants (raise-only). */
  groupLevels?: Array<Partial<Record<Area, Level>>>
  /** Sparse levels on the member's direct user grant (raise-only). */
  userLevels?: Partial<Record<Area, Level>>
  typeAccessRows: Array<{ entityDefinitionId: string; permission: ResourcePermission }>
  /** Instance-level rows (entityInstanceId IS NOT NULL) for the instance-access resources. */
  instanceAccessRows?: Array<{ entityInstanceId: string; permission: ResourcePermission }>
}): UserCapabilities {
  const {
    role,
    seatType,
    userType = 'USER',
    profileLevels,
    profileBaseLevel,
    profileCeiling,
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

  // AGENT principals hold NO composed capability (doc 19 §0.16/§2.3). Their
  // authority lives exclusively in `AgentVersion.permissionPolicy`, resolved by
  // `AgentPolicyCapabilities` — see the note above this function.
  if (userType === 'AGENT') {
    return { keys: [], defAccess: {}, instanceAccess: {} }
  }

  const ceiling = SEAT_CEILINGS[seatType]

  // §0.10 — the RECOVERY GUARANTEE. OWNER short-circuits to Full BEFORE any
  // profile ceiling is consulted, clamped only by the seat ceiling (a billing
  // invariant). Last-owner protection guarantees ≥1 owner exists, so a
  // mis-shaped profile is always fixable from inside the product.
  if (role === 'OWNER') {
    return {
      keys: expandLevelsToKeys(buildAreaLevels((area) => ceiling[area])),
      defAccess,
      instanceAccess,
    }
  }

  const roleDefault = ROLE_DEFAULTS[role]
  const areaCeiling = profileCeiling?.areas

  const resolved = buildAreaLevels((area) => {
    // Base: the bound profile's explicit level, else its blanket `baseLevel`,
    // else the shipped role default. Sparse by design — an area the profile never
    // touches keeps its code default, so a NEW area ships enabled instead of
    // silently reading as None.
    const base = profileLevels?.[area] ?? profileBaseLevel ?? roleDefault[area]

    // Camp-1, raise-only. Groups + direct user grant can only lift `base`.
    let raised = base
    if (groupLevels) {
      for (const group of groupLevels) raised = Math.max(raised, group[area] ?? Level.None)
    }
    if (userLevels) raised = Math.max(raised, userLevels[area] ?? Level.None)

    // The bound profile's OWN intrinsic cap — this is what makes "base says where
    // you start, ceiling says what nothing can exceed" true against a group raise.
    const capped = Math.min(raised, areaCeiling?.[area] ?? Level.Full)

    // The seat ceiling dominates everything, applied LAST. Never profile-driven.
    return Math.min(capped, ceiling[area]) as Level
  })

  return { keys: expandLevelsToKeys(resolved), defAccess, instanceAccess }
}

/**
 * Why the `userType: 'AGENT'` branch above returns an EMPTY capability set
 * (doc 19 §2.3, replacing doc 14 §0.2's shipped `composeAgentLevels`).
 *
 * The old branch composed `level[area] = userLevels[a] ?? Level.Full` — SET
 * semantics over an all-Full base — and let per-def/per-instance `ResourceAccess`
 * rows on the agent's synthetic `User` compose exactly as they do for humans. Two
 * things made that model unfixable rather than merely permissive:
 *
 * 1. **It could not remove definition authority.** `defAccess` skips
 *    `permission === 'none'` (see above — a grantee-level `none` grants nobody, by
 *    design), and the reduce is max-wins, so "restrict THIS agent from Deals" was
 *    inexpressible without restricting Deals workspace-wide for every human.
 * 2. **It had no publication semantics.** Editing a grant row changed a live
 *    agent instantly, so an agent never provably ran the rules it was reviewed
 *    with.
 *
 * Both are now answered by an immutable, total, exact policy snapshotted on
 * `AgentVersion.permissionPolicy` and enforced by `AgentPolicyCapabilities`.
 * That policy has SET semantics with a **load-bearing `none`**, which is precisely
 * why it must never enter the additive reducers in this file — they would drop it.
 *
 * Returning `{ keys: [], defAccess: {}, instanceAccess: {} }` rather than the
 * composed rows is deliberate and is the load-bearing half of §0.16's *"the
 * synthetic `OrganizationMember` carries membership/role/seat only — it is not a
 * second authority"*. If `defAccess` were still returned here, a leftover
 * `ResourceAccess` row on the agent's userId would keep granting that def (an
 * explicit per-def grant REPLACES the base records verb), so republishing a
 * definition as `None` would not actually remove it. The synthetic member row
 * itself remains — it is what makes the agent an org member for authorship,
 * mentions, and realtime attribution — it simply carries no capability.
 *
 * Anything that needs an agent's authority must resolve the version snapshot via
 * `resolveAgentRunCapabilities`, never `getCapabilities(agent.userId, orgId)`.
 */
