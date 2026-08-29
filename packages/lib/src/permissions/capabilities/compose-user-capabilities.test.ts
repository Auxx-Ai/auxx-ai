// packages/lib/src/permissions/capabilities/compose-user-capabilities.test.ts

import type { ResourcePermission, Rung } from '@auxx/database/enums'
import type { SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { bucketInstanceGrantRows } from '../../resource-access/instance-grants'
import { composeUserCapabilities } from './compose-user-capabilities'
import { effectiveInstanceLevel, type ResolvedRecordAccess } from './entity-access'
import { INSTANCE_ACCESS_RESOURCES, type InstanceAccessKey } from './instance-access'
import {
  AREA_ORDER,
  Area,
  areaLevelFromKeys,
  buildAreaLevels,
  expandLevelsToKeys,
  Level,
  PERMISSION_AREAS,
  PermissionKey,
} from './registry'
import {
  FIELD_TECH_BASELINE_LEVELS,
  MEMBER_BASELINE_LEVELS,
  ROLE_DEFAULTS,
  SEAT_CEILINGS,
  WORKER_SEAT_KEYS,
} from './seat-policy'

const sorted = (keys: PermissionKey[]) => [...keys].sort()

/**
 * Every key an all-`Full` composition can actually produce.
 *
 * **NOT `ALL_KEYS`**, which is `Object.values(PermissionKey)` — the enum — and
 * has been a strict SUPERSET of this set since plan 43 §3.1 dropped the
 * `Level.Edit` rung from `signatures` / `snippets` / `dashboards`. Those three
 * `*Edit` keys stay in the enum as per-instance ladder vocabulary
 * (`ResourcePermission.edit`, `assertEditInstance`) but no AREA level emits them
 * any more, so an assertion of "an admin holds every key" written against the
 * enum now fails for reasons that have nothing to do with the admin.
 */
const ALL_COMPOSABLE_KEYS: PermissionKey[] = expandLevelsToKeys(buildAreaLevels(() => Level.Full))

/**
 * Rebuilds `seat-policy.ts`'s deleted `effectiveDefault` helper for the two
 * roles plan 22 leaves untouched (`ROLE_DEFAULTS.ADMIN`/`.OWNER` are still
 * `ALL_FULL`): `min(ROLE_DEFAULTS[role][area], SEAT_CEILINGS[seatType][area])`,
 * expanded to keys. There is deliberately no `'USER'` case — post plan 22
 * `ROLE_DEFAULTS.USER` is the all-`None` floor, not "the generous default", so
 * a USER comparison belongs against {@link MEMBER_BASELINE_LEVELS} (an actual
 * composition input), never against this bare role map.
 */
function legacyEffectiveDefault(role: 'ADMIN' | 'OWNER', seatType: SeatType): PermissionKey[] {
  const defaults = ROLE_DEFAULTS[role]
  const ceiling = SEAT_CEILINGS[seatType]
  const clamped = buildAreaLevels((area) => Math.min(defaults[area], ceiling[area]) as Level)
  return expandLevelsToKeys(clamped)
}

/**
 * What a full-seat USER-rank principal composes when NOTHING is authored for
 * them — no profile levels, no `baseLevel`, no grants. It is no longer `[]`:
 * plan 43 §3.2 (option A of its §0.5) floors `signatures`, `snippets` and
 * `dashboards` at `Level.Read` in `ROLE_DEFAULTS.USER`.
 *
 * Why the floor moved, since these tests were written to pin it AT zero: plan 43
 * §4 made the area level GATE the workspace-baseline path, so silence would
 * otherwise DENY — and every custom profile is silent on every area its author
 * did not think about. `Read` here is permission to RECEIVE a workspace default,
 * not a grant: all three resources are `baselineAtCreate: true`, so with no
 * `ResourceAccess` row the member still resolves `undefined` (pinned as §8 item
 * 16b in `area-baseline-gate.test.ts`). `Full` — create — stays closed, so plan
 * 22 §2.5's "a new area ships CLOSED" still holds for the rung that grants
 * anything.
 *
 * A WORKER seat still composes `[]` from the same inputs: none of the three
 * areas is in `WORKER_AREAS`, so the seat ceiling clamps all three back to None.
 */
const USER_FLOOR_KEYS: PermissionKey[] = expandLevelsToKeys(
  buildAreaLevels((area) => ROLE_DEFAULTS.USER[area])
)

describe('composeUserCapabilities (leveled model, sparse jsonb)', () => {
  it('gives OWNER and ADMIN every key (full seat)', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const caps = composeUserCapabilities({ role, seatType: 'full', typeAccessRows: [] })
      expect(sorted(caps.keys)).toEqual(sorted(legacyEffectiveDefault('OWNER', 'full')))
      // Sanity: admins hold the adminOnly keys.
      expect(caps.keys).toContain(PermissionKey.settingsManage)
      expect(caps.keys).toContain(PermissionKey.membersManage)
    }
  })

  it('gives a Member-profile USER the seeded baseline (adminOnly areas absent)', () => {
    // Plan 22: a bare compose (no `profileLevels`) now floors to None —
    // `ROLE_DEFAULTS.USER` is the floor, not "the default". What USED to be the
    // role default is now the seeded Member profile's explicit baseline, so this
    // must compose WITH `MEMBER_BASELINE_LEVELS` to reproduce the pre-strip set.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: MEMBER_BASELINE_LEVELS,
      typeAccessRows: [],
    })
    expect(caps.keys).not.toContain(PermissionKey.settingsManage)
    expect(caps.keys).not.toContain(PermissionKey.billingManage)
    expect(caps.keys).not.toContain(PermissionKey.membersManage)
    expect(caps.keys).not.toContain(PermissionKey.permissionsManage)
    // A full-seat Member holds full records (view/edit/delete/import).
    expect(caps.keys).toContain(PermissionKey.recordsDelete)
    expect(caps.keys).toContain(PermissionKey.recordsImport)
  })

  it('pins the adminOnly area set EXACTLY — now empty, so EVERY area is grantable', () => {
    // Migrated from the deleted per-area binary-role-gate anti-rot test (that flag
    // was retired 2026-07-27, plan 21 §8 step 11, once the last role gate was
    // deleted). `adminOnly` is a separate, still-live question — "may a USER be
    // granted this?" — and stays pinned so an area can't silently gain or lose it.
    //
    // `settings` was the last member and left 2026-07-28 (plan 39 §7.1): while it
    // held the flag, `assertGrantableLevels` refused to grant it below ADMIN, so
    // the nine settings pages that moved off role gates would have been
    // capability-expressed but still admin-only. Deliberately still pinned, and
    // pinned to EMPTY — re-adding the flag to any area is a delegation
    // REGRESSION and has to be argued for here first.
    const adminOnlyAreas = AREA_ORDER.filter((area) => PERMISSION_AREAS[area].adminOnly === true)
    expect(adminOnlyAreas).toEqual([])
  })

  it('grants a plain USER the settings area — the point of dropping adminOnly', () => {
    // The delegation itself: no role, one explicit grant, and the key composes.
    // If this fails, `settings` is admin-only again by some other route.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.settings]: Level.Full },
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.settingsManage)
  })

  it('still withholds settings from the untouched Member baseline', () => {
    // The safety half: dropping `adminOnly` makes the area GRANTABLE, it must not
    // make it DEFAULT. `settings` stays omitted from MEMBER_BASELINE_LEVELS.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: MEMBER_BASELINE_LEVELS,
      typeAccessRows: [],
    })
    expect(caps.keys).not.toContain(PermissionKey.settingsManage)
  })

  it("a worker seat's effective default is exactly WORKER_SEAT_KEYS", () => {
    // Plan 22: a bare compose now floors to None on a worker seat too, so this
    // must compose WITH the seeded Field Tech baseline (§2.3) to reproduce the
    // pre-strip worker default.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'worker',
      profileLevels: FIELD_TECH_BASELINE_LEVELS,
      typeAccessRows: [],
    })
    expect(sorted(caps.keys)).toEqual(sorted(WORKER_SEAT_KEYS))
  })

  it('splits comments into Read and Full without changing the Member baseline', () => {
    const readOnly = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.comments]: Level.Read },
      typeAccessRows: [],
    })
    expect(readOnly.keys).toContain(PermissionKey.commentsView)
    expect(readOnly.keys).not.toContain(PermissionKey.commentsManage)

    const member = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: MEMBER_BASELINE_LEVELS,
      typeAccessRows: [],
    })
    expect(member.keys).toContain(PermissionKey.commentsView)
    expect(member.keys).toContain(PermissionKey.commentsManage)
  })

  it('keeps comments unliftably disabled for worker seats', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'worker',
      profileLevels: { [Area.comments]: Level.Full },
      typeAccessRows: [],
    })
    expect(caps.keys).not.toContain(PermissionKey.commentsView)
    expect(caps.keys).not.toContain(PermissionKey.commentsManage)
  })

  it('the profile base falls through PER AREA: sets records=Read, workflows unset now composes None (plan 22 §2.5)', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      // Sparse policy: ONLY records is overridden — every other area is unset.
      profileLevels: { [Area.records]: Level.Read },
      typeAccessRows: [],
    })
    // records is lowered to Read (the set area).
    expect(caps.keys).toContain(PermissionKey.recordsView)
    expect(caps.keys).not.toContain(PermissionKey.recordsEdit)
    expect(caps.keys).not.toContain(PermissionKey.recordsDelete)
    // workflows is UNSET in the policy → post plan-22 that falls through to
    // ROLE_DEFAULTS.USER, the all-None floor — the intended behavior change
    // (doc 19 §1.1's Tom bug, one rank down, closed for real by plan 22).
    expect(caps.keys).not.toContain(PermissionKey.workflowsManage)
  })

  it('the profile base lowers a set area (records → Read)', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.records]: Level.Read },
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsView)
    expect(caps.keys).not.toContain(PermissionKey.recordsDelete)
  })

  it('OWNER short-circuits to Full and is never lowered by its profile (§0.10)', () => {
    const caps = composeUserCapabilities({
      role: 'OWNER',
      seatType: 'full',
      profileLevels: { [Area.records]: Level.None, [Area.workflows]: Level.None },
      profileBaseLevel: Level.None,
      profileCeiling: { areas: { [Area.records]: Level.None, [Area.settings]: Level.Read } },
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsDelete)
    expect(caps.keys).toContain(PermissionKey.settingsManage)
    expect(sorted(caps.keys)).toEqual(sorted(ALL_COMPOSABLE_KEYS))
  })

  it('a group grant raises above the profile baseline but cannot lower it', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      // Profile baseline: the seeded Member baseline (plan 22 §2.2, workflows:
      // Full), with records explicitly lowered to Read.
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.records]: Level.Read },
      // Group raises records to Full; a None on workflows can't lower the
      // profile's Full (raise-only, Camp-1).
      groupLevels: [{ [Area.records]: Level.Full, [Area.workflows]: Level.None }],
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsView)
    expect(caps.keys).toContain(PermissionKey.recordsEdit)
    expect(caps.keys).toContain(PermissionKey.recordsDelete)
    // workflows stays at the profile's Full despite the group's None (raise-only).
    expect(caps.keys).toContain(PermissionKey.workflowsManage)
  })

  it('two groups at the same area resolve to the max level', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.records]: Level.None },
      groupLevels: [{ [Area.records]: Level.Read }, { [Area.records]: Level.Full }],
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsDelete) // max = Full wins
  })

  it('seat ceiling dominates a Full group grant (worker keeps exactly the three surfaces)', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'worker',
      // The seeded Field Tech baseline (plan 22 §2.3) supplies the three surfaces.
      profileLevels: FIELD_TECH_BASELINE_LEVELS,
      // A group + user grant Full on several OTHER areas — the worker ceiling
      // zeroes all but the three field-seat surfaces regardless.
      groupLevels: [
        {
          [Area.records]: Level.Full,
          [Area.settings]: Level.Full,
          [Area.dispatchBoard]: Level.Full,
        },
      ],
      userLevels: { [Area.records]: Level.Full, [Area.billing]: Level.Full },
      typeAccessRows: [],
    })
    expect(sorted(caps.keys)).toEqual(sorted(WORKER_SEAT_KEYS))
    expect(caps.keys).not.toContain(PermissionKey.recordsView)
    expect(caps.keys).not.toContain(PermissionKey.settingsManage)
  })

  it('a direct user grant raises the profile-lowered baseline (records → Full)', () => {
    // `base`: an ordinary Member-profile holder (plan 22 §2.2) — the generous
    // default is now data on the profile, not a bare role fall-through.
    const base = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: MEMBER_BASELINE_LEVELS,
      typeAccessRows: [],
    })
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.records]: Level.Read },
      userLevels: { [Area.records]: Level.Full },
      typeAccessRows: [],
    })
    expect(base.keys).toContain(PermissionKey.recordsDelete)
    expect(caps.keys).toContain(PermissionKey.recordsDelete)
  })

  it('reduces typeAccessRows to the highest permission per definition', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [
        { entityDefinitionId: 'def_a', rung: 'read' },
        { entityDefinitionId: 'def_a', rung: 'admin' },
        { entityDefinitionId: 'def_a', rung: 'edit' },
        { entityDefinitionId: 'def_b', rung: 'edit' },
        { entityDefinitionId: 'def_b', rung: 'read' },
      ],
    })
    expect(caps.defAccess).toEqual({ def_a: 'admin', def_b: 'edit' })
  })

  it("skips a baseline 'none' row so it never seeds a defAccess entry (grants nobody)", () => {
    // Non-grantee: only the baseline lockdown row applies → no defAccess entry,
    // so canViewEntity denies (the def is still flagged restricted upstream).
    const nonGrantee = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [{ entityDefinitionId: 'def_locked', rung: 'none' }],
    })
    expect(nonGrantee.defAccess).toEqual({})

    // Grantee: the lockdown row plus their own positive grant → only the positive
    // level surfaces in defAccess (none is skipped, not max-composed to 0).
    const grantee = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [
        { entityDefinitionId: 'def_locked', rung: 'none' },
        { entityDefinitionId: 'def_locked', rung: 'read' },
      ],
    })
    expect(grantee.defAccess).toEqual({ def_locked: 'view' })
  })

  it("keeps a lone baseline 'none' INSTANCE row (it is the per-instance downward marker)", () => {
    // The mirror-image of the `defAccess` rule directly above: on instances a
    // `none` row is KEPT, because `effectiveInstanceLevel` reads the composed
    // entry itself rather than "is there an entry at all". Dropping it here is
    // what plan 24's "Restricted" baseline would have to survive.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [],
      instanceGrants: bucketInstanceGrantRows([
        {
          entityDefinitionId: 'dataset',
          entityInstanceId: 'ds_locked',
          rung: 'none',
          granteeType: 'user',
          granteeId: 'usr_x',
        },
      ]),
    })
    expect(caps.instanceAccess).toEqual({ ds_locked: 'none' })
  })

  it("lets a real grant outrank the baseline 'none' on the SAME instance, in either row order", () => {
    // A grantee of a Restricted instance composes BOTH rows. The reduce is
    // max-by-rank, so row order must not decide the outcome — a first-wins or
    // last-wins reducer would leave the person the instance was just shared with
    // sitting on the lockdown marker.
    const rows = [
      {
        entityDefinitionId: 'dataset',
        entityInstanceId: 'ds_locked',
        rung: 'none' as const,
        granteeType: 'user',
        granteeId: 'usr_x',
      },
      {
        entityDefinitionId: 'dataset',
        entityInstanceId: 'ds_locked',
        rung: 'edit' as const,
        granteeType: 'user',
        granteeId: 'usr_x',
      },
    ]
    for (const ordering of [rows, [...rows].reverse()]) {
      const caps = composeUserCapabilities({
        role: 'USER',
        seatType: 'full',
        typeAccessRows: [],
        instanceGrants: bucketInstanceGrantRows(ordering),
      })
      expect(caps.instanceAccess).toEqual({ ds_locked: 'edit' })
    }
  })

  it("a baseline 'view' row makes the def visible to everyone (grant present)", () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [{ entityDefinitionId: 'def_open', rung: 'read' }],
    })
    expect(caps.defAccess).toEqual({ def_open: 'view' })
  })

  it('fails closed for an undefined role (non-member): no keys', () => {
    const caps = composeUserCapabilities({
      role: undefined,
      seatType: 'full',
      userLevels: { [Area.records]: Level.Full },
      typeAccessRows: [],
    })
    expect(caps.keys).toEqual([])
  })

  it('human composition is byte-for-byte unchanged when userType is passed explicitly', () => {
    // Every human userType must produce EXACTLY the legacy (no-userType) result.
    const legacy = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.records]: Level.Read },
      groupLevels: [{ [Area.records]: Level.Full, [Area.workflows]: Level.None }],
      userLevels: { [Area.knowledgeBase]: Level.Full },
      typeAccessRows: [{ entityDefinitionId: 'def_a', rung: 'edit' }],
      instanceGrants: bucketInstanceGrantRows([
        {
          entityDefinitionId: 'dataset',
          entityInstanceId: 'inst_a',
          rung: 'none',
          granteeType: 'user',
          granteeId: 'usr_x',
        },
      ]),
    })
    for (const userType of ['USER', 'SYSTEM'] as const) {
      const withType = composeUserCapabilities({
        role: 'USER',
        seatType: 'full',
        userType,
        profileLevels: { [Area.records]: Level.Read },
        groupLevels: [{ [Area.records]: Level.Full, [Area.workflows]: Level.None }],
        userLevels: { [Area.knowledgeBase]: Level.Full },
        typeAccessRows: [{ entityDefinitionId: 'def_a', rung: 'edit' }],
        instanceGrants: bucketInstanceGrantRows([
          {
            entityDefinitionId: 'dataset',
            entityInstanceId: 'inst_a',
            rung: 'none',
            granteeType: 'user',
            granteeId: 'usr_x',
          },
        ]),
      })
      expect(withType).toEqual(legacy)
    }
  })

  it('is JSON-serializable (cache round-trip)', () => {
    const caps = composeUserCapabilities({
      role: 'ADMIN',
      seatType: 'full',
      typeAccessRows: [{ entityDefinitionId: 'def_a', rung: 'edit' }],
    })
    expect(JSON.parse(JSON.stringify(caps))).toEqual(caps)
  })
})

