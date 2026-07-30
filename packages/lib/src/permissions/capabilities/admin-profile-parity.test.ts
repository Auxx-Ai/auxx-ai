// packages/lib/src/permissions/capabilities/admin-profile-parity.test.ts

import { ResourcePermission, type Rung } from '@auxx/database/enums'
import type { SeatType } from '@auxx/database/types'
import { satisfiesPermission } from '@auxx/types/permissions'
import { describe, expect, it } from 'vitest'
import {
  bucketInstanceGrantRows,
  type InstanceGrantRow,
} from '../../resource-access/instance-grants'
import { systemProfileFor, systemProfileSeed } from '../profiles/system-profiles'
import { CapabilitySet } from './capability-set'
import { composeUserCapabilities } from './compose-user-capabilities'
import {
  administersAnyDef,
  canAdministerRecord,
  canEditRecord,
  canViewRecord,
  effectiveInstanceLevel,
  effectiveRecordLevel,
  type ResolvedRecordAccess,
} from './entity-access'
import {
  AREA_ORDER,
  Area,
  areaLevelFromKeys,
  buildAreaLevels,
  expandLevelsToKeys,
  Level,
  PermissionKey,
} from './registry'
import { ROLE_DEFAULTS, SEAT_CEILINGS } from './seat-policy'

/**
 * **ADMIN parity — doc 19 §5.3 pieces 1+2 (step 10), verified against §9.1's
 * "USER, worker seat, and ADMIN compose byte-identically before/after".**
 *
 * ADMIN used to reach `admin`/all-Full through FOUR hardcoded bypasses:
 *   1. `compute-user-capabilities.ts` skipped the `PermissionGrant` query for
 *      `role === 'OWNER' || role === 'ADMIN'`, so the `admin` profile's levels
 *      were never even read.
 *   2. `entity-access.ts#effectiveRecordLevel` returned `admin` for ADMIN.
 *   3. `capability-set.ts#effectiveInstanceLevel` + its client mirror
 *      `entity-access.ts#effectiveInstanceLevel` returned `admin` for ADMIN.
 *   4. `resource-access-service.ts#checkAccess` returned
 *      `admin` for ADMIN, on a completely independent code path.
 *
 * All four are now OWNER-only, so ADMIN capability flows from
 * `ROLE_DEFAULTS.ADMIN` + the editable `admin` system profile. The bar for that
 * swap is that an admin on the SEEDED profile is indistinguishable from the old
 * bypass. That is what this file pins.
 *
 * The oracle is the pre-change behaviour written out literally — an ADMIN who
 * short-circuits produces `effectiveDefault('ADMIN', seat)` for areas and
 * `ResourcePermission.admin` for every def and every instance. If the seeds or
 * the composer drift, these comparisons fail rather than silently re-deciding
 * what "parity" means.
 */

// ─────────────────────────── the pre-change oracle ───────────────────────────

/**
 * Rebuilds `seat-policy.ts`'s deleted `effectiveDefault` helper: per area
 * `min(ROLE_DEFAULTS[role][area], SEAT_CEILINGS[seatType][area])`, expanded to
 * keys. Only ever called with `'ADMIN'`/`'OWNER'` in this file — both stay
 * `ALL_FULL` in `ROLE_DEFAULTS` after plan 22 (the strip only touched `USER`),
 * so this is byte-identical to the pre-strip helper for every case this file
 * exercises.
 */
function effectiveDefault(role: 'ADMIN' | 'OWNER', seatType: SeatType): PermissionKey[] {
  const defaults = ROLE_DEFAULTS[role]
  const ceiling = SEAT_CEILINGS[seatType]
  const clamped = buildAreaLevels((area) => Math.min(defaults[area], ceiling[area]) as Level)
  return expandLevelsToKeys(clamped)
}

/** What the removed short-circuit produced for AREAS. */
const bypassAreaKeys = (seatType: SeatType) => new Set(effectiveDefault('ADMIN', seatType))

/** What the removed short-circuit produced for a DEF or an INSTANCE. */
const BYPASS_LEVEL = ResourcePermission.admin

// ────────────────────────── post-change composition ──────────────────────────

/**
 * Compose an ADMIN exactly as `computeUserCapabilities` now does: the `admin`
 * system profile supplies `baseLevel`/`ceiling`, and — critically — the grant
 * rows it previously never loaded are passed in.
 */
