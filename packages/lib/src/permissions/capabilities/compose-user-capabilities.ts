// packages/lib/src/permissions/capabilities/compose-user-capabilities.ts

import type { ResourcePermission, Rung } from '@auxx/database/enums'
import type { OrganizationRole, SeatType, UserType } from '@auxx/database/types'
import { PERMISSION_RANK } from '@auxx/types/permissions'
import type { BucketedInstanceGrants, DefKeyedRungs } from '../../resource-access/instance-grants'
import { isMailSharingDef } from '../../resource-access/mail-sharing-defs'
import type { ProfileCeiling } from '../profiles/types'
import {
  INSTANCE_ACCESS_READ_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  isDeclaredInstanceDomain,
  isInstanceAccessKey,
} from './instance-access'
import {
  type Area,
  buildAreaLevels,
  expandLevelsToKeys,
  Level,
  type PermissionKey,
} from './registry'
import { RUNG_ORDER, rungToPermission, satisfiesRung } from './rung'
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
   * Highest instance-level {@link Rung} per `entityInstanceId` (CUID) for the
   * instance-access resources (datasets etc., §1.2), from **INDIVIDUAL** grantee
   * rows only — `user`, `group` and `profile`. Keys are globally-unique instance
   * ids, so no `resourceKey` disambiguation is needed. Unlike `defAccess`,
   * explicit `'none'` rows are KEPT — they are the per-instance downward marker
   * (a real grant outranks them via {@link RUNG_ORDER}).
   *
   * **`Rung`, not `ResourcePermission`, since plan v3/03 P3b.** These values are
   * the stored `ResourceAccess.rung` verbatim; the def axis (`defAccess` below)
   * is the one that keeps the older vocabulary. A blob written before the switch
   * carries `'view'` here, which is not a key in `RUNG_ORDER` — see the
   * `user:capabilities:v17` ledger entry for why that makes the bump mandatory.
   *
   * **A grant addressed to THIS member. Never gated by the area level** (plan 43
   * §0.2a decision C, preserving #1346 / plan 25 §2). It is also what keeps a
   * creator's own `user @ admin` row reachable at any area level, so nobody can
   * lose content they made by having their profile closed.
   */
  instanceAccess: Record<string, Rung>
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
  baselineInstanceAccess: Record<string, Rung>
  /**
   * **The record-lane front door** (plan v3/03 §4.2 / §6.1): record defs the
   * member holds ≥1 instance grant on at `rung >= read`.
   *
   * Bounded by DEF count, not grant count — that bound is why this is the only
   * record-lane artifact allowed in the blob. No record-grant INSTANCE id set is
   * ever cached or shipped; per-row access is evaluated in SQL by
   * `recordVisibilityScope`, because it is row-local (§4's locality rule).
   *
   * Consumed by `hasDefPresence`, which is a SECOND predicate and never a wider
   * `canViewEntity` — `canViewEntity` keeps meaning "may see ALL rows" and keeps
   * guarding realtime def-channel ACLs, def admin and field config. This gates
   * only nav entry, the route gate, def metadata and column metadata.
   *
   * See {@link computeGrantedDefIds} for why a record def is defined by two
   * exclusions rather than one.
   */
  grantedDefIds: Record<string, true>
}

/**
 * Hierarchy rank for picking the highest ResourceAccess permission. `none` is
 * the baseline lockdown marker (grants nobody) and ranks below every positive
 * level; it is skipped entirely when building `defAccess` (see below).
 *
 * Re-exported, not defined: the table lives in `@auxx/types/permissions` so the
 * group helpers, the resource-access service and the client gate hooks share
 * one copy (plan v3/03 P3a §3). Kept on this module's surface because ~11 files
 * already import it from here.
 */
export { PERMISSION_RANK }

/**
 * Flatten ONE lane of the bucketed grants onto `instanceId → rung`, restricted
 * to the BLOB-LANE resource keys.
 *
 * **This is where "records never enter the capability blob" is enforced** (plan
 * v3/03 §4). Before P4 the filter was a `WHERE entityDefinitionId IN (…)` in the
 * capability composer's own query; with one shared query it moves here, into
 * code, beside the invariant it protects and where a test can reach it.
 * `isInstanceAccessKey` is the blob-lane predicate, so `thread` and `sequence`
 * are excluded for the same reason record CUIDs are.
 *
 * The def is dropped in the result because `entityInstanceId` is globally unique
 * and every downstream reader keys on it alone; the def survives where it is
 * needed, in {@link deriveInstanceReadKeys}.
 */
