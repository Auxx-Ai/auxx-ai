// packages/lib/src/permissions/capabilities/compose-user-capabilities.test.ts

import { describe, expect, it } from 'vitest'
import { composeUserCapabilities } from './compose-user-capabilities'
import { Area, Level, PERMISSION_AREAS, PermissionKey } from './registry'
import { ALL_KEYS, effectiveDefault, WORKER_SEAT_KEYS } from './seat-policy'

const sorted = (keys: PermissionKey[]) => [...keys].sort()

describe('composeUserCapabilities (leveled model, sparse jsonb)', () => {
  it('gives OWNER and ADMIN every key (full seat)', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const caps = composeUserCapabilities({ role, seatType: 'full', typeAccessRows: [] })
      expect(sorted(caps.keys)).toEqual(sorted(effectiveDefault('OWNER', 'full')))
      // Sanity: admins hold the adminOnly keys.
      expect(caps.keys).toContain(PermissionKey.settingsManage)
      expect(caps.keys).toContain(PermissionKey.membersManage)
    }
  })

  it('gives USER the role default (adminOnly areas absent)', () => {
    const caps = composeUserCapabilities({ role: 'USER', seatType: 'full', typeAccessRows: [] })
    expect(sorted(caps.keys)).toEqual(sorted(effectiveDefault('USER', 'full')))
    expect(caps.keys).not.toContain(PermissionKey.settingsManage)
    expect(caps.keys).not.toContain(PermissionKey.billingManage)
    expect(caps.keys).not.toContain(PermissionKey.membersManage)
    expect(caps.keys).not.toContain(PermissionKey.permissionsManage)
    // A full USER holds full records (view/edit/delete/import).
    expect(caps.keys).toContain(PermissionKey.recordsDelete)
    expect(caps.keys).toContain(PermissionKey.recordsImport)
  })

  it("a worker seat's effective default is exactly WORKER_SEAT_KEYS", () => {
    const caps = composeUserCapabilities({ role: 'USER', seatType: 'worker', typeAccessRows: [] })
    expect(sorted(caps.keys)).toEqual(sorted(WORKER_SEAT_KEYS))
  })

  it('the profile base falls through PER AREA: sets records=Read, leaves workflows at USER default', () => {
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
    // workflows is UNSET in the policy → falls through to the USER default, NOT None.
    expect(caps.keys).toContain(PermissionKey.workflowsManage)
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
    expect(sorted(caps.keys)).toEqual(sorted(ALL_KEYS))
  })

  it('a group grant raises above the profile baseline but cannot lower it', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      // Profile baseline: records at Read.
      profileLevels: { [Area.records]: Level.Read },
      // Group raises records to Full; a None on workflows can't lower the default.
      groupLevels: [{ [Area.records]: Level.Full, [Area.workflows]: Level.None }],
      typeAccessRows: [],
    })
    expect(caps.keys).toContain(PermissionKey.recordsView)
    expect(caps.keys).toContain(PermissionKey.recordsEdit)
    expect(caps.keys).toContain(PermissionKey.recordsDelete)
    // workflows stays at the USER default despite the group's None (raise-only).
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
      // A group + user grant Full on several areas — the worker ceiling zeroes all but three.
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
    const base = composeUserCapabilities({ role: 'USER', seatType: 'full', typeAccessRows: [] })
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
        { entityDefinitionId: 'def_a', permission: 'view' },
        { entityDefinitionId: 'def_a', permission: 'admin' },
        { entityDefinitionId: 'def_a', permission: 'edit' },
        { entityDefinitionId: 'def_b', permission: 'edit' },
        { entityDefinitionId: 'def_b', permission: 'view' },
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
      typeAccessRows: [{ entityDefinitionId: 'def_locked', permission: 'none' }],
    })
    expect(nonGrantee.defAccess).toEqual({})

    // Grantee: the lockdown row plus their own positive grant → only the positive
    // level surfaces in defAccess (none is skipped, not max-composed to 0).
    const grantee = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [
        { entityDefinitionId: 'def_locked', permission: 'none' },
        { entityDefinitionId: 'def_locked', permission: 'view' },
      ],
    })
    expect(grantee.defAccess).toEqual({ def_locked: 'view' })
  })

  it("a baseline 'view' row makes the def visible to everyone (grant present)", () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [{ entityDefinitionId: 'def_open', permission: 'view' }],
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
      typeAccessRows: [{ entityDefinitionId: 'def_a', permission: 'edit' }],
      instanceAccessRows: [{ entityInstanceId: 'inst_a', permission: 'none' }],
    })
    for (const userType of ['USER', 'SYSTEM'] as const) {
      const withType = composeUserCapabilities({
        role: 'USER',
        seatType: 'full',
        userType,
        profileLevels: { [Area.records]: Level.Read },
        groupLevels: [{ [Area.records]: Level.Full, [Area.workflows]: Level.None }],
        userLevels: { [Area.knowledgeBase]: Level.Full },
        typeAccessRows: [{ entityDefinitionId: 'def_a', permission: 'edit' }],
        instanceAccessRows: [{ entityInstanceId: 'inst_a', permission: 'none' }],
      })
      expect(withType).toEqual(legacy)
    }
  })

  it('is JSON-serializable (cache round-trip)', () => {
    const caps = composeUserCapabilities({
      role: 'ADMIN',
      seatType: 'full',
      typeAccessRows: [{ entityDefinitionId: 'def_a', permission: 'edit' }],
    })
    expect(JSON.parse(JSON.stringify(caps))).toEqual(caps)
  })
})

