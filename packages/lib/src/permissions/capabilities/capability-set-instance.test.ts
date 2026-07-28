// packages/lib/src/permissions/capabilities/capability-set-instance.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { CapabilitySet } from './capability-set'
import { composeUserCapabilities } from './compose-user-capabilities'
import { effectiveInstanceLevel, toResolvedRecordAccess } from './entity-access'
import { INSTANCE_ACCESS_READ_KEYS, type InstanceAccessKey } from './instance-access'
import { Area, areaLevelFromKeys, Level, PermissionKey } from './registry'
import { MEMBER_BASELINE_LEVELS, SEAT_CEILINGS } from './seat-policy'

/**
 * Per-INSTANCE enforcement for the instance-access resources (datasets / KBs /
 * dashboards) — the composition half of plan 24 §B.4's deferred manual matrix.
 *
 * The def-level siblings (`capability-set-{view,edit,administer}.test.ts`) hand
 * `CapabilitySet` a pre-made `defAccess` map. These cases deliberately do not:
 * they start from the `ResourceAccess` rows a member's grantee union actually
 * returns, run them through `composeUserCapabilities`, and only then resolve the
 * gates — so a break anywhere along "row → blob → gate" fails here, which is the
 * path §B.4's UI round-trips exercise by hand.
 *
 * Both resolvers are asserted every time: the server's private
 * `CapabilitySet.effectiveInstanceLevel` and the client mirror
 * `entity-access.ts#effectiveInstanceLevel`, reached through the real wire
 * snapshot. They are two copies of one rule, and a UI that offers what the server
 * denies is the failure mode the mirror exists to prevent.
 */

interface MemberOpts {
  role?: OrganizationRole
  seatType?: SeatType
  /**
   * The bound profile's sparse levels. Defaults to the seeded Member baseline
   * (`datasets: Read`, `knowledgeBase: Edit`, `dashboards: Full`) so every case
   * below starts from a realistic org member rather than an invented level map.
   */
  profileLevels?: Partial<Record<Area, Level>>
  /**
   * The instance-level `ResourceAccess` rows that reach THIS member through their
   * grantee union (`user` + `role:org_member` + bound profile + groups) — i.e.
   * what `computeUserCapabilities`' second query returns for them.
   */
  rows?: Array<{
    /** The instance-access resource the row is for; defaults to `'dataset'`. */
    entityDefinitionId?: InstanceAccessKey
    entityInstanceId: string
    permission: ResourcePermission
  }>
  /**
   * The org-wide "has ≥1 instance row for anyone" set
   * (`restrictedInstanceIdsProvider`). Defaults to the instances in `rows`;
   * pass it explicitly for a member who is not a grantee of a row that exists.
   */
  restrictedInstances?: string[]
}

function member(opts: MemberOpts = {}) {
  const role = opts.role ?? 'USER'
  const seatType = opts.seatType ?? 'full'
  const caps = composeUserCapabilities({
    role,
    seatType,
    profileLevels: opts.profileLevels ?? MEMBER_BASELINE_LEVELS,
    typeAccessRows: [],
    instanceAccessRows: (opts.rows ?? []).map((row) => ({ entityDefinitionId: 'dataset', ...row })),
  })
  const restricted = new Set(
    opts.restrictedInstances ?? (opts.rows ?? []).map((r) => r.entityInstanceId)
  )
  const server = new CapabilitySet(
    new Set(caps.keys),
    caps.defAccess,
    role,
    seatType,
    (id) => id,
    new Set(),
    (id) => id,
    caps.instanceAccess,
    restricted,
    {},
    new Set(caps.instanceDerivedKeys)
  )
  // The client only ever sees the wire snapshot — build its view from that, not
  // from the composed blob, so a field dropped in serialization shows up here.
  return { caps, server, client: toResolvedRecordAccess(server.toClientCapabilities()) }
}