function flattenBlobLane(lane: DefKeyedRungs): Record<string, Rung> {
  const out: Record<string, Rung> = {}
  for (const [defId, byInstance] of Object.entries(lane)) {
    if (!isInstanceAccessKey(defId)) continue
    for (const [instanceId, rung] of Object.entries(byInstance)) {
      const existing = out[instanceId]
      if (!existing || RUNG_ORDER[rung] > RUNG_ORDER[existing]) out[instanceId] = rung
    }
  }
  return out
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
  typeAccessRows: Array<{ entityDefinitionId: string; rung: Rung }>
  /**
   * The member's instance-level grants, already bucketed by
   * `bucketInstanceGrantRows` — **the same value
   * {@link import('../visibility/compute-user-instance-grants').composeUserInstanceGrants}
   * composes from** (plan v3/03 §12, P4).
   *
   * It replaced a raw `instanceAccessRows` array, and the change is not cosmetic:
   * the array carried `granteeType` per row precisely so THIS composer could sort
   * it into the two lanes, while the mail composer did the same sort with its own
   * loop and its own conventions. One bucketing pass makes the lane split a
   * property of the value rather than of whichever reader happens to walk it.
   */
  instanceGrants?: BucketedInstanceGrants
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
    instanceGrants = { individual: {}, baseline: {}, governing: {} },
  } = input

  // TWO lanes, split by grantee kind upstream (plan 43 §4.1). Highest RUNG wins
  // WITHIN each lane; `'none'` is KEPT in both (unlike defAccess) — it is the
  // per-instance downward marker, personal in one lane and workspace-wide in the
  // other, and a real grant outranks it via RUNG_ORDER.
  //
  // The lanes are never merged here, and that is the whole point: only the
  // baseline lane is gated by the area level (§0.2a). Merging them would restore
  // exactly the fail-open state a stale v15 blob has.
  const instanceAccess = flattenBlobLane(instanceGrants.individual)
  const baselineInstanceAccess = flattenBlobLane(instanceGrants.baseline)

  // defAccess: highest permission wins per definition. Computed regardless of
  // role so admins carry it too (they simply also hold every capability key).
  //
  // **The ONE type-row crossing** from the storage vocabulary to the DEF axis
  // (see `rungToPermission`). `metadata`/`identity` have no def-axis tier and
  // convert to `undefined`, which is skipped here — a record def declares
  // `RECORD_DEF_RUNGS`, so such a type row is a data bug, and skipping keeps it
  // inert rather than rounding it up into a `view` grant.
  const defAccess: Record<string, ResourcePermission> = {}
  for (const row of typeAccessRows) {
    // `none` is the baseline lockdown marker: it flags the def restricted (via
    // `restrictedEntityDefIds`) but grants nobody, so it must NOT seed a
    // `defAccess` entry — otherwise the `role:org_member @ none` row would make
    // every member a grantee, defeating the lockdown.
    const permission = rungToPermission(row.rung)
    if (permission === undefined || permission === 'none') continue
    const existing = defAccess[row.entityDefinitionId]
    if (!existing || PERMISSION_RANK[permission] > PERMISSION_RANK[existing]) {
      defAccess[row.entityDefinitionId] = permission
    }
  }

  // Fail closed: a non-member holds no capabilities — and no front door either.
  // A grant row can outlive the membership that motivated it, so this must be an
  // empty map rather than the computed one.
  if (!role)
    return {
      keys: [],
      instanceDerivedKeys: [],
      defAccess,
      instanceAccess,
      baselineInstanceAccess,
      grantedDefIds: {},
    }

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
      // Empty like everything else here: an agent's authority is its published
      // version policy alone, so a stray share written onto its synthetic user
      // must not open a door the policy never granted.
      grantedDefIds: {},
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
      // The REAL map, unlike `instanceDerivedKeys` above. That one is empty
      // because synthesizing a Read rung for an owner is either a no-op or hands
      // back an area the ceiling closed; this one is not synthesized — it
      // reports grants the owner actually holds. It matters exactly when the
      // SEAT ceiling closes `Area.records` (a worker-seat owner), where
      // `canViewEntity` is false and the front door is the only way in. The
      // ceiling still binds the row rung downstream in `recordAccessAt`.
      grantedDefIds: computeGrantedDefIds(instanceGrants),
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
    // INDIVIDUAL lane only (plan 43 §4.4) — see `deriveInstanceReadKeys`. The
    // lane split now happens ONCE, upstream in `bucketInstanceGrantRows`, so the
    // two readers of that rule cannot disagree about an unknown grantee kind:
    // there is one reader.
    instanceDerivedKeys: deriveInstanceReadKeys(instanceGrants.individual, ceiling),
    defAccess,
    instanceAccess,
    baselineInstanceAccess,
    grantedDefIds: computeGrantedDefIds(instanceGrants),
  }
}