describe('composeUserCapabilities — permission profiles (doc 19 §2.1)', () => {
  it('null binding: ADMIN composes byte-identically to the pre-profile model', () => {
    // A null `permissionProfileId` resolves to a SPARSE system profile
    // (`baseLevel: null`, no grant row), so `base` falls through to
    // ROLE_DEFAULTS[role]. For ADMIN that fall-through is still `ALL_FULL`
    // (plan 22 leaves it untouched) — exactly what the deleted `role:org_member`
    // tier did when the org had never customized. This is the migration's no-op
    // proof, for the role plan 22 doesn't change.
    const cases = [
      { role: 'ADMIN' as const, seatType: 'full' as const },
      { role: 'ADMIN' as const, seatType: 'worker' as const },
    ]
    for (const { role, seatType } of cases) {
      const nullBound = composeUserCapabilities({
        role,
        seatType,
        // What `resolveBaseProfile` yields for a sparse system row.
        profileLevels: undefined,
        profileBaseLevel: null,
        profileCeiling: null,
        typeAccessRows: [],
      })
      expect(sorted(nullBound.keys)).toEqual(sorted(legacyEffectiveDefault(role, seatType)))
    }
  })

  it('null binding: a USER with no seeded Member row fails CLOSED (plan 22 §2.5/§5 missing-seed posture)', () => {
    // Pre plan 22 this exact shape (no levels, no baseLevel) fell through to
    // ROLE_DEFAULTS.USER's generous map — the migration's no-op proof used to
    // cover USER too. Plan 22 makes that fall-through the all-None floor
    // instead: the profiles substrate (including the seeded Member grant row)
    // must ship in the same deployment as the strip (plan 22's "Deployment
    // reality" note) precisely so this shape never actually occurs against a
    // live org. Here it is the deliberately-accepted "no seed yet" case — it
    // must fail closed, not throw and not silently stay generous.
    for (const seatType of ['full', 'worker'] as const) {
      const nullBound = composeUserCapabilities({
        role: 'USER',
        seatType,
        profileLevels: undefined,
        profileBaseLevel: null,
        profileCeiling: null,
        typeAccessRows: [],
      })
      // Plan 43 §3.2 moved the floor off zero for three areas. It still fails
      // CLOSED in the sense that matters — no create rung, and `Read` on a
      // `baselineAtCreate: true` resource grants nothing without a row — and a
      // WORKER seat still composes exactly `[]`, because none of the three areas
      // is in `WORKER_AREAS`.
      expect(sorted(nullBound.keys)).toEqual(seatType === 'worker' ? [] : sorted(USER_FLOOR_KEYS))
    }
  })

  it('plan 21 §1.1 is closed: a custom profile composes one set, whoever holds it', () => {
    // "Support Lead": records Full, knowledgeBase Edit, nothing else. Under
    // plan 21 the holder's role IS the profile's declared rank — 'USER' for
    // every custom profile (§2.0.1), written at invite/assign — so the ADMIN
    // fall-through that silently handed "Tom" billing/settings/permissions can
    // never meet a custom profile again: `role` arrives here already derived.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.records]: Level.Full, [Area.knowledgeBase]: Level.Edit },
      profileBaseLevel: null,
      profileCeiling: null,
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsEdit)
    expect(caps.keys).toContain(PermissionKey.knowledgeBaseEdit)
    // The §1.1 worked example's "Tom" rows — all None for every holder now:
    expect(caps.keys).not.toContain(PermissionKey.billingView)
    expect(caps.keys).not.toContain(PermissionKey.permissionsManage)
    expect(caps.keys).not.toContain(PermissionKey.settingsManage)
    expect(caps.keys).not.toContain(PermissionKey.membersManage)
    expect(caps.keys).not.toContain(PermissionKey.auditLogView)
  })

  it('null binding on a worker seat is still exactly WORKER_SEAT_KEYS (seat ceiling clamps last)', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'worker',
      profileBaseLevel: null,
      profileCeiling: null,
      // The seeded Field Tech baseline (plan 22 §2.3) supplies the three worker
      // surfaces; records/settings are ALSO forced Full to prove even an
      // all-Full profile base cannot escape the billing invariant.
      profileLevels: {
        ...FIELD_TECH_BASELINE_LEVELS,
        [Area.records]: Level.Full,
        [Area.settings]: Level.Full,
      },
      typeAccessRows: [],
    })
    expect(sorted(caps.keys)).toEqual(sorted(WORKER_SEAT_KEYS))
  })

  it('baseLevel fills in every area the profile does not set (owner/admin template shape)', () => {
    // `baseLevel: Full` + no grant row = how the seeded owner/admin profiles say
    // "everything" without writing an all-Full grant row (which would trip
    // `assertGrantableLevels` on the adminOnly areas).
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileBaseLevel: Level.Full,
      typeAccessRows: [],
    })
    expect(sorted(caps.keys)).toEqual(sorted(ALL_COMPOSABLE_KEYS))
    expect(caps.keys).toContain(PermissionKey.settingsManage)

    // …and an explicit level still beats baseLevel for the areas it sets.
    const mixed = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileBaseLevel: Level.Full,
      profileLevels: { [Area.records]: Level.Read },
      typeAccessRows: [],
    })
    expect(mixed.keys).toContain(PermissionKey.recordsView)
    expect(mixed.keys).not.toContain(PermissionKey.recordsEdit)
    expect(mixed.keys).toContain(PermissionKey.settingsManage)
  })

  it("baseLevel: None floors every unset area (0 must not be treated as 'unset')", () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileBaseLevel: Level.None,
      profileLevels: { [Area.records]: Level.Read },
      typeAccessRows: [],
    })
    expect(caps.keys).toEqual([PermissionKey.recordsView])
  })

  it('an explicit Level.None on the profile grant row genuinely denies the area', () => {
    // `None` is LOAD-BEARING on a profile grantee — it is the composition BASE, so
    // `grant-service.granteeKeepsNoneLevels` must never strip it. Stripping would
    // make this area fall through to the role default: a silent fail-OPEN.
    // Modeled on the seeded Member baseline with ONE area explicitly zeroed (an
    // admin editing the profile down) — post plan-22 a bare UNSET area is None
    // too, so this pins the EXPLICIT-None case specifically, distinct from that.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.records]: Level.None },
      typeAccessRows: [],
    })
    for (const key of RECORDS_KEYS) expect(caps.keys).not.toContain(key)
    // The Member baseline's other areas are untouched.
    expect(caps.keys).toContain(PermissionKey.workflowsManage)
  })

  // The remaining `profileCeiling` cases pin the AREA clamp only. It has no
  // authoring surface after plan 20 §2.a.3 — nothing writes `ceiling`, so these
  // exercise a seam kept for doc 19 §11.4's deny tier, not shipped behaviour.
  // The definition half is gone; these must never be extended to cover it.
  it('the area ceiling holds the line against a group raise (unauthored seam)', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: {
        [Area.records]: Level.Edit,
        [Area.billing]: Level.None,
        [Area.files]: Level.Read,
      },
      profileCeiling: { areas: { [Area.files]: Level.Read } },
      // The group would win `files` under plain Camp-1 max-wins.
      groupLevels: [{ [Area.knowledgeBase]: Level.Full, [Area.files]: Level.Full }],
      userLevels: { [Area.auditLog]: Level.Read },
      typeAccessRows: [],
    })
    // records: profile Edit, nothing raises it.
    expect(caps.keys).toContain(PermissionKey.recordsEdit)
    expect(caps.keys).not.toContain(PermissionKey.recordsDelete)
    // files: the ceiling clamps the group's Full back to Read.
    expect(caps.keys).toContain(PermissionKey.filesView)
    expect(caps.keys).not.toContain(PermissionKey.filesManage)
    // knowledgeBase: uncapped, so the group's Full wins.
    expect(caps.keys).toContain(PermissionKey.knowledgeBaseManage)
    // auditLog: the personal override raises from the USER default of None.
    expect(caps.keys).toContain(PermissionKey.auditLogView)
    // billing: an admin-only area the profile explicitly zeroed.
    expect(caps.keys).not.toContain(PermissionKey.billingView)
  })

  it('the area ceiling also clamps a personal (user) override, not just groups', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.records]: Level.Read },
      profileCeiling: { areas: { [Area.records]: Level.Read } },
      userLevels: { [Area.records]: Level.Full },
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsView)
    expect(caps.keys).not.toContain(PermissionKey.recordsEdit)
  })

  it('OWNER is never clamped by a profile area ceiling — the recovery guarantee (§0.10)', () => {
    const caps = composeUserCapabilities({
      role: 'OWNER',
      seatType: 'full',
      profileLevels: { [Area.permissions]: Level.None, [Area.records]: Level.None },
      profileBaseLevel: Level.None,
      profileCeiling: { areas: { [Area.permissions]: Level.None, [Area.records]: Level.Read } },
      typeAccessRows: [],
    })
    // A mis-shaped profile can never lock the last owner out of fixing it.
    expect(sorted(caps.keys)).toEqual(sorted(ALL_COMPOSABLE_KEYS))
    expect(caps.keys).toContain(PermissionKey.permissionsManage)
  })

  it('OWNER is still clamped by the seat ceiling (the billing invariant is never profile-driven)', () => {
    const caps = composeUserCapabilities({
      role: 'OWNER',
      seatType: 'worker',
      typeAccessRows: [],
    })
    expect(sorted(caps.keys)).toEqual(sorted(WORKER_SEAT_KEYS))
  })

  it('a NEWLY ADDED area stays admin-accessible without any profile backfill (§0.7)', () => {
    // The seeded system profiles are SPARSE, so an area nobody has ever authored
    // is absent from `profileLevels`. It must fall through to ROLE_DEFAULTS[role]
    // — all-Full for ADMIN — rather than reading as None.
    const brandNewArea = Area.connectors
    const admin = composeUserCapabilities({
      role: 'ADMIN',
      seatType: 'full',
      // Sparse: the admin profile only ever set ONE unrelated area.
      profileLevels: { [Area.records]: Level.Full },
      profileBaseLevel: null,
      typeAccessRows: [],
    })
    for (const rung of PERMISSION_AREAS[brandNewArea].rungs) {
      for (const key of rung.keys) expect(admin.keys).toContain(key)
    }
    // Every other area too — nothing silently dropped to None.
    expect(sorted(admin.keys)).toEqual(sorted(ALL_COMPOSABLE_KEYS))
  })

  it('a foreign/unresolvable binding degrades to the None floor, not silently generous (plan 22 §2.5)', () => {
    // What `resolveBaseProfile` yields when the bound id is not in the org's
    // projection or the org has no seeded rows at all (the §5.2 runtime
    // fallback): no levels, no baseLevel, no ceiling. Pre plan 22 this degraded
    // to the generous ROLE_DEFAULTS.USER map ("never to no-access"); post
    // plan 22 the fall-through IS the all-None floor — the missing-seed posture
    // is deliberately accepted (plan 22 §5), not a silent widen.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: undefined,
      profileBaseLevel: null,
      profileCeiling: null,
      typeAccessRows: [],
    })
    // The USER-rank floor, which plan 43 §3.2 raised off zero for `signatures` /
    // `snippets` / `dashboards`. Still not "silently generous": no create rung
    // anywhere, and `Read` on those three confers nothing absent a row.
    expect(sorted(caps.keys)).toEqual(sorted(USER_FLOOR_KEYS))
  })

  it('a `null` ceiling composes to the EXACT pre-plan-20 blob for ADMIN/OWNER (the whole safety claim)', () => {
    // Plan 20 §6 null-binding parity. Every real member has `ceiling: null` (all
    // six seeded profiles ship it, and nothing ever wrote one), so deleting the
    // definition ceiling cannot change anybody's access — this pins the FULL
    // composed `UserCapabilities`, byte-for-byte, not a spot check.
    //
    // These literals are the pre-change output with `ceilingDefs: null` dropped:
    // the only field the removal touched. Anything else moving fails here.
    //
    // OWNER/ADMIN only: plan 22 leaves `ROLE_DEFAULTS.ADMIN`/`.OWNER` untouched
    // (`ALL_FULL`), so the pre-plan-20 parity claim still holds byte-for-byte.
    // The USER half of this claim is retired by plan 22 — see the sibling test
    // below.
    const cases = [
      { role: 'OWNER' as const, seatType: 'full' as const },
      { role: 'ADMIN' as const, seatType: 'full' as const },
    ]
    for (const { role, seatType } of cases) {
      const caps = composeUserCapabilities({
        role,
        seatType,
        // Exactly what `resolveBaseProfile` yields for every shipped profile.
        profileLevels: undefined,
        profileBaseLevel: null,
        profileCeiling: null,
        typeAccessRows: [
          { entityDefinitionId: 'def_a', rung: 'read' },
          { entityDefinitionId: 'def_a', rung: 'admin' },
          { entityDefinitionId: 'def_locked', rung: 'none' },
        ],
        instanceGrants: bucketInstanceGrantRows([
          {
            entityDefinitionId: 'dataset',
            entityInstanceId: 'inst_a',
            rung: 'none',
            granteeType: 'user',
            granteeId: 'usr_x',
          },
          {
            entityDefinitionId: 'dataset',
            entityInstanceId: 'inst_b',
            rung: 'edit',
            granteeType: 'user',
            granteeId: 'usr_x',
          },
        ]),
      })
      // `baselineInstanceAccess` joined the shape in plan 43 §4.1 — the SECOND
      // instance lane, gated by the area level while `instanceAccess` is not.
      // Its arrival is exactly why `user:capabilities` went v15 → v16.
      expect(Object.keys(caps).sort()).toEqual([
        'baselineInstanceAccess',
        'defAccess',
        'grantedDefIds',
        'instanceAccess',
        'instanceDerivedKeys',
        'keys',
      ])
      expect(caps).toEqual({
        keys: caps.keys,
        baselineInstanceAccess: {},
        // OWNER short-circuits and ADMIN already holds `datasets.view` from the
        // all-Full profile, so nothing is DERIVED for either — the `edit` row on
        // `inst_b` would derive the Read rung for a member, not for these two.
        instanceDerivedKeys: role === 'OWNER' ? [] : [PermissionKey.datasetsView],
        defAccess: { def_a: 'admin' },
        instanceAccess: { inst_a: 'none', inst_b: 'edit' },
        // EMPTY, and that is the assertion: both grant rows above are on
        // `dataset`, a declared instance-access domain, so neither reaches the
        // RECORD front door. `grantedDefIds` admits only defs declared in
        // neither `INSTANCE_ACCESS_RESOURCES` nor `MAIL_SHARING_DEFS` — swap
        // `isDeclaredInstanceDomain` for `isInstanceAccessKey` in
        // `computeGrantedDefIds` and `thread`/`sequence` start leaking in here.
        grantedDefIds: {},
      })
      expect(sorted(caps.keys)).toEqual(sorted(legacyEffectiveDefault(role, seatType)))
    }
  })

  it('plan 22: the same missing-seed shape composes a USER to keys:[] but keeps defAccess/instanceAccess (§5 missing-seed posture)', () => {
    // USER is the one role plan 22 changes: the pre-plan-20 blob comparison
    // above no longer holds for it, ON PURPOSE — an org with no seeded Member
    // row now fails CLOSED for members (empty `keys`), not generously open.
    // `defAccess`/`instanceAccess` are computed independently of `role` (see
    // `compose-user-capabilities.ts`), so they are untouched either way.
    for (const seatType of ['full', 'worker'] as const) {
      const caps = composeUserCapabilities({
        role: 'USER',
        seatType,
        profileLevels: undefined,
        profileBaseLevel: null,
        profileCeiling: null,
        typeAccessRows: [
          { entityDefinitionId: 'def_a', rung: 'read' },
          { entityDefinitionId: 'def_a', rung: 'admin' },
          { entityDefinitionId: 'def_locked', rung: 'none' },
        ],
        instanceGrants: bucketInstanceGrantRows([
          {
            entityDefinitionId: 'dataset',
            entityInstanceId: 'inst_a',
            rung: 'none',
            granteeType: 'user',
            granteeId: 'usr_x',
          },
          {
            entityDefinitionId: 'dataset',
            entityInstanceId: 'inst_b',
            rung: 'edit',
            granteeType: 'user',
            granteeId: 'usr_x',
          },
        ]),
      })
      expect(sorted(caps.keys)).toEqual(seatType === 'worker' ? [] : sorted(USER_FLOOR_KEYS))
      expect(caps.defAccess).toEqual({ def_a: 'admin' })
      expect(caps.instanceAccess).toEqual({ inst_a: 'none', inst_b: 'edit' })
      // Both rows are `user` grantees, so nothing lands in the baseline lane.
      expect(caps.baselineInstanceAccess).toEqual({})
    }
  })

  it('an absent `profileCeiling` and an explicit `null` are indistinguishable', () => {
    const shape = {
      role: 'USER' as const,
      seatType: 'full' as const,
      profileLevels: { [Area.records]: Level.Read },
      groupLevels: [{ [Area.records]: Level.Full, [Area.files]: Level.Full }],
      userLevels: { [Area.auditLog]: Level.Read },
      typeAccessRows: [{ entityDefinitionId: 'def_a', rung: 'edit' as const }],
    }
    expect(composeUserCapabilities({ ...shape, profileCeiling: null })).toEqual(
      composeUserCapabilities(shape)
    )
  })
})