/** Assert the server gate and the client mirror agree, and return the answer. */
function levelFor(
  m: ReturnType<typeof member>,
  key: InstanceAccessKey,
  instanceId: string
): ResourcePermission | undefined {
  const client = effectiveInstanceLevel(m.client, key, instanceId)
  expect(m.server.canViewInstance(key, instanceId)).toBe(
    client !== undefined && client !== ResourcePermission.none
  )
  return client
}

describe('workspace baseline set to Restricted (plan 24 §B.4)', () => {
  it.each([
    ['dataset', Area.datasets],
    ['kb', Area.knowledgeBase],
  ] as const)('a Restricted %s is denied to an ordinary member at every rung', (key, area) => {
    // "Restricted" writes ONE row: `role:org_member @ none`. It reaches every
    // member through the ResourceAccess grantee union, so this IS what the
    // affected member composes.
    const m = member({ rows: [{ entityInstanceId: 'inst_locked', permission: 'none' }] })

    // The member's Layer-2 area level is untouched and open — the instance row
    // alone is what denies. (kb sits at Edit on the seeded baseline, so this
    // also proves a row beats a HIGHER area level, not just an equal one.)
    expect(m.server.areaLevel(area)).toBe(area === Area.datasets ? Level.Read : Level.Edit)

    expect(levelFor(m, key, 'inst_locked')).toBe(ResourcePermission.none)
    expect(m.server.canViewInstance(key, 'inst_locked')).toBe(false)
    expect(m.server.canEditInstance(key, 'inst_locked')).toBe(false)
    expect(m.server.canAdminInstance(key, 'inst_locked')).toBe(false)
    expect(() => m.server.assertViewInstance(key, 'inst_locked')).toThrow()
  })

  it('the restricted instance drops out of list filtering while its siblings stay', () => {
    // `dataset.list` / `kb.list` filter with the SAME predicate the detail route
    // asserts with, so "gone from the list" and "403 on the direct URL" are one
    // claim — this pins the list half against the exact filter the router runs.
    const m = member({ rows: [{ entityInstanceId: 'ds_locked', permission: 'none' }] })
    const listed = ['ds_open', 'ds_locked', 'ds_other'].filter((id) =>
      m.server.canViewInstance('dataset', id)
    )
    expect(listed).toEqual(['ds_open', 'ds_other'])
  })

  it('an explicit grant on a Restricted instance restores exactly that instance', () => {
    // The grantee composes BOTH rows (baseline none + their own grant); the real
    // grant outranks the marker, and nothing else about their access moves.
    const m = member({
      rows: [
        { entityInstanceId: 'ds_locked', permission: 'none' },
        { entityInstanceId: 'ds_locked', permission: 'edit' },
      ],
    })
    expect(levelFor(m, 'dataset', 'ds_locked')).toBe(ResourcePermission.edit)
    expect(m.server.canViewInstance('dataset', 'ds_locked')).toBe(true)
    expect(m.server.canEditInstance('dataset', 'ds_locked')).toBe(true)
    // `edit`, not `admin`: settings/delete stay closed (plan 24 §A.4's edit row).
    expect(m.server.canAdminInstance('dataset', 'ds_locked')).toBe(false)
  })

  it('a member who is not a grantee is denied even though the row set is not empty', () => {
    // The lockdown row exists org-wide (so the instance is in
    // `restrictedInstanceIds`) but this member's grantee union returns nothing
    // for it — absent entry must read as denial, never as "unrestricted".
    const m = member({ rows: [], restrictedInstances: ['ds_locked'] })
    expect(levelFor(m, 'dataset', 'ds_locked')).toBeUndefined()
    expect(m.server.canViewInstance('dataset', 'ds_locked')).toBe(false)
    // …while an instance with no row anywhere still falls back to the area level.
    expect(m.server.canViewInstance('dataset', 'ds_untouched')).toBe(true)
  })
})