function composeAdmin(
  opts: {
    seatType?: SeatType
    /** Simulate a missing `PermissionProfile` row (the §5.2 runtime fallback). */
    withoutSeededProfile?: boolean
    profileLevels?: Partial<Record<Area, Level>>
    groupLevels?: Array<Partial<Record<Area, Level>>>
    userLevels?: Partial<Record<Area, Level>>
    typeAccessRows?: Array<{ entityDefinitionId: string; rung: Rung }>
    instanceRows?: InstanceGrantRow[]
  } = {}
) {
  const seed = systemProfileSeed('admin')
  return composeUserCapabilities({
    role: 'ADMIN',
    seatType: opts.seatType ?? 'full',
    userType: 'USER',
    profileLevels: opts.profileLevels,
    profileBaseLevel: opts.withoutSeededProfile ? null : seed?.baseLevel,
    profileCeiling: null,
    groupLevels: opts.groupLevels,
    userLevels: opts.userLevels,
    typeAccessRows: opts.typeAccessRows ?? [],
    instanceGrants: bucketInstanceGrantRows(opts.instanceRows ?? []),
  })
}

/** The `ResolvedRecordAccess` view an ADMIN's composed blob resolves to. */
function adminAccess(
  opts: {
    seatType?: SeatType
    restricted?: string[]
    restrictedInstances?: string[]
    typeAccessRows?: Array<{ entityDefinitionId: string; rung: Rung }>
    instanceRows?: InstanceGrantRow[]
  } = {}
): ResolvedRecordAccess {
  const caps = composeAdmin({
    seatType: opts.seatType,
    typeAccessRows: opts.typeAccessRows,
    instanceRows: opts.instanceRows,
  })
  return {
    role: 'ADMIN',
    seatType: opts.seatType ?? 'full',
    keys: new Set(caps.keys),
    defAccess: caps.defAccess,
    restrictedEntityDefIds: new Set(opts.restricted ?? []),
    defBaseOverrides: {},
    instanceAccess: caps.instanceAccess,
    baselineInstanceAccess: caps.baselineInstanceAccess,
    governingInstanceIds: new Set(opts.restrictedInstances ?? []),
  }
}

describe('ADMIN parity — piece 1: ROLE_DEFAULTS.ADMIN seeds the `admin` profile', () => {
  it('the seeded `admin` profile is all-Full, uncapped, full-seat, human-facing', () => {
    const seed = systemProfileSeed('admin')
    expect(seed).toBeDefined()
    expect(seed?.baseLevel).toBe(Level.Full)
    expect(seed?.seat).toBe('full')
    expect(seed?.appliesTo).toBe('member')
    // No `agentPolicy` — the human additive path is the only one that reads it.
    expect(seed?.agentPolicy).toBeNull()
  })

  it('`baseLevel: Full` and `ROLE_DEFAULTS.ADMIN` agree area-for-area', () => {
    // Piece 1 is "free" precisely because these two say the same thing. If a
    // future area were ever added at less than Full in ROLE_DEFAULTS.ADMIN, the
    // profile would silently widen it — this catches that.
    for (const area of AREA_ORDER) expect(ROLE_DEFAULTS.ADMIN[area]).toBe(Level.Full)
  })

  it('a null-bound ADMIN resolves to the `admin` system profile on either seat', () => {
    expect(systemProfileFor('ADMIN', 'full')).toBe('admin')
    expect(systemProfileFor('ADMIN', 'worker')).toBe('admin')
  })
})