describe('composeUserCapabilities — permission profiles (doc 19 §2.1)', () => {
  it('null binding: USER / worker seat / ADMIN compose byte-identically to the pre-profile model', () => {
    // A null `permissionProfileId` resolves to a SPARSE system profile
    // (`baseLevel: null`, no grant row), so `base` falls through to
    // ROLE_DEFAULTS[role] — exactly what the deleted `role:org_member` tier did
    // when the org had never customized. This is the migration's no-op proof.
    const cases = [
      { role: 'USER' as const, seatType: 'full' as const },
      { role: 'USER' as const, seatType: 'worker' as const },
      { role: 'ADMIN' as const, seatType: 'full' as const },
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
      expect(sorted(nullBound.keys)).toEqual(sorted(effectiveDefault(role, seatType)))
    }
  })

  it('null binding on a worker seat is still exactly WORKER_SEAT_KEYS (seat ceiling clamps last)', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'worker',
      profileBaseLevel: null,
      profileCeiling: null,
      // Even an all-Full profile base cannot escape the billing invariant.
      profileLevels: { [Area.records]: Level.Full, [Area.settings]: Level.Full },
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
    expect(sorted(caps.keys)).toEqual(sorted(ALL_KEYS))
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
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.records]: Level.None },
      typeAccessRows: [],
    })
    for (const key of RECORDS_KEYS) expect(caps.keys).not.toContain(key)
    // Unset areas are untouched.
    expect(caps.keys).toContain(PermissionKey.workflowsManage)
  })

  it('the profile ceiling holds the line against a group raise (§2.2 Dana)', () => {
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

  it('the ceiling also clamps a personal (user) override, not just groups', () => {
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

  it('OWNER is never clamped by a profile ceiling — the recovery guarantee (§0.10)', () => {
    const caps = composeUserCapabilities({
      role: 'OWNER',
      seatType: 'full',
      profileLevels: { [Area.permissions]: Level.None, [Area.records]: Level.None },
      profileBaseLevel: Level.None,
      profileCeiling: {
        areas: { [Area.permissions]: Level.None, [Area.records]: Level.Read },
        defs: { mode: 'only', slugs: [] },
      },
      typeAccessRows: [],
    })
    // A mis-shaped profile can never lock the last owner out of fixing it.
    expect(sorted(caps.keys)).toEqual(sorted(ALL_KEYS))
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
    expect(sorted(admin.keys)).toEqual(sorted(ALL_KEYS))
  })

  it('a foreign/unresolvable binding degrades to the role default, never to no-access', () => {
    // What `resolveBaseProfile` yields when the bound id is not in the org's
    // projection or the org has no seeded rows at all (the §5.2 runtime fallback):
    // no levels, no baseLevel, no ceiling. Must NOT fail closed.
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: undefined,
      profileBaseLevel: null,
      profileCeiling: null,
      typeAccessRows: [],
    })
    expect(sorted(caps.keys)).toEqual(sorted(effectiveDefault('USER', 'full')))
  })

  it('a defs-only ceiling clamps no AREA key but IS emitted for def enforcement (step 4)', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileCeiling: { defs: { mode: 'only', slugs: ['contact'] } },
      typeAccessRows: [],
    })
    // `defs` is a per-definition cap, not an area cap — the key set is untouched.
    expect(sorted(caps.keys)).toEqual(sorted(effectiveDefault('USER', 'full')))
    // But it now rides OUT of the composer, raw and slug-keyed, for
    // `getCapabilities` to resolve and `effectiveRecordLevel` to enforce.
    expect(caps.ceilingDefs).toEqual({ mode: 'only', slugs: ['contact'] })
  })

  it('carries an `except` ceiling verbatim (mode decides allow-list vs deny-list)', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileCeiling: { defs: { mode: 'except', slugs: ['salary', 'invoice'] } },
      typeAccessRows: [],
    })
    expect(caps.ceilingDefs).toEqual({ mode: 'except', slugs: ['salary', 'invoice'] })
  })

  it('emits `ceilingDefs: null` when the profile has no defs cap', () => {
    const noCeiling = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      typeAccessRows: [],
    })
    expect(noCeiling.ceilingDefs).toBeNull()
    const areasOnly = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileCeiling: { areas: { [Area.records]: Level.Read } },
      typeAccessRows: [],
    })
    expect(areasOnly.ceilingDefs).toBeNull()
  })

  it('OWNER is never handed a definition ceiling (§0.10 recovery guarantee)', () => {
    const owner = composeUserCapabilities({
      role: 'OWNER',
      seatType: 'full',
      profileCeiling: { defs: { mode: 'only', slugs: ['contact'] } },
      typeAccessRows: [],
    })
    expect(owner.ceilingDefs).toBeNull()
  })

  it('AGENT principals and non-members get no definition ceiling either', () => {
    // An agent's authority is the published version policy; nothing composed here
    // is consulted for it, so a human profile ceiling must not leak onto it.
    const agent = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      userType: 'AGENT',
      profileCeiling: { defs: { mode: 'only', slugs: ['contact'] } },
      typeAccessRows: [],
    })
    expect(agent.ceilingDefs).toBeNull()

    const nonMember = composeUserCapabilities({
      role: undefined,
      seatType: 'full',
      profileCeiling: { defs: { mode: 'only', slugs: ['contact'] } },
      typeAccessRows: [],
    })
    expect(nonMember.ceilingDefs).toBeNull()
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
        { entityDefinitionId: 'def_deals', permission: 'admin' as const },
        { entityDefinitionId: 'def_a', permission: 'view' as const },
      ],
      instanceAccessRows: [{ entityInstanceId: 'kb_1', permission: 'edit' as const }],
    })
    expect(caps.defAccess).toEqual({})
    expect(caps.instanceAccess).toEqual({})
  })

  it('does NOT change how a human composes the same rows', () => {
    const rows = {
      typeAccessRows: [
        { entityDefinitionId: 'def_a', permission: 'view' as const },
        { entityDefinitionId: 'def_a', permission: 'admin' as const },
        { entityDefinitionId: 'def_locked', permission: 'none' as const },
      ],
      instanceAccessRows: [
        { entityInstanceId: 'inst_a', permission: 'none' as const },
        { entityInstanceId: 'inst_b', permission: 'edit' as const },
      ],
    }
    const human = composeUserCapabilities({ role: 'USER', seatType: 'full', ...rows })
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