describe('grantee-scoped instance grants (plan 24 §B.4)', () => {
  it('a grant raises the grantee above their area baseline on that instance only', () => {
    // Datasets sits at Read on the seeded Member baseline. An `admin` grant on
    // one dataset must carry that member all the way to the settings/delete rung
    // for it, and change nothing for the datasets they were not granted.
    const m = member({ rows: [{ entityInstanceId: 'ds_shared', permission: 'admin' }] })
    expect(m.caps.instanceAccess).toEqual({ ds_shared: 'admin' })

    expect(levelFor(m, 'dataset', 'ds_shared')).toBe(ResourcePermission.admin)
    expect(m.server.canAdminInstance('dataset', 'ds_shared')).toBe(true)

    expect(levelFor(m, 'dataset', 'ds_other')).toBe(ResourcePermission.view)
    expect(m.server.canEditInstance('dataset', 'ds_other')).toBe(false)
  })

  it('a grant can also LOWER a member on one instance (instance grants are not raise-only)', () => {
    // Area-level grantee overrides are Camp-1 raise-only; instance grants are
    // deliberately not (plan 24 §B.2.6). A `view` row under a `knowledgeBase:
    // Edit` baseline must actually take the write affordances away.
    const m = member({ rows: [{ entityInstanceId: 'kb_readonly', permission: 'view' }] })
    expect(m.server.areaLevel(Area.knowledgeBase)).toBe(Level.Edit)
    expect(levelFor(m, 'kb', 'kb_readonly')).toBe(ResourcePermission.view)
    expect(m.server.canViewInstance('kb', 'kb_readonly')).toBe(true)
    expect(m.server.canEditInstance('kb', 'kb_readonly')).toBe(false)
    // An untouched KB keeps the area's Edit rung.
    expect(m.server.canEditInstance('kb', 'kb_other')).toBe(true)
  })
})

describe('an instance grant under a closed area (plan 24 §B.2.8, flipped by plan 25 §2)', () => {
  it('takes effect anyway — an explicit row beats the area floor', () => {
    // Was the "dead grant" case: `effectiveInstanceLevel` short-circuited at
    // area None BEFORE consulting instance rows, so sharing to a sparse-profile
    // holder was a silent no-op and the only workaround was raising their
    // profile — which, under `baselineAtCreate: false`, hands them EVERY
    // dataset. Plan 25 §2 inverted it: most-specific-wins runs all the way down.
    const m = member({
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.datasets]: Level.None },
      rows: [{ entityInstanceId: 'ds_shared', permission: 'admin' }],
    })
    expect(levelFor(m, 'dataset', 'ds_shared')).toBe(ResourcePermission.admin)
    expect(m.server.canViewInstance('dataset', 'ds_shared')).toBe(true)

    // The grant is genuinely stored and the area is genuinely shut — the two
    // signals the server annotation (`forInstance.granteeAreaLevel`) is built
    // from. Their combination no longer means "inert"; only pairing a shut area
    // with an explicit `'none'` row does.
    expect(m.caps.instanceAccess).toEqual({ ds_shared: 'admin' })
    expect(m.server.areaLevel(Area.datasets)).toBe(Level.None)
  })

  it('but a member with NO row on that closed area still sees nothing', () => {
    // The load-bearing half: the flip must not turn a closed area into an open
    // one. Only instances someone deliberately authored a row for escape.
    const m = member({
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.datasets]: Level.None },
      rows: [{ entityInstanceId: 'ds_shared', permission: 'admin' }],
    })
    expect(levelFor(m, 'dataset', 'ds_untouched')).toBeUndefined()
    expect(m.server.canViewInstance('dataset', 'ds_untouched')).toBe(false)
  })

  it('an explicit `none` row on a closed area still denies', () => {
    const m = member({
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.datasets]: Level.None },
      rows: [{ entityInstanceId: 'ds_locked', permission: 'none' }],
    })
    expect(levelFor(m, 'dataset', 'ds_locked')).toBe(ResourcePermission.none)
    expect(m.server.canViewInstance('dataset', 'ds_locked')).toBe(false)
  })

  it('the same grant takes effect with the area open too', () => {
    // The other half of the lifecycle — without this the test above would pass
    // for a grant that never works at all.
    const m = member({ rows: [{ entityInstanceId: 'ds_shared', permission: 'admin' }] })
    expect(m.server.areaLevel(Area.datasets)).toBe(Level.Read)
    expect(levelFor(m, 'dataset', 'ds_shared')).toBe(ResourcePermission.admin)
  })

  it('an area closed only by the SEAT ceiling kills the grant too', () => {
    // A worker seat zeroes `datasets` regardless of the profile, and the ceiling
    // is applied last — an instance grant must not slip past a billing
    // invariant. Load-bearing since plan 25 §2: with the row now outranking the
    // AREA floor, the seat clamp had to become an explicit check in
    // `effectiveInstanceLevel` rather than riding on the seat-clamped key set.
    const m = member({
      seatType: 'worker',
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.datasets]: Level.Full },
      rows: [{ entityInstanceId: 'ds_shared', permission: 'admin' }],
    })
    expect(m.server.areaLevel(Area.datasets)).toBe(Level.None)
    expect(levelFor(m, 'dataset', 'ds_shared')).toBeUndefined()
  })
})

