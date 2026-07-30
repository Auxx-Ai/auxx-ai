// packages/lib/src/permissions/capabilities/compose-user-capabilities.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType, UserType } from '@auxx/database/types'
import type { ProfileCeiling } from '../profiles/types'
import {
  INSTANCE_ACCESS_READ_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  isInstanceAccessKey,
} from './instance-access'
import {
  type Area,
  buildAreaLevels,
  expandLevelsToKeys,
  Level,
  type PermissionKey,
} from './registry'
import { ALL_KEYS, ROLE_DEFAULTS, SEAT_CEILINGS } from './seat-policy'

/**
 * A user's composed Layer-2 capability set for one org.
 *  - `keys`: the coarse capability verbs the member holds (already seat-clamped).
 *  - `defAccess`: highest type-level ResourceAccess permission per entity
 *    definition (Layer-3 data scoping folded into the same blob, §9.0). Defs
 *    without any type-level grant are ABSENT = unrestricted (today's behavior).
 */
export interface UserCapabilities {
  keys: PermissionKey[]
  /**
   * Coarse capability keys SYNTHESIZED from the member's instance grants — the
   * `Level.Read` rung of an instance-access area the member holds ≥1 `view`-or-
   * better instance grant on (handoff item 5b). Kept in a SEPARATE field from
   * {@link keys} on purpose, and the separation is load-bearing:
   *
   * `keys` is the ONLY input {@link import('./registry').areaLevelFromKeys} has
   * for recovering a member's AREA level, and that recovered level is what
   * `effectiveInstanceLevel` / `instanceListScope` use as the absent-row
   * fallback for the `baselineAtCreate: false` resources. Folding a derived
   * `workflows.view` into `keys` would make `areaLevelFromKeys` report
   * `Level.Read` for the area, and every row-LESS workflow in the org would fall
   * back to `view` — turning "shared one workflow" into "can see all of them".
   *
   * So: `keys` answers *"what is my area level"*, `keys ∪ instanceDerivedKeys`
   * answers *"may I reach this feature's front door"*. `CapabilitySet.can` /
   * `has` / `assert` and the client `can()` read the union; `areaLevel()`,
   * `resolved()` and every area-level computation read `keys` alone.
   */
  instanceDerivedKeys: PermissionKey[]
  defAccess: Record<string, ResourcePermission>
  /**
   * Highest instance-level ResourceAccess permission per `entityInstanceId`
   * (CUID) for the instance-access resources (datasets etc., §1.2), from
   * **INDIVIDUAL** grantee rows only — `user`, `group` and `profile`. Keys are
   * globally-unique instance ids, so no `resourceKey` disambiguation is needed.
   * Unlike `defAccess`, explicit `'none'` rows are KEPT — they are the per-
   * instance downward marker (a real grant outranks them via {@link PERMISSION_RANK}).
   *
   * **A grant addressed to THIS member. Never gated by the area level** (plan 43
   * §0.2a decision C, preserving #1346 / plan 25 §2). It is also what keeps a
   * creator's own `user @ admin` row reachable at any area level, so nobody can
   * lose content they made by having their profile closed.
   */
  instanceAccess: Record<string, ResourcePermission>
  /**
   * The same map for `role` grantee rows (`role:org_member`) — the ORG-WIDE
   * WORKSPACE DEFAULT, split out of {@link instanceAccess} by plan 43 §4.1.
   *
   * Max-wins within itself, and `'none'` is KEPT here too: a `role:org_member @
   * none` row is the workspace restriction marker, the same way an individual
   * `user @ none` is a personal one.
   *
   * **This lane is GATED by the member's area level** (plan 43 §0.2a). The one
   * sentence the whole design rests on: *the area level gates the baseline path;
   * an individual grant always overrules it.* A member at `Dashboards: None`
   * therefore does not receive the 89 auto-written `role:org_member @ view` rows
   * — which is the lever admins asked for — while still keeping any dashboard
   * shared with them by name. See
   * {@link import('./entity-access').effectiveInstanceLevel} for the resolver.
   *
   * Optional at the type level ONLY on the read side (`caps.baselineInstanceAccess
   * ?.[id]`), because a cache blob written before this field existed lacks it.
   * That staleness FAILS OPEN — see the `user:capabilities:v16` ledger entry in
   * `cache/user-cache-keys.ts` for why the bump is mandatory, not hygienic.
   */
  baselineInstanceAccess: Record<string, ResourcePermission>
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
 * The grantee kinds whose `ResourceAccess` rows are a grant addressed to THIS
 * member, rather than the org-wide default (plan 43 §0.2a). Only these bypass
 * the area gate in `effectiveInstanceLevel`.
 *
 * **An ALLOWLIST, not `!== 'role'`, and that is the whole point.** Two readers
 * sort these rows — the lane split in {@link composeUserCapabilities} and the
 * `instanceDerivedKeys` filter (§4.4) — and both must agree about a grantee kind
 * neither was written for. A denylist sorts an unrecognized kind into the
 * INDIVIDUAL lane, which is the UNGATED one, so adding a grantee kind to the
 * storage vocabulary would silently wave it past the area level. With an
 * allowlist the unknown kind is gated instead: it still resolves through the
 * baseline path, which is the failure direction we can live with.
 *
 * This is the same hazard `governingInstanceIdsProvider` records — *"Adding a
 * grantee kind to the storage vocabulary still means adding it to every reader
 * in the same change."* Adding one here means adding it to this constant.
 */
const INDIVIDUAL_GRANTEE_TYPES: ReadonlySet<string> = new Set(['user', 'group', 'profile'])

/** Whether a `ResourceAccess` row is an individual grant — see {@link INDIVIDUAL_GRANTEE_TYPES}. */
function isIndividualGranteeType(granteeType: string): boolean {
  return INDIVIDUAL_GRANTEE_TYPES.has(granteeType)
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
 * (`Full` on owner/admin, `null` on member/field-tech). Plan 22 (member
 * baseline strip) changes what leaving it `null` on member/field-tech means: a
 * newly added area now ships **closed** for members by default — unset areas
 * fall through to `ROLE_DEFAULTS.USER`, the all-`None` floor, not the old
 * generous map — and needs an explicit `MEMBER_BASELINE_LEVELS`/
 * `FIELD_TECH_BASELINE_LEVELS` entry (`seat-policy.ts`) plus a backfill to
 * become member-visible. `ROLE_DEFAULTS.ADMIN`/`.OWNER` are still `ALL_FULL`,
 * so the same `null` on the owner/admin profiles keeps behaving as before —
 * the recovery guarantee (plan 21 §2.a.7) is unaffected.
 *
 * **OWNER is never clamped by a ceiling** (§0.10) — the short-circuit runs BEFORE
 * the ceiling. Last-owner protection guarantees ≥1 owner exists, so a mis-shaped
 * profile is always fixable.
 *
 * **ADMIN goes through the normal path and is a real profile** (doc 19 §0.11,
 * step 10). On the seeded `admin` profile (`baseLevel: Full`, no ceiling) it
 * lands all-Full, byte-identical to the short-circuit that used to produce that
 * — pinned by `admin-profile-parity.test.ts`. What changed is that a `None` (or a
 * ceiling) authored on that profile now actually lowers an admin, because
 * `computeUserCapabilities` no longer skips their `PermissionGrant` rows.
 *
 * **Rollout window (doc 19 §9 step 2):** when the org has no `PermissionProfile`
 * rows yet — i.e. before `ensureSystemProfiles`/data migration 041 runs —
 * `profileBaseLevel` and `profileLevels` arrive empty and `base` falls through
 * to `ROLE_DEFAULTS[role]`. Post plan-22 that fallback is `None` for a member
 * (the profiles substrate — including the seeded Member baseline grant row —
 * must ship in the same deployment as the strip, per plan 22's "Deployment
 * reality" note, precisely so this window fails closed rather than dropping a
 * customized baseline). ADMIN/OWNER are unaffected either way (`ALL_FULL`).
 * That is the documented, accepted window (no dual-read shim), not a bug.
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
   * The bound profile's own intrinsic per-area cap — applied after group/personal
   * raising, before the seat ceiling (§2.1).
   *
   * **Deliberately UNAUTHORED** (plan 20 §2.a.3): no UI, router, or seed writes
   * `ceiling`, so this is `null` for every real member today. It is kept as the
   * one-line seam a future per-def deny tier (doc 19 §11.4) will hang off, with
   * plan 20 §7.1's expiry attached — if that successor is not built within two
   * releases, delete this input, the clamp below, and the `ceiling` column.
   */
  profileCeiling?: ProfileCeiling | null
  /** Sparse levels on each of the member's group grants (raise-only). */
  groupLevels?: Array<Partial<Record<Area, Level>>>
  /** Sparse levels on the member's direct user grant (raise-only). */
  userLevels?: Partial<Record<Area, Level>>
  typeAccessRows: Array<{ entityDefinitionId: string; permission: ResourcePermission }>
  /**
   * Instance-level rows (entityInstanceId IS NOT NULL) for the instance-access
   * resources. `entityDefinitionId` is the resource KEY (`dataset` | `kb` |
   * `dashboard` | `workflow`) and is REQUIRED — it is what makes
   * {@link UserCapabilities.instanceDerivedKeys} type-aware, so a dashboard
   * grant cannot open the workflows front door.
   *
   * `granteeType` is REQUIRED for the same class of reason (plan 43 §4.1): it is
   * what sorts a row into the INDIVIDUAL lane ({@link UserCapabilities.instanceAccess})
   * or the BASELINE lane ({@link UserCapabilities.baselineInstanceAccess}), and
   * only the second is gated by the area level. Left optional with a default,
   * either default would be silently wrong for half the callers — a `'user'`
   * default fails OPEN (every `role:org_member` row becomes an ungated individual
   * grant), a `'role'` default fails closed but strips real shares. Making it
   * required turns that into a compile error at every construction site.
   */
  instanceAccessRows?: Array<{
    entityDefinitionId: string
    entityInstanceId: string
    permission: ResourcePermission
    granteeType: string
  }>
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

  // TWO lanes, split by grantee kind (plan 43 §4.1). Highest permission wins
  // WITHIN each lane; `'none'` is KEPT in both (unlike defAccess) — it is the
  // per-instance downward marker, personal in one lane and workspace-wide in the
  // other, and a real grant outranks it via PERMISSION_RANK.
  //
  // The lanes are never merged here, and that is the whole point: only the
  // baseline lane is gated by the area level (§0.2a). Merging them would restore
  // exactly the fail-open state a stale v15 blob has.
  const instanceAccess: Record<string, ResourcePermission> = {}
  const baselineInstanceAccess: Record<string, ResourcePermission> = {}
  for (const row of instanceAccessRows) {
    // `role` (i.e. `role:org_member`) is the workspace default; `user` / `group`
    // / `profile` are grants addressed to this member.
    const lane = isIndividualGranteeType(row.granteeType) ? instanceAccess : baselineInstanceAccess
    const existing = lane[row.entityInstanceId]
    if (!existing || PERMISSION_RANK[row.permission] > PERMISSION_RANK[existing]) {
      lane[row.entityInstanceId] = row.permission
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
  if (!role)
    return { keys: [], instanceDerivedKeys: [], defAccess, instanceAccess, baselineInstanceAccess }

  // AGENT principals hold NO composed capability (doc 19 §0.16/§2.3). Their
  // authority lives exclusively in `AgentVersion.permissionPolicy`, resolved by
  // `AgentPolicyCapabilities` — see the note above this function.
  if (userType === 'AGENT') {
    return {
      keys: [],
      instanceDerivedKeys: [],
      defAccess: {},
      instanceAccess: {},
      baselineInstanceAccess: {},
    }
  }

  const ceiling = SEAT_CEILINGS[seatType]

  // §0.10 — the RECOVERY GUARANTEE. OWNER short-circuits to Full BEFORE any
  // profile ceiling is consulted, clamped only by the seat ceiling (a billing
  // invariant). Last-owner protection guarantees ≥1 owner exists, so a
  // mis-shaped profile is always fixable from inside the product.
  //
  // No derived keys: an owner already holds every rung the seat ceiling allows,
  // so synthesizing a Read rung could only ever be a no-op — or, worse, hand
  // back an area the ceiling deliberately closed.
  if (role === 'OWNER') {
    return {
      keys: expandLevelsToKeys(buildAreaLevels((area) => ceiling[area])),
      instanceDerivedKeys: [],
      defAccess,
      instanceAccess,
      baselineInstanceAccess,
    }
  }

  const roleDefault = ROLE_DEFAULTS[role]
  const areaCeiling = profileCeiling?.areas

  const resolved = buildAreaLevels((area) => {
    // Base: the bound profile's explicit level, else its blanket `baseLevel`,
    // else the shipped role default. Plan 22 flips the USER fall-through: an
    // area the profile never touches now falls through to `ROLE_DEFAULTS.USER`,
    // the all-`None` floor — a NEW area ships CLOSED for members by default,
    // not silently enabled. (ADMIN/OWNER still fall through to `ALL_FULL`, the
    // recovery guarantee, plan 21 §2.a.7 — unaffected by this plan.)
    const base = profileLevels?.[area] ?? profileBaseLevel ?? roleDefault[area]

    // Camp-1, raise-only. Groups + direct user grant can only lift `base`.
    let raised = base
    if (groupLevels) {
      for (const group of groupLevels) raised = Math.max(raised, group[area] ?? Level.None)
    }
    if (userLevels) raised = Math.max(raised, userLevels[area] ?? Level.None)

    // The bound profile's OWN intrinsic cap — this is what makes "base says where
    // you start, ceiling says what nothing can exceed" true against a group raise.
    //
    // UNAUTHORED, on purpose (plan 20 §2.a.3): nothing writes `ceiling`, so
    // `areaCeiling` is always `undefined` in production and this `min` is an
    // identity today. It survives as the seam doc 19 §11.4's per-def deny/lock
    // tier will use — see `profileCeiling` above for plan 20 §7.1's expiry.
    const capped = Math.min(raised, areaCeiling?.[area] ?? Level.Full)

    // The seat ceiling dominates everything, applied LAST. Never profile-driven.
    return Math.min(capped, ceiling[area]) as Level
  })

  return {
    keys: expandLevelsToKeys(resolved),
    // INDIVIDUAL rows only (plan 43 §4.4) — see `deriveInstanceReadKeys`. Uses
    // the SAME predicate as the lane split above, deliberately: two readers of
    // one rule that disagree about an unknown grantee kind is the defect this
    // helper exists to prevent.
    instanceDerivedKeys: deriveInstanceReadKeys(
      instanceAccessRows.filter((row) => isIndividualGranteeType(row.granteeType)),
      ceiling
    ),
    defAccess,
    instanceAccess,
    baselineInstanceAccess,
  }
}

/**
 * Synthesize the `Level.Read` rung of every instance-access area the member
 * holds ≥1 `view`-or-better **individual** instance grant on — see
 * {@link UserCapabilities.instanceDerivedKeys} for why the result is kept out of
 * `keys`.
 *
 * Four properties, each deliberate:
 *
 * - **INDIVIDUAL rows only** (plan 43 §4.4). The caller filters `granteeType ===
 *   'role'` out before calling; passing baseline rows in would defeat the §0.2a
 *   lever outright, because every dashboard writes a `role:org_member @ view`
 *   row at create — so every member would derive `dashboards.view` and the front
 *   door would stand open for exactly the profile an admin just set to `None`.
 *   It also finally fixes the problem the "Per-resource, not a flat union" note
 *   in `INSTANCE_ACCESS_READ_KEYS` describes: *"holds SOME instance grant" was
 *   effectively always true*. Keying by resource narrowed it; dropping the
 *   baseline lane makes it mean what it says.
 * - **Read rung only, regardless of grant strength.** An `admin` grant on one
 *   workflow yields `workflows.view`, never `workflows.manage` — that rung
 *   fronts `create`, which has no instance to assert on.
 * - **Type-aware.** The row's `entityDefinitionId` names the resource, so a
 *   dashboard grant opens `dashboards.view` and nothing else.
 * - **The seat ceiling still dominates**, matching `effectiveInstanceLevel`,
 *   which checks the same clamp before it reads any row. Without this a worker
 *   seat holding one grant would be handed a front-door key to an area its
 *   billing packaging excludes — and the enforcement path would then deny it
 *   anyway, which is a 403 maze rather than a hidden nav entry.
 *
 * Rows whose `entityDefinitionId` is not a registered instance-access key are
 * skipped (fail closed); `'none'` rows never reach `view` and so never derive.
 * Ordered by {@link ALL_KEYS} so the cached blob is byte-stable across recomputes
 * regardless of row order.
 */
function deriveInstanceReadKeys(
  rows: Array<{ entityDefinitionId: string; permission: ResourcePermission }>,
  ceiling: Record<Area, Level>
): PermissionKey[] {
  const held = new Set<PermissionKey>()
  for (const row of rows) {
    if (PERMISSION_RANK[row.permission] < PERMISSION_RANK.view) continue
    if (!isInstanceAccessKey(row.entityDefinitionId)) continue
    if (ceiling[INSTANCE_ACCESS_RESOURCES[row.entityDefinitionId].area] === Level.None) continue
    for (const key of INSTANCE_ACCESS_READ_KEYS[row.entityDefinitionId]) held.add(key)
  }
  return held.size === 0 ? [] : ALL_KEYS.filter((key) => held.has(key))
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