/** Every PermissionKey the `records` area can confer (any rung). */
const RECORDS_KEYS = PERMISSION_AREAS[Area.records].rungs.flatMap((r) => r.keys)

describe('composeUserCapabilities — AGENT branch composes NOTHING (doc 19 §0.16/§2.3)', () => {
  /**
   * These tests replace doc 14 §0.2's SET-semantics-over-all-Full suite. That
   * branch is gone: an agent's authority is now the immutable
   * `AgentVersion.permissionPolicy` snapshot, enforced by
   * `AgentPolicyCapabilities`, and NOTHING composed here is consulted for it.
   *
   * The point of asserting emptiness (rather than deleting the block) is that
   * this is the load-bearing half of §0.16 — "the synthetic `OrganizationMember`
   * carries membership/role/seat only, it is not a second authority". Every
   * assertion below is a leak that would silently defeat republishing a
   * definition as `None`.
   */

  it('holds no capability keys at all, whatever the grant rows say', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      userType: 'AGENT',
      userLevels: { [Area.records]: Level.Full, [Area.settings]: Level.Full },
      profileLevels: { [Area.records]: Level.Full },
      groupLevels: [{ [Area.records]: Level.Full }, { [Area.billing]: Level.Full }],
      typeAccessRows: [],
    })
    expect(caps.keys).toEqual([])
    for (const key of RECORDS_KEYS) expect(caps.keys).not.toContain(key)
    expect(caps.keys).not.toContain(PermissionKey.settingsManage)
  })

  it('drops defAccess, so a leftover ResourceAccess row cannot resurrect a def', () => {
    // This is the exact leak that would break "publish Deals=Full, republish
    // Deals=None": an explicit per-def grant REPLACES the base records verb in
    // `canViewRecord`, so a surviving `admin` row on the agent's synthetic user
    // would keep granting Deals no matter what the published policy said.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      userType: 'AGENT',
      typeAccessRows: [
        { entityDefinitionId: 'def_deals', rung: 'admin' as const },
        { entityDefinitionId: 'def_a', rung: 'read' as const },
      ],
      instanceGrants: bucketInstanceGrantRows([
        {
          entityDefinitionId: 'kb',
          entityInstanceId: 'kb_1',
          rung: 'edit' as const,
          granteeType: 'user',
          granteeId: 'usr_x',
        },
      ]),
    })
    expect(caps.defAccess).toEqual({})
    expect(caps.instanceAccess).toEqual({})
  })

  it('does NOT change how a human composes the same rows', () => {
    const rows = {
      typeAccessRows: [
        { entityDefinitionId: 'def_a', rung: 'read' as const },
        { entityDefinitionId: 'def_a', rung: 'admin' as const },
        { entityDefinitionId: 'def_locked', rung: 'none' as const },
      ],
      instanceGrants: bucketInstanceGrantRows([
        {
          entityDefinitionId: 'dataset',
          entityInstanceId: 'inst_a',
          rung: 'none' as const,
          granteeType: 'user',
          granteeId: 'usr_x',
        },
        {
          entityDefinitionId: 'dataset',
          entityInstanceId: 'inst_b',
          rung: 'edit' as const,
          granteeType: 'user',
          granteeId: 'usr_x',
        },
      ]),
    }
    const human = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      // An ordinary Member-profile holder (plan 22 §2.2) — needs SOME keys so
      // the contrast with the empty AGENT branch above is meaningful.
      profileLevels: MEMBER_BASELINE_LEVELS,
      ...rows,
    })
    expect(human.defAccess).toEqual({ def_a: 'admin' })
    expect(human.instanceAccess).toEqual({ inst_a: 'none', inst_b: 'edit' })
    expect(human.keys.length).toBeGreaterThan(0)
  })

  it('still fails closed for an agent with no OrganizationMember row', () => {
    const caps = composeUserCapabilities({
      role: undefined,
      seatType: 'full',
      userType: 'AGENT',
      typeAccessRows: [],
    })
    expect(caps.keys).toEqual([])
  })
})