describe('ADMIN parity — areas (byte-identical to the removed short-circuit)', () => {
  it.each(['full', 'worker'] as const)('composes the bypass key set on a %s seat', (seatType) => {
    expect(new Set(composeAdmin({ seatType }).keys)).toEqual(bypassAreaKeys(seatType))
  })

  it.each(['full', 'worker'] as const)('area-for-area rung parity on a %s seat', (seatType) => {
    // Compared against the bypass's own recovered rungs, not against
    // `ROLE_DEFAULTS` directly: an area with fewer than three keys cannot express
    // every rung, so `areaLevelFromKeys` is lossy for it in BOTH worlds. Parity is
    // "the same rung the short-circuit produced", which is what this asserts.
    const composed = new Set(composeAdmin({ seatType }).keys)
    const bypass = bypassAreaKeys(seatType)
    for (const area of AREA_ORDER) {
      expect(areaLevelFromKeys(composed, area)).toBe(areaLevelFromKeys(bypass, area))
      expect(areaLevelFromKeys(composed, area)).toBeLessThanOrEqual(
        Math.min(ROLE_DEFAULTS.ADMIN[area], SEAT_CEILINGS[seatType][area])
      )
    }
  })

  it('loading grant rows an admin previously skipped changes nothing on the seed', () => {
    // The whole cost of piece 2's first change is that these rows are now read.
    // On the seeded profile they must be provably inert: base is already Full and
    // the group/user tiers are raise-only.
    const withGrants = composeAdmin({
      groupLevels: [{ [Area.records]: Level.Read }, { [Area.billing]: Level.None }],
      userLevels: { [Area.settings]: Level.None, [Area.members]: Level.Read },
    })
    expect(new Set(withGrants.keys)).toEqual(bypassAreaKeys('full'))
  })

  it('the §5.2 runtime fallback (no PermissionProfile row) is also byte-identical', () => {
    // An org whose profiles were never seeded must not lock its admins out:
    // `base` falls through `profileBaseLevel ?? ROLE_DEFAULTS[role][area]`.
    expect(new Set(composeAdmin({ withoutSeededProfile: true }).keys)).toEqual(
      bypassAreaKeys('full')
    )
  })

  it('the composed blob carries exactly six fields (no ceiling rides out)', () => {
    // Plan 20 §2.a.2: `ceilingDefs` is gone from `UserCapabilities`. Pinned here
    // as a shape assertion because a re-added field would silently ride into the
    // cached blob and force another `user:capabilities:vN` bump.
    // `instanceDerivedKeys` joined the shape in item 5b — and did force the
    // v10 → v11 bump, which is exactly the tripwire this assertion is.
    // `baselineInstanceAccess` joined it in plan 43 §4.1 and forced v15 → v16.
    // That bump was MANDATORY rather than hygienic, and this assertion is why it
    // was noticed: the new field's absence on a stale blob is not a benign gap,
    // because `instanceAccess` NARROWED underneath it in the same change.
    // `grantedDefIds` joined it in plan v3/03 §6.1 and rides the v16 → v17 bump.
    // Its absence on a stale blob fails CLOSED (`?? {}` in `get-capabilities.ts`
    // shuts the record front door), so unlike v16 the bump is a correctness
    // measure rather than a leak fix — but it is still mandatory, because a
    // member shared a record would otherwise see no nav entry for a full TTL.
    expect(Object.keys(composeAdmin()).sort()).toEqual([
      'baselineInstanceAccess',
      'defAccess',
      'grantedDefIds',
      'instanceAccess',
      'instanceDerivedKeys',
      'keys',
    ])
  })
})

describe('ADMIN parity — definitions', () => {
  it('an unrestricted def answers identically to the removed bypass', () => {
    const caps = adminAccess()
    // The bypass returned `admin`; the composed path returns the `edit` base rung
    // (`levelToRecordBasePermission` caps base at `edit` by design). Every GATE
    // that consumed the level answers the same, which is what parity means here —
    // and `admin` satisfied all three, so each must still be `true`.
    expect(satisfiesPermission(BYPASS_LEVEL, ResourcePermission.admin)).toBe(true)
    expect(canViewRecord(caps, 'contact-def')).toBe(true)
    expect(canEditRecord(caps, 'contact-def')).toBe(true)
    expect(canAdministerRecord(caps, 'contact-def')).toBe(true)
    expect(administersAnyDef(caps)).toBe(true)
  })

  it('a worker-seat ADMIN is still clamped by the seat ceiling, exactly as before', () => {
    const caps = adminAccess({ seatType: 'worker' })
    expect(effectiveRecordLevel(caps, 'contact-def')).toBeUndefined()
  })

  it('DELIBERATE DIVERGENCE — a restricted def no longer bypasses for ADMIN', () => {
    // This is the point of piece 2, not a parity failure: the `admin` profile can
    // now be shaped, and a def restricted away from it actually bites. OWNER
    // keeps the recovery bypass (§0.10), so the org is never locked out.
    const caps = adminAccess({ restricted: ['invoice-def'] })
    expect(effectiveRecordLevel(caps, 'invoice-def')).toBeUndefined()
    expect(canViewRecord(caps, 'invoice-def')).toBe(false)
    expect(effectiveRecordLevel({ ...caps, role: 'OWNER' }, 'invoice-def')).toBe(BYPASS_LEVEL)
  })

  it("a `granteeType:'profile'` grant on the `admin` profile restores the def", () => {
    // The lever that makes the divergence above administrable rather than fatal.
    const caps = adminAccess({
      restricted: ['invoice-def'],
      typeAccessRows: [{ entityDefinitionId: 'invoice-def', rung: 'admin' }],
    })
    expect(effectiveRecordLevel(caps, 'invoice-def')).toBe(ResourcePermission.admin)
    expect(canAdministerRecord(caps, 'invoice-def')).toBe(true)
  })
})