describe('instance-restricted ADMIN (plan 24 §B.2.7)', () => {
  /** An ADMIN on the seeded all-Full `admin` profile. */
  const admin = (opts: Omit<MemberOpts, 'role' | 'profileLevels'>) =>
    member({ ...opts, role: 'ADMIN', profileLevels: {} })

  it('loses an instance restricted to none, keeping every other instance', () => {
    const m = admin({ rows: [{ entityInstanceId: 'ds_locked', permission: 'none' }] })
    expect(m.server.areaLevel(Area.datasets)).toBe(Level.Full)
    expect(levelFor(m, 'dataset', 'ds_locked')).toBe(ResourcePermission.none)
    expect(m.server.canViewInstance('dataset', 'ds_locked')).toBe(false)
    // The share rows for that instance are therefore read-only: the editability
    // gate is `canAdminInstance` on the exact instance, not the area level.
    expect(m.server.canAdminInstance('dataset', 'ds_locked')).toBe(false)
    expect(m.server.canAdminInstance('dataset', 'ds_other')).toBe(true)
  })

  it('is held to a read-only instance grant instead of bypassing to admin', () => {
    const m = admin({ rows: [{ entityInstanceId: 'ds_readonly', permission: 'view' }] })
    expect(levelFor(m, 'dataset', 'ds_readonly')).toBe(ResourcePermission.view)
    expect(m.server.canViewInstance('dataset', 'ds_readonly')).toBe(true)
    expect(m.server.canEditInstance('dataset', 'ds_readonly')).toBe(false)
    expect(m.server.canAdminInstance('dataset', 'ds_readonly')).toBe(false)
  })
})

describe('OWNER regression (plan 24 §A.4)', () => {
  it('short-circuits to admin on an instance restricted to none', () => {
    // The §0.10 recovery guarantee: nothing authored on an instance can lock the
    // last owner out of the instance that would let them undo it.
    const m = member({
      role: 'OWNER',
      rows: [{ entityInstanceId: 'ds_locked', permission: 'none' }],
    })
    expect(levelFor(m, 'dataset', 'ds_locked')).toBe(ResourcePermission.admin)
    expect(m.server.canAdminInstance('dataset', 'ds_locked')).toBe(true)
    expect(m.server.canViewInstance('kb', 'kb_locked')).toBe(true)
  })

  it('short-circuits ahead of the row lookup entirely (private dashboard, no row)', () => {
    // `dashboard` is `baselineAtCreate: true`, so "no row" means no access for
    // everyone else — the branch OWNER must still skip.
    const owner = member({ role: 'OWNER', restrictedInstances: ['dash_private'] })
    const other = member({ restrictedInstances: ['dash_private'] })
    expect(levelFor(owner, 'dashboard', 'dash_private')).toBe(ResourcePermission.admin)
    expect(levelFor(other, 'dashboard', 'dash_private')).toBeUndefined()
  })
})