/**
 * Plan 22 §5 verification — the member baseline strip's own acceptance
 * criteria, pinned directly rather than folded into the repaired tests above
 * (which pin individual composition mechanics, not the plan's specific claims).
 */
describe('plan 22 (member baseline strip) — §5 verification', () => {
  it('fresh-org parity: a full-seat Member composes byte-identically to the OLD generous default', () => {
    // The central claim: the baseline MOVED (code → seeded grant row), nothing
    // about what a fresh org's member actually holds changed. Asserted against
    // LITERAL values, not against `MEMBER_BASELINE_LEVELS` itself — comparing
    // the seed to itself would prove nothing.
    const expected: Record<Area, Level> = {
      [Area.records]: Level.Full,
      [Area.recordsLinked]: Level.Full,
      [Area.workflows]: Level.Full,
      [Area.agents]: Level.Full,
      [Area.comments]: Level.Full,
      [Area.dispatchBoard]: Level.Full,
      [Area.dispatchMySchedule]: Level.Full,
      [Area.dispatchVisitReports]: Level.Full,
      [Area.settings]: Level.None,
      [Area.billing]: Level.None,
      [Area.members]: Level.None,
      [Area.permissions]: Level.None,
      [Area.integrations]: Level.None,
      [Area.channels]: Level.None,
      // Added by plan 36 §2.3 — members create and own their own signatures and
      // snippets, so both ship at `Full` in the Member baseline. This is a NEW
      // area rather than a change to the plan-22 parity claim above: a fresh org
      // before plan 36 had no such area at all.
      [Area.signatures]: Level.Full,
      [Area.snippets]: Level.Full,
      // Added by plan 40 §7, and a NEW area for the same reason as the two
      // above: mail had no Layer-2 area at all before 2026-07-29, so this is not
      // a change to the plan-22 parity claim. `Read` is the whole of today's
      // org-shared mail access under the two-rung ladder (`Read → view` on every
      // row-less shared inbox); `Full` would mean Manager of every inbox.
      [Area.inboxes]: Level.Read,
      [Area.aiConfig]: Level.None,
      [Area.automationRules]: Level.None,
      [Area.auditLog]: Level.None,
      [Area.files]: Level.Full,
      [Area.connectors]: Level.None,
      [Area.datasets]: Level.Read,
      [Area.knowledgeBase]: Level.Edit,
      [Area.dashboards]: Level.Full,
      // Added by plans/money/tasks/10-the-poster.md §6, and `None` - a NEW area
      // again, so the plan-22 parity claim is untouched. The general ledger is
      // omitted from `MEMBER_BASELINE_LEVELS` on purpose: a member has no
      // business posting to the books without an explicit grant.
      [Area.ledger]: Level.None,
    }
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: MEMBER_BASELINE_LEVELS,
      typeAccessRows: [],
    })
    const keys = new Set(caps.keys)
    for (const area of AREA_ORDER) {
      expect(areaLevelFromKeys(keys, area)).toBe(expected[area])
    }
  })

  it('field-seat parity: a worker-seat Field Tech composes exactly the three surfaces Full, the rest None', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'worker',
      profileLevels: FIELD_TECH_BASELINE_LEVELS,
      typeAccessRows: [],
    })
    const keys = new Set(caps.keys)
    const workerAreas = new Set([
      Area.recordsLinked,
      Area.dispatchMySchedule,
      Area.dispatchVisitReports,
    ])
    for (const area of AREA_ORDER) {
      expect(areaLevelFromKeys(keys, area)).toBe(workerAreas.has(area) ? Level.Full : Level.None)
    }
  })

  it('sparse custom profile: only the set areas hold, every unset area composes None', () => {
    // The intended behavior change (doc 19 §1.1's Tom bug, one rank down):
    // a custom profile that sets two areas no longer silently inherits Full
    // everywhere else through the old generous fall-through.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.records]: Level.Edit, [Area.knowledgeBase]: Level.Full },
      typeAccessRows: [],
    })
    const keys = new Set(caps.keys)
    for (const area of AREA_ORDER) {
      if (area === Area.records) expect(areaLevelFromKeys(keys, area)).toBe(Level.Edit)
      else if (area === Area.knowledgeBase) expect(areaLevelFromKeys(keys, area)).toBe(Level.Full)
      // Plan 43 §3.2: three areas floor at `Read` rather than `None`, so an
      // unset area is "the workspace default reaches you" for exactly those and
      // still "no access" for the other twelve.
      else expect(areaLevelFromKeys(keys, area)).toBe(ROLE_DEFAULTS.USER[area])
    }
    expect(ROLE_DEFAULTS.USER[Area.signatures]).toBe(Level.Read)
    expect(ROLE_DEFAULTS.USER[Area.snippets]).toBe(Level.Read)
    expect(ROLE_DEFAULTS.USER[Area.dashboards]).toBe(Level.Read)
  })

  it('admin/owner untouched: ROLE_DEFAULTS.ADMIN/.OWNER stay all-Full', () => {
    // The recovery guarantee (plan 21 §2.a.7) is explicitly out of scope for
    // plan 22 — only `ROLE_DEFAULTS.USER` was stripped. The unseeded-org admin
    // parity test in `admin-profile-parity.test.ts` pins this end to end; this
    // pins the map itself.
    for (const area of AREA_ORDER) {
      expect(ROLE_DEFAULTS.ADMIN[area]).toBe(Level.Full)
      expect(ROLE_DEFAULTS.OWNER[area]).toBe(Level.Full)
    }
  })

  it('missing-seed posture: no Member profile row composes a USER to all-None without throwing; ADMIN still composes Full', () => {
    expect(() => {
      const userCaps = composeUserCapabilities({
        role: 'USER',
        seatType: 'full',
        profileLevels: undefined,
        profileBaseLevel: null,
        profileCeiling: null,
        typeAccessRows: [],
      })
      expect(sorted(userCaps.keys)).toEqual(sorted(USER_FLOOR_KEYS))

      const adminCaps = composeUserCapabilities({
        role: 'ADMIN',
        seatType: 'full',
        profileLevels: undefined,
        profileBaseLevel: null,
        profileCeiling: null,
        typeAccessRows: [],
      })
      expect(sorted(adminCaps.keys)).toEqual(sorted(ALL_COMPOSABLE_KEYS))
    }).not.toThrow()
  })

  it('new-area/channels pin: absent from MEMBER_BASELINE_LEVELS — member composes None, admin composes Full', () => {
    // Pins plan 21 §6's "member default stays None" and plan 22 §2.5's
    // fail-closed-by-default policy for a NEW area in one assertion: `channels`
    // is the first area both plans actually name.
    expect(MEMBER_BASELINE_LEVELS[Area.channels]).toBeUndefined()

    const member = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: MEMBER_BASELINE_LEVELS,
      typeAccessRows: [],
    })
    expect(areaLevelFromKeys(new Set(member.keys), Area.channels)).toBe(Level.None)

    const admin = composeUserCapabilities({ role: 'ADMIN', seatType: 'full', typeAccessRows: [] })
    expect(areaLevelFromKeys(new Set(admin.keys), Area.channels)).toBe(Level.Full)
  })
})