/**
 * **The front door** (plan v3/03 §4.2 / §6.1) — the record defs a member holds
 * at least one instance grant on, at `rung >= read`.
 *
 * `Record<defId, true>` and never an instance-id set: it is bounded by DEF
 * COUNT, not grant count, which is the entire reason it is allowed in the blob
 * at all. The per-row answer is evaluated in SQL by `recordVisibilityScope`,
 * because record access is row-local; only this bounded summary is cached.
 *
 * Computed from BOTH lanes, so a member whose only grant arrived through a group
 * or the workspace baseline still gets the front door — the plan calls that out
 * explicitly, and it is why this reads the bucketed grants rather than the
 * individual lane alone. (`deriveInstanceReadKeys` above deliberately does the
 * opposite; the two are not interchangeable.)
 *
 * ### Why both exclusions are required
 *
 * A record def is one declared in NEITHER `INSTANCE_ACCESS_RESOURCES` (either
 * lane) NOR `MAIL_SHARING_DEFS`. Neither test alone is sufficient:
 *  - `isInstanceAccessKey` is blob-lane only, so it answers `false` for `thread`
 *    and `sequence` — using it would put mail threads into the RECORD front
 *    door, and a thread's rung means something different there.
 *  - the registry alone does not know `contact`, whose grants canonicalize into
 *    the mail keyspace and fan a full lens across that contact's entire
 *    conversation history (§10.1). Contacts stay excluded from the record lane
 *    until the `MAIL_SHARING_DEFS` keyspace split.
 *
 * `none` rows are skipped by the threshold, not merely by value: `none` is a
 * RESTRICTION marker and must never open a door.
 */
function computeGrantedDefIds(grants: BucketedInstanceGrants): Record<string, true> {
  const granted: Record<string, true> = {}
  for (const lane of [grants.individual, grants.baseline]) {
    for (const [defId, instances] of Object.entries(lane)) {
      if (granted[defId]) continue
      if (isDeclaredInstanceDomain(defId) || isMailSharingDef(defId)) continue
      for (const rung of Object.values(instances)) {
        if (satisfiesRung(rung, 'read')) {
          granted[defId] = true
          break
        }
      }
    }
  }
  return granted
}

/**
 * Synthesize the `Level.Read` rung of every instance-access area the member
 * holds ≥1 `view`-or-better **individual** instance grant on — see
 * {@link UserCapabilities.instanceDerivedKeys} for why the result is kept out of
 * `keys`.
 *
 * Four properties, each deliberate:
 *
 * - **INDIVIDUAL lane only** (plan 43 §4.4). The caller passes
 *   `instanceGrants.individual`; passing the baseline lane in would defeat the
 *   §0.2a lever outright, because every dashboard writes a `role:org_member @
 *   view` row at create — so every member would derive `dashboards.view` and the
 *   front door would stand open for exactly the profile an admin just set to
 *   `None`.
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
 * Defs that are not a registered BLOB-LANE instance-access key are skipped (fail
 * closed) — that is the guard keeping RECORD defs, `thread` and `sequence` out;
 * `'none'` grants never reach `read` and so never derive. Ordered by
 * {@link ALL_KEYS} so the cached blob is byte-stable across recomputes
 * regardless of row order.
 */
function deriveInstanceReadKeys(
  individual: DefKeyedRungs,
  ceiling: Record<Area, Level>
): PermissionKey[] {
  const held = new Set<PermissionKey>()
  for (const [defId, byInstance] of Object.entries(individual)) {
    if (!isInstanceAccessKey(defId)) continue
    if (ceiling[INSTANCE_ACCESS_RESOURCES[defId].area] === Level.None) continue
    if (!Object.values(byInstance).some((rung) => satisfiesRung(rung, 'read'))) continue
    for (const key of INSTANCE_ACCESS_READ_KEYS[defId]) held.add(key)
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