describe('ADMIN parity — instance-access resources', () => {
  it.each([
    'dataset',
    'kb',
  ] as const)('an unshared %s answers identically to the removed bypass', (key) => {
    // `baselineAtCreate: false` ⇒ no instance row falls back to the area level,
    // and the seeded all-Full profile makes that `admin` — the bypass value.
    const caps = adminAccess()
    expect(effectiveInstanceLevel(caps, key, 'inst_1')).toBe(BYPASS_LEVEL)
  })

  it('the server CapabilitySet agrees with the client mirror', () => {
    // `capability-set.ts`'s private resolver and `entity-access.ts`'s exported one
    // are two copies of the same rule; narrowing one and not the other is a
    // server/client drift bug.
    const caps = composeAdmin()
    const set = new CapabilitySet(
      new Set(caps.keys),
      caps.defAccess,
      'ADMIN',
      'full',
      (id) => id,
      new Set(),
      (id) => id,
      caps.instanceAccess,
      new Set(),
      {},
      new Set(caps.instanceDerivedKeys),
      caps.baselineInstanceAccess
    )
    expect(set.canViewInstance('dataset', 'inst_1')).toBe(true)
    expect(set.canEditInstance('dataset', 'inst_1')).toBe(true)
    expect(set.canAdminInstance('dataset', 'inst_1')).toBe(true)
    expect(set.canViewInstance('kb', 'kb_1')).toBe(true)
    expect(set.canAdminInstance('kb', 'kb_1')).toBe(true)
  })

  it('DELIBERATE DIVERGENCE — an explicitly shared instance resolves through grants', () => {
    // A dashboard (`baselineAtCreate: true`) is fully row-described at birth, so
    // an ADMIN now gets the workspace baseline (`view`) rather than `admin`, and
    // nothing at all on a private one.
    //
    // **OWNER answers identically since 2026-07-28** (plan 36 §0.6 revised): the
    // §0.10 bypass is scoped to `baselineAtCreate: false`, so on the private
    // resources an owner resolves through their own rows like everyone else.
    // Concretely for dashboards, whose `role:org_member @ view` baseline row IS
    // in an owner's grantee union: they keep VIEW on an org-shared dashboard but
    // no longer hold `admin` on one they did not create, and a dashboard with no
    // row for them is invisible.
    const shared = adminAccess({
      restrictedInstances: ['dash_1'],
      instanceRows: [
        {
          entityDefinitionId: 'dashboard',
          entityInstanceId: 'dash_1',
          rung: 'read',
          // The `role:org_member @ view` row every dashboard writes at create —
          // the BASELINE lane (plan 43 §4.1). An admin composes `dashboards: Full`,
          // so §4.2's step-2 gate passes and the answer is unchanged.
          granteeType: 'role',
          granteeId: 'org_member',
        },
      ],
    })
    expect(effectiveInstanceLevel(shared, 'dashboard', 'dash_1')).toBe('read')
    expect(effectiveInstanceLevel({ ...shared, role: 'OWNER' }, 'dashboard', 'dash_1')).toBe('read')

    const priv = adminAccess({ restrictedInstances: ['dash_2'] })
    expect(effectiveInstanceLevel(priv, 'dashboard', 'dash_2')).toBeUndefined()
    expect(
      effectiveInstanceLevel({ ...priv, role: 'OWNER' }, 'dashboard', 'dash_2')
    ).toBeUndefined()

    // The org-shared resources are UNCHANGED — the bypass still applies there,
    // so this file's `BYPASS_LEVEL` still has a subject.
    expect(effectiveInstanceLevel({ ...priv, role: 'OWNER' }, 'dataset', 'ds_none')).toBe(
      BYPASS_LEVEL
    )
  })
})

describe('ADMIN parity — the profile is now actually shapeable (the point of step 10)', () => {
  it('a `None` on the `admin` profile grant row zeroes that area for admins', () => {
    // Before piece 2 this row was never loaded, so the editor would have been
    // lying. `grant-service` keeps (never strips) `None` for profile grantees
    // precisely so this is expressible.
    const caps = composeAdmin({ profileLevels: { [Area.billing]: Level.None } })
    const keys = new Set(caps.keys)
    expect(areaLevelFromKeys(keys, Area.billing)).toBe(Level.None)
    expect(keys.has(PermissionKey.billingView)).toBe(false)
    expect(keys.has(PermissionKey.billingManage)).toBe(false)
    // …and only that area moves.
    expect(areaLevelFromKeys(keys, Area.records)).toBe(Level.Full)
  })

  it('a group grant can still raise an area the admin profile zeroed (Camp-1)', () => {
    const caps = composeAdmin({
      profileLevels: { [Area.billing]: Level.None },
      groupLevels: [{ [Area.billing]: Level.Read }],
    })
    expect(areaLevelFromKeys(new Set(caps.keys), Area.billing)).toBe(Level.Read)
  })

  it('OWNER is unaffected by the same shaping — the §0.10 recovery guarantee', () => {
    const owner = composeUserCapabilities({
      role: 'OWNER',
      seatType: 'full',
      profileLevels: { [Area.billing]: Level.None },
      profileBaseLevel: Level.None,
      profileCeiling: { areas: { [Area.records]: Level.None } },
      typeAccessRows: [],
    })
    const keys = new Set(owner.keys)
    expect(keys).toEqual(new Set(effectiveDefault('OWNER', 'full')))
  })
})