/**
 * Plan 25 §2 — an explicit instance row beats the area floor.
 *
 * These drive the REAL composition (`composeUserCapabilities`) into the REAL
 * resolver (`effectiveInstanceLevel`), so they pin the whole path a share
 * travels: rows compose into `instanceAccess`, `governingInstanceIds` marks the
 * instance as explicitly managed, and the resolver reads the row BEFORE the area
 * gate.
 *
 * The three properties that must hold together — take any one away and the
 * change is either useless or a leak:
 *  1. area `None` + an explicit ≥`view` row ⇒ access (the live repro);
 *  2. area `None` + NO row ⇒ denied (fail-closed for the unshared majority);
 *  3. area `None` + an explicit `'none'` row ⇒ denied (restrictions still bite).
 *
 * Run across all four registry keys so the rule is uniform over
 * `baselineAtCreate` — dashboards (`true`) must behave identically to the three
 * org-shared resources here.
 */
describe('plan 25 §2 — an explicit instance grant overrides the area-None floor', () => {
  /** Compose a full-seat USER whose ONE named area is closed, then resolve one instance. */
  function resolve(opts: {
    area: Area
    rows: Array<{
      entityInstanceId: string
      rung: Rung
      /**
       * Grantee kind (plan 43 §4.1). Defaults to `'user'`, and that is the RIGHT
       * default for this whole describe block: #1346 is a claim about INDIVIDUAL
       * grants specifically. The baseline lane's own behaviour at area `None` is
       * the opposite and is covered in `area-baseline-gate.test.ts`.
       */
      granteeType?: string
    }>
    instanceId: string
    key: InstanceAccessKey
    role?: 'USER' | 'OWNER'
    seatType?: SeatType
  }) {
    const role = opts.role ?? 'USER'
    const caps = composeUserCapabilities({
      role,
      seatType: opts.seatType ?? 'full',
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [opts.area]: Level.None },
      typeAccessRows: [],
      // Every row belongs to the resource under test — the composer needs the
      // type to decide WHICH area's Read rung (if any) it derives.
      instanceGrants: bucketInstanceGrantRows(
        opts.rows.map((row) => ({
          entityDefinitionId: opts.key,
          granteeType: 'user',
          granteeId: 'usr_x',
          ...row,
        }))
      ),
    })
    const access: ResolvedRecordAccess = {
      role,
      seatType: opts.seatType ?? 'full',
      keys: new Set(caps.keys),
      defAccess: caps.defAccess,
      restrictedEntityDefIds: new Set(),
      instanceAccess: caps.instanceAccess,
      baselineInstanceAccess: caps.baselineInstanceAccess,
      // Grantee-agnostic by construction (see `computeUserCapabilities`): any row
      // on an instance puts it under explicit management, grant or restriction.
      governingInstanceIds: new Set(opts.rows.map((r) => r.entityInstanceId)),
    }
    return { caps, level: effectiveInstanceLevel(access, opts.key, opts.instanceId) }
  }

  const KEYS: InstanceAccessKey[] = ['workflow', 'dataset', 'kb', 'dashboard']

  it.each(KEYS)('%s: area None + an explicit `read` grant resolves to read', (key) => {
    const area = INSTANCE_ACCESS_RESOURCES[key].area
    const { caps, level } = resolve({
      area,
      key,
      instanceId: 'inst_shared',
      rows: [{ entityInstanceId: 'inst_shared', rung: 'read' }],
    })
    // The area really is shut — otherwise this test proves nothing.
    expect(areaLevelFromKeys(new Set(caps.keys), area)).toBe(Level.None)
    expect(level).toBe('read')
  })

  it.each(KEYS)('%s: area None + NO row is still denied (fail-closed)', (key) => {
    const { level } = resolve({
      area: INSTANCE_ACCESS_RESOURCES[key].area,
      key,
      instanceId: 'inst_untouched',
      rows: [{ entityInstanceId: 'inst_shared', rung: 'admin' }],
    })
    expect(level).toBeUndefined()
  })

  it.each(KEYS)('%s: area None + an explicit `none` restriction is denied', (key) => {
    const { level } = resolve({
      area: INSTANCE_ACCESS_RESOURCES[key].area,
      key,
      instanceId: 'inst_locked',
      rows: [{ entityInstanceId: 'inst_locked', rung: 'none' }],
    })
    expect(level).toBe('none')
  })

  it.each(KEYS)('%s: the grant carries its own rung, not a flattened read', (key) => {
    // A share is not silently downgraded to Read by the closed area: `edit` and
    // `admin` grants survive intact, which is what makes "you may manage exactly
    // this one" expressible.
    for (const rung of ['edit', 'admin'] as const) {
      const { level } = resolve({
        area: INSTANCE_ACCESS_RESOURCES[key].area,
        key,
        instanceId: 'inst_shared',
        rows: [{ entityInstanceId: 'inst_shared', rung }],
      })
      expect(level).toBe(rung)
    }
  })

  it('OWNER is unaffected — still admin on a closed area with a `none` row', () => {
    const { level } = resolve({
      area: Area.workflows,
      key: 'workflow',
      role: 'OWNER',
      instanceId: 'inst_locked',
      rows: [{ entityInstanceId: 'inst_locked', rung: 'none' }],
    })
    expect(level).toBe('admin')
  })

  it('a worker seat is NOT lifted by a grant — the seat ceiling still dominates', () => {
    // The regression the reorder opened: `effectiveInstanceLevel` used to reach
    // the seat clamp implicitly, through the already-clamped key set. It is now
    // an explicit check, and this is the test that keeps it there.
    const { level } = resolve({
      // Full on the profile; the ceiling, not the profile, is what shuts it.
      area: Area.records,
      key: 'workflow',
      seatType: 'worker',
      instanceId: 'inst_shared',
      rows: [{ entityInstanceId: 'inst_shared', rung: 'admin' }],
    })
    expect(SEAT_CEILINGS.worker[Area.workflows]).toBe(Level.None)
    expect(level).toBeUndefined()
  })
})