/**
 * The area Read rung DERIVED from instance grants (handoff item 5b) — the
 * replacement for `permissionProcedure`'s deleted type-blind waiver.
 *
 * Driven through the real composer into a real `CapabilitySet` and its wire
 * snapshot, because the whole point is behavioral: `can('<area>.view')` must
 * become true for a member whose only access is one shared instance, so the
 * sidebar / cmd+K / landing-page guards and the coarse procedure assert all stop
 * firing against them.
 *
 * The four properties that must hold together — take any one away and this is
 * either useless or a leak:
 *  1. a ≥`view` grant derives the Read rung, at any grant strength;
 *  2. it derives NOTHING above Read (those rungs front instance-LESS actions);
 *  3. it is TYPE-AWARE (a dashboard grant is not a workflows key);
 *  4. it does NOT change the member's AREA LEVEL — otherwise every row-less
 *     instance of a `baselineAtCreate: false` resource falls back to `view`.
 */
describe('the area Read rung derived from instance grants (item 5b)', () => {
  /** A member with the named area shut on their profile. */
  const closed = (area: Area, rows: MemberOpts['rows'], seatType?: SeatType) =>
    member({
      seatType,
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [area]: Level.None },
      rows,
    })

  it.each([
    'view',
    'edit',
    'admin',
  ] as const)('a `%s` grant on ONE dataset makes can(datasets.view) true with the area shut', (permission) => {
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_x', permission }])
    expect(m.server.can(PermissionKey.datasetsView)).toBe(true)
    expect(m.caps.instanceDerivedKeys).toEqual([PermissionKey.datasetsView])
    // The grant is real, not just a front door.
    expect(m.server.canViewInstance('dataset', 'ds_x')).toBe(true)
  })

  it('an `admin` grant derives the Read rung ONLY — never edit/manage', () => {
    // `datasetsManage` fronts dataset CREATION, which has no instance to assert
    // on. Deriving it from one shared instance would hand out org-wide authoring.
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_x', permission: 'admin' }])
    expect(m.server.can(PermissionKey.datasetsView)).toBe(true)
    expect(m.server.can(PermissionKey.datasetsEdit)).toBe(false)
    expect(m.server.can(PermissionKey.datasetsManage)).toBe(false)
  })

  it('an explicit `none` restriction derives NOTHING (a restriction is not a grant)', () => {
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_locked', permission: 'none' }])
    expect(m.caps.instanceDerivedKeys).toEqual([])
    expect(m.server.can(PermissionKey.datasetsView)).toBe(false)
  })

  it('no rows at all derives nothing', () => {
    expect(closed(Area.datasets, []).server.can(PermissionKey.datasetsView)).toBe(false)
  })

  it('is TYPE-AWARE: a dashboard grant does not open the workflows door', () => {
    // The looseness this replaces: dashboards are `baselineAtCreate: true`, so
    // EVERY dashboard writes a `role:org_member @ view` row at create. Under the
    // old type-blind waiver that made "holds an instance grant" true for
    // practically every member of every org, and the Read rung of all four
    // instance-access areas decorative.
    const m = member({
      profileLevels: {
        ...MEMBER_BASELINE_LEVELS,
        [Area.workflows]: Level.None,
        [Area.datasets]: Level.None,
        [Area.knowledgeBase]: Level.None,
      },
      rows: [{ entityDefinitionId: 'dashboard', entityInstanceId: 'dash_x', permission: 'view' }],
    })
    expect(m.caps.instanceDerivedKeys).toEqual([PermissionKey.dashboardsView])
    expect(m.server.can(PermissionKey.workflowsView)).toBe(false)
    expect(m.server.can(PermissionKey.datasetsView)).toBe(false)
    expect(m.server.can(PermissionKey.knowledgeBaseView)).toBe(false)
  })

  it('the SEAT CEILING still dominates — a worker seat derives nothing', () => {
    // `workflows`/`datasets` are outside WORKER_AREAS, so the ceiling shuts them
    // regardless of any grant. Without this check the member would hold a front
    // door key into an area every enforcement point then denies — a 403 maze.
    expect(SEAT_CEILINGS.worker[Area.datasets]).toBe(Level.None)
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_x', permission: 'admin' }], 'worker')
    expect(m.caps.instanceDerivedKeys).toEqual([])
    expect(m.server.can(PermissionKey.datasetsView)).toBe(false)
    expect(m.server.canViewInstance('dataset', 'ds_x')).toBe(false)
  })

  it('OWNER is unaffected — holds everything, derives nothing', () => {
    const m = member({ role: 'OWNER', rows: [{ entityInstanceId: 'ds_x', permission: 'view' }] })
    expect(m.caps.instanceDerivedKeys).toEqual([])
    expect(m.server.can(PermissionKey.datasetsView)).toBe(true)
    expect(m.server.can(PermissionKey.datasetsManage)).toBe(true)
  })

  it('THE LEAK GUARD: the derived key does NOT raise the area level', () => {
    // `areaLevelFromKeys` is the absent-row fallback `effectiveInstanceLevel` and
    // `instanceListScope` read. If the derived `datasets.view` were folded into
    // `keys`, the area would read `Level.Read` and — `dataset` being
    // `baselineAtCreate: false` — EVERY dataset in the org with no explicit row
    // would resolve to `view`. "Shared one dataset" would silently mean "can see
    // them all". This is the assertion that keeps the two key sets apart.
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_x', permission: 'admin' }])
    expect(m.server.areaLevel(Area.datasets)).toBe(Level.None)
    expect(areaLevelFromKeys(new Set(m.caps.keys), Area.datasets)).toBe(Level.None)
    expect(m.caps.keys).not.toContain(PermissionKey.datasetsView)
    // …and the row-less dataset stays invisible on BOTH resolvers.
    expect(levelFor(m, 'dataset', 'ds_someone_elses')).toBeUndefined()
    expect(m.server.instanceListScope('dataset')).toEqual({
      kind: 'include',
      includeIds: ['ds_x'],
    })
  })

  it('survives the wire round-trip and the client `can()` union rebuilds it', () => {
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_x', permission: 'view' }])
    const snapshot = m.server.toClientCapabilities()
    expect(snapshot.instanceDerivedKeys).toEqual([PermissionKey.datasetsView])
    // The client `can()` reads the union (capabilities-provider.tsx)…
    expect(
      new Set<string>([...snapshot.keys, ...(snapshot.instanceDerivedKeys ?? [])]).has(
        PermissionKey.datasetsView
      )
    ).toBe(true)
    // …while `toResolvedRecordAccess` keeps `keys` pure, so the client mirror of
    // the area fallback agrees with the server's.
    expect(m.client.keys.has(PermissionKey.datasetsView)).toBe(false)
  })

  it('the derived keys are exactly the Read rung of each instance-access area', () => {
    expect(INSTANCE_ACCESS_READ_KEYS).toEqual({
      dataset: [PermissionKey.datasetsView],
      kb: [PermissionKey.knowledgeBaseView],
      dashboard: [PermissionKey.dashboardsView],
      workflow: [PermissionKey.workflowsView],
      // `agent` joined the registry in 2026-07-28's agents slice. It is
      // non-empty precisely because `Area.agents` gained a `Level.Read` rung in
      // the same change — the derivation is "the area's Read rung or nothing",
      // so an instance-access area with no Read rung would land here as `[]`
      // and fail closed rather than confer a key it has no name for.
      agent: [PermissionKey.agentsView],
    })
  })
})