/**
 * `grantedDefIds` — the record-lane FRONT DOOR (plan v3/03 §4.2 / §6.1).
 *
 * Bounded by def count, never an instance-id set: the per-row answer is SQL's
 * job (`recordVisibilityScope`), because record access is row-local. What is
 * cached is only "which record defs does this member hold any grant on".
 */
describe('composeUserCapabilities — grantedDefIds (the record front door)', () => {
  const RECORD_DEF = 'def_deals_cuid'

  function compose(
    rows: Array<{
      entityDefinitionId: string
      entityInstanceId: string
      rung: Rung
      granteeType: 'user' | 'group' | 'profile' | 'role'
      granteeId: string
    }>,
    overrides: { role?: 'ADMIN' | 'USER' | 'OWNER' | undefined; seatType?: SeatType } = {}
  ) {
    return composeUserCapabilities({
      role: 'role' in overrides ? overrides.role : 'USER',
      seatType: overrides.seatType ?? 'full',
      profileLevels: undefined,
      profileBaseLevel: null,
      profileCeiling: null,
      typeAccessRows: [],
      instanceGrants: bucketInstanceGrantRows(rows),
    })
  }

  const userRow = (defId: string, rung: Rung, instanceId = 'inst_1') =>
    ({
      entityDefinitionId: defId,
      entityInstanceId: instanceId,
      rung,
      granteeType: 'user' as const,
      granteeId: 'usr_x',
    }) as const

  it('admits a record def held at read, edit or admin', () => {
    for (const rung of ['read', 'edit', 'admin'] as const) {
      expect(compose([userRow(RECORD_DEF, rung)]).grantedDefIds).toEqual({ [RECORD_DEF]: true })
    }
  })

  it('does NOT admit a def held only below read', () => {
    // `metadata`/`identity` are real rungs on the mail ladder but confer no
    // record read, so they must not open a nav entry onto rows the list
    // predicate (`rung IN ('read','edit','admin')`) will then hide.
    for (const rung of ['metadata', 'identity'] as const) {
      expect(compose([userRow(RECORD_DEF, rung)]).grantedDefIds).toEqual({})
    }
  })

  it('does NOT admit a def whose only row is the `none` RESTRICTION marker', () => {
    // `none` is a restriction, never a grant — the single most repeated
    // fail-open shape in this codebase's history.
    expect(compose([userRow(RECORD_DEF, 'none')]).grantedDefIds).toEqual({})
  })

  it('admits a def reached ONLY through a group — the union is the point', () => {
    // The plan calls this out explicitly: computed from the full grantee union,
    // so a member whose only grant arrived via a group still gets the door.
    // `bucketInstanceGrantRows` has already resolved membership upstream.
    const caps = compose([
      {
        entityDefinitionId: RECORD_DEF,
        entityInstanceId: 'inst_1',
        rung: 'read',
        granteeType: 'group',
        granteeId: 'grp_support',
      },
    ])
    expect(caps.grantedDefIds).toEqual({ [RECORD_DEF]: true })
  })

  it('admits a def reached only through the workspace baseline lane', () => {
    const caps = compose([
      {
        entityDefinitionId: RECORD_DEF,
        entityInstanceId: 'inst_1',
        rung: 'read',
        granteeType: 'role',
        granteeId: 'org_member',
      },
    ])
    expect(caps.grantedDefIds).toEqual({ [RECORD_DEF]: true })
  })

  it('excludes BOTH registry lanes and the mail keyspace — neither test alone suffices', () => {
    // `dataset` is blob-lane, `thread`/`sequence` are query-lane, `contact` is
    // mail-only. `isInstanceAccessKey` answers FALSE for thread and sequence, so
    // using it alone would fan mail threads into the record front door; the
    // registry alone would miss `contact`, whose grants fan a full lens across
    // that contact's whole conversation history (§10.1).
    const caps = compose([
      userRow('dataset', 'admin', 'i1'),
      userRow('thread', 'read', 'i2'),
      userRow('sequence', 'admin', 'i3'),
      userRow('contact', 'read', 'i4'),
      userRow('inbox', 'admin', 'i5'),
      userRow(RECORD_DEF, 'read', 'i6'),
    ])
    expect(caps.grantedDefIds).toEqual({ [RECORD_DEF]: true })
  })

  it('is keyed by DEF, so many grants on one def stay one entry', () => {
    // The size bound that justifies caching this at all.
    const rows = Array.from({ length: 50 }, (_, i) => userRow(RECORD_DEF, 'read', `inst_${i}`))
    expect(compose(rows).grantedDefIds).toEqual({ [RECORD_DEF]: true })
  })

  it('is EMPTY for a non-member — a grant row outlives the membership', () => {
    expect(compose([userRow(RECORD_DEF, 'admin')], { role: undefined }).grantedDefIds).toEqual({})
  })

  it('is populated for an OWNER, unlike instanceDerivedKeys', () => {
    // Deliberately not empty: it reports grants actually held rather than
    // synthesizing a rung, and it is the only way in when a worker-seat ceiling
    // closes `Area.records` and `canViewEntity` is false.
    expect(compose([userRow(RECORD_DEF, 'read')], { role: 'OWNER' }).grantedDefIds).toEqual({
      [RECORD_DEF]: true,
    })
  })
})
