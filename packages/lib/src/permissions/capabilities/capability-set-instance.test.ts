// packages/lib/src/permissions/capabilities/capability-set-instance.test.ts

import type { Rung } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { bucketInstanceGrantRows } from '../../resource-access/instance-grants'
import { CapabilitySet } from './capability-set'
import { composeUserCapabilities } from './compose-user-capabilities'
import {
  effectiveInstanceLevel,
  privateInstanceListScope,
  toResolvedRecordAccess,
} from './entity-access'
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
    rung: Rung
    /**
     * The grantee kind, which plan 43 §4.1 made load-bearing: `'role'` sorts the
     * row into the GATED baseline lane, anything else into the ungated individual
     * lane. Defaults to `'user'` — an individual grant — which reproduces this
     * harness's pre-plan-43 behaviour EXACTLY (every row used to land in the one
     * merged, ungated map), so any failure below is a real signal rather than a
     * harness artefact. Cases that specifically model the workspace baseline pass
     * `'role'`; the dedicated coverage lives in `area-baseline-gate.test.ts`.
     */
    granteeType?: string
  }>
  /**
   * The org-wide ROW-GOVERNED set (`governingInstanceIdsProvider`): instances
   * carrying a `role:org_member` baseline at any rung, or any `none`
   * marker. Defaults to the instances in `rows`, which is right for every case
   * below that authors a baseline or a restriction; pass it explicitly for a
   * member who is not a grantee of a governing row that exists.
   *
   * **It is NOT "has ≥1 row for anyone" any more** (2026-07-29): sharing an
   * instance no longer restricts it, and a lone creator `user @ admin` row does
   * not govern. See `instance-sharing-vs-restriction.test.ts`, which builds its
   * set from real rows through the shared `isGoverningInstanceRow` predicate
   * rather than naming ids the way this older harness does.
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
    instanceGrants: bucketInstanceGrantRows(
      (opts.rows ?? []).map((row) => ({
        entityDefinitionId: 'dataset',
        granteeType: 'user',
        granteeId: 'usr_x',
        ...row,
      }))
    ),
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
    new Set(caps.instanceDerivedKeys),
    caps.baselineInstanceAccess
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
): Rung | undefined {
  const client = effectiveInstanceLevel(m.client, key, instanceId)
  expect(m.server.canViewInstance(key, instanceId)).toBe(client !== undefined && client !== 'none')
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
    const m = member({ rows: [{ entityInstanceId: 'inst_locked', rung: 'none' }] })

    // The member's Layer-2 area level is untouched and open — the instance row
    // alone is what denies. (kb sits at Edit on the seeded baseline, so this
    // also proves a row beats a HIGHER area level, not just an equal one.)
    expect(m.server.areaLevel(area)).toBe(area === Area.datasets ? Level.Read : Level.Edit)

    expect(levelFor(m, key, 'inst_locked')).toBe('none')
    expect(m.server.canViewInstance(key, 'inst_locked')).toBe(false)
    expect(m.server.canEditInstance(key, 'inst_locked')).toBe(false)
    expect(m.server.canAdminInstance(key, 'inst_locked')).toBe(false)
    expect(() => m.server.assertViewInstance(key, 'inst_locked')).toThrow()
  })

  it('the restricted instance drops out of list filtering while its siblings stay', () => {
    // `dataset.list` / `kb.list` filter with the SAME predicate the detail route
    // asserts with, so "gone from the list" and "403 on the direct URL" are one
    // claim — this pins the list half against the exact filter the router runs.
    const m = member({ rows: [{ entityInstanceId: 'ds_locked', rung: 'none' }] })
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
        { entityInstanceId: 'ds_locked', rung: 'none' },
        { entityInstanceId: 'ds_locked', rung: 'edit' },
      ],
    })
    expect(levelFor(m, 'dataset', 'ds_locked')).toBe('edit')
    expect(m.server.canViewInstance('dataset', 'ds_locked')).toBe(true)
    expect(m.server.canEditInstance('dataset', 'ds_locked')).toBe(true)
    // `edit`, not `admin`: settings/delete stay closed (plan 24 §A.4's edit row).
    expect(m.server.canAdminInstance('dataset', 'ds_locked')).toBe(false)
  })

  it('a member who is not a grantee is denied even though the row set is not empty', () => {
    // The lockdown row exists org-wide (a `role:org_member @ none`, so the
    // instance is in `governingInstanceIds`) but this member's grantee union
    // returns nothing
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
    const m = member({ rows: [{ entityInstanceId: 'ds_shared', rung: 'admin' }] })
    expect(m.caps.instanceAccess).toEqual({ ds_shared: 'admin' })

    expect(levelFor(m, 'dataset', 'ds_shared')).toBe('admin')
    expect(m.server.canAdminInstance('dataset', 'ds_shared')).toBe(true)

    expect(levelFor(m, 'dataset', 'ds_other')).toBe('read')
    expect(m.server.canEditInstance('dataset', 'ds_other')).toBe(false)
  })

  it('a grant can also LOWER a member on one instance (instance grants are not raise-only)', () => {
    // Area-level grantee overrides are Camp-1 raise-only; instance grants are
    // deliberately not (plan 24 §B.2.6). A `view` row under a `knowledgeBase:
    // Edit` baseline must actually take the write affordances away.
    const m = member({ rows: [{ entityInstanceId: 'kb_readonly', rung: 'read' }] })
    expect(m.server.areaLevel(Area.knowledgeBase)).toBe(Level.Edit)
    expect(levelFor(m, 'kb', 'kb_readonly')).toBe('read')
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
      rows: [{ entityInstanceId: 'ds_shared', rung: 'admin' }],
    })
    expect(levelFor(m, 'dataset', 'ds_shared')).toBe('admin')
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
      rows: [{ entityInstanceId: 'ds_shared', rung: 'admin' }],
    })
    expect(levelFor(m, 'dataset', 'ds_untouched')).toBeUndefined()
    expect(m.server.canViewInstance('dataset', 'ds_untouched')).toBe(false)
  })

  it('an explicit `none` row on a closed area still denies', () => {
    const m = member({
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.datasets]: Level.None },
      rows: [{ entityInstanceId: 'ds_locked', rung: 'none' }],
    })
    expect(levelFor(m, 'dataset', 'ds_locked')).toBe('none')
    expect(m.server.canViewInstance('dataset', 'ds_locked')).toBe(false)
  })

  it('the same grant takes effect with the area open too', () => {
    // The other half of the lifecycle — without this the test above would pass
    // for a grant that never works at all.
    const m = member({ rows: [{ entityInstanceId: 'ds_shared', rung: 'admin' }] })
    expect(m.server.areaLevel(Area.datasets)).toBe(Level.Read)
    expect(levelFor(m, 'dataset', 'ds_shared')).toBe('admin')
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
      rows: [{ entityInstanceId: 'ds_shared', rung: 'admin' }],
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
    const m = admin({ rows: [{ entityInstanceId: 'ds_locked', rung: 'none' }] })
    expect(m.server.areaLevel(Area.datasets)).toBe(Level.Full)
    expect(levelFor(m, 'dataset', 'ds_locked')).toBe('none')
    expect(m.server.canViewInstance('dataset', 'ds_locked')).toBe(false)
    // The share rows for that instance are therefore read-only: the editability
    // gate is `canAdminInstance` on the exact instance, not the area level.
    expect(m.server.canAdminInstance('dataset', 'ds_locked')).toBe(false)
    expect(m.server.canAdminInstance('dataset', 'ds_other')).toBe(true)
  })

  it('is held to a read-only instance grant instead of bypassing to admin', () => {
    const m = admin({ rows: [{ entityInstanceId: 'ds_readonly', rung: 'read' }] })
    expect(levelFor(m, 'dataset', 'ds_readonly')).toBe('read')
    expect(m.server.canViewInstance('dataset', 'ds_readonly')).toBe(true)
    expect(m.server.canEditInstance('dataset', 'ds_readonly')).toBe(false)
    expect(m.server.canAdminInstance('dataset', 'ds_readonly')).toBe(false)
  })
})

describe('OWNER regression (plan 24 §A.4)', () => {
  it('short-circuits to admin on an ORG-SHARED instance restricted to none', () => {
    // The §0.10 recovery guarantee, on the resources it still covers: nothing
    // authored on an org-shared instance can lock the last owner out of the
    // instance that would let them undo it.
    const m = member({
      role: 'OWNER',
      rows: [{ entityInstanceId: 'ds_locked', rung: 'none' }],
    })
    expect(levelFor(m, 'dataset', 'ds_locked')).toBe('admin')
    expect(m.server.canAdminInstance('dataset', 'ds_locked')).toBe(true)
    expect(m.server.canViewInstance('kb', 'kb_locked')).toBe(true)
  })

  it('does NOT short-circuit on a private resource (dashboard, no row)', () => {
    // User decision 2026-07-28 (plan 36 §0.6 revised): the bypass is scoped to
    // `baselineAtCreate: false`. §0.10 protects an owner's ability to repair a
    // mis-shaped PROFILE — being locked out of someone else's private content
    // does not threaten that, so the bypass has nothing to do here.
    const owner = member({ role: 'OWNER', restrictedInstances: ['dash_private'] })
    const other = member({ restrictedInstances: ['dash_private'] })
    expect(levelFor(owner, 'dashboard', 'dash_private')).toBeUndefined()
    expect(levelFor(other, 'dashboard', 'dash_private')).toBeUndefined()
  })

  it('keeps admin on a private instance it holds a row on — the no-self-lock half', () => {
    // Why removing the bypass is safe rather than a self-lock: every
    // `baselineAtCreate: true` resource writes its author an `admin` row at
    // create, `composeUserCapabilities`'s OWNER branch returns `instanceAccess`
    // unchanged, and own-row-first reads it before anything else. So an owner
    // reaches their OWN content through the ordinary row path.
    const owner = member({
      role: 'OWNER',
      rows: [{ entityDefinitionId: 'dashboard', entityInstanceId: 'dash_mine', rung: 'admin' }],
      restrictedInstances: ['dash_mine', 'dash_theirs'],
    })
    expect(levelFor(owner, 'dashboard', 'dash_mine')).toBe('admin')
    expect(owner.server.canAdminInstance('dashboard', 'dash_mine')).toBe(true)
    // ...and only their own.
    expect(levelFor(owner, 'dashboard', 'dash_theirs')).toBeUndefined()
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
    'read',
    'edit',
    'admin',
  ] as const)('a `%s` grant on ONE dataset makes can(datasets.view) true with the area shut', (rung) => {
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_x', rung }])
    expect(m.server.can(PermissionKey.datasetsView)).toBe(true)
    expect(m.caps.instanceDerivedKeys).toEqual([PermissionKey.datasetsView])
    // The grant is real, not just a front door.
    expect(m.server.canViewInstance('dataset', 'ds_x')).toBe(true)
  })

  it('an `admin` grant derives the Read rung ONLY — never edit/manage', () => {
    // `datasetsManage` fronts dataset CREATION, which has no instance to assert
    // on. Deriving it from one shared instance would hand out org-wide authoring.
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_x', rung: 'admin' }])
    expect(m.server.can(PermissionKey.datasetsView)).toBe(true)
    expect(m.server.can(PermissionKey.datasetsEdit)).toBe(false)
    expect(m.server.can(PermissionKey.datasetsManage)).toBe(false)
  })

  it('an explicit `none` restriction derives NOTHING (a restriction is not a grant)', () => {
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_locked', rung: 'none' }])
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
      rows: [{ entityDefinitionId: 'dashboard', entityInstanceId: 'dash_x', rung: 'read' }],
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
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_x', rung: 'admin' }], 'worker')
    expect(m.caps.instanceDerivedKeys).toEqual([])
    expect(m.server.can(PermissionKey.datasetsView)).toBe(false)
    expect(m.server.canViewInstance('dataset', 'ds_x')).toBe(false)
  })

  it('OWNER is unaffected — holds everything, derives nothing', () => {
    const m = member({ role: 'OWNER', rows: [{ entityInstanceId: 'ds_x', rung: 'read' }] })
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
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_x', rung: 'admin' }])
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
    const m = closed(Area.datasets, [{ entityInstanceId: 'ds_x', rung: 'read' }])
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

  it('a `view` grant on a PRIVATE resource derives its Read rung too', () => {
    // The derivation matters more for `signature`/`snippet` than for anything
    // else in the registry: `instanceFallbackLevel` returns `undefined` for a
    // `baselineAtCreate: true` resource, so a member whose entire access is one
    // share has NO other route to the coarse front door (nav, cmd+K, a landing
    // guard). Without this they would be shown nothing while holding a real,
    // enforceable grant.
    const m = member({
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.snippets]: Level.None },
      rows: [{ entityDefinitionId: 'snippet', entityInstanceId: 'snip_shared', rung: 'read' }],
    })
    expect(m.caps.instanceDerivedKeys).toEqual([PermissionKey.snippetsView])
    expect(m.server.can(PermissionKey.snippetsView)).toBe(true)
    // …and it stops at Read. `snippetsManage` fronts snippet CREATION and every
    // FOLDER mutation (plan 36 §6.3 — the live bug that slice fixed). Deriving
    // it from one share would hand a share recipient the org-wide folder tree.
    expect(m.server.can(PermissionKey.snippetsEdit)).toBe(false)
    expect(m.server.can(PermissionKey.snippetsManage)).toBe(false)
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
      // `signature` / `snippet` joined in 2026-07-28's plan 36 slice, each with
      // its own three-rung area. Both are `baselineAtCreate: true`, so the
      // derived Read key is the ONLY thing that opens their coarse front door
      // for a member whose access is a single share — the area fallback cannot,
      // by construction (`instanceFallbackLevel` returns `undefined`).
      signature: [PermissionKey.signaturesView],
      snippet: [PermissionKey.snippetsView],
      // `inbox` / `personal_inbox` joined in plan 40 phase 1. They are the first
      // pair of keys to SHARE an area, so both derive the same key — the map is
      // keyed by RESOURCE, not by area, and that is what keeps an inbox share
      // from conferring anything a personal-mailbox share would not, and vice
      // versa. `Area.inboxes` has only Read and Full rungs (no `Edit`), so the
      // Read rung is `inboxes.view` for both.
      inbox: [PermissionKey.inboxesView],
      personal_inbox: [PermissionKey.inboxesView],
    })
  })
})

/**
 * Plan 36 — the `baselineAtCreate: **true**` arm, for the two resources that
 * joined `INSTANCE_ACCESS_RESOURCES` with the PRIVATE posture: `signature` and
 * `snippet`. Everything above this point covers `baselineAtCreate: false`
 * (`dataset`, `kb`), where an absent row falls back to the member's AREA level;
 * here an absent row means **no access at all**, and the area level buys only the
 * instance-LESS action (create).
 *
 * That inversion is the whole slice, so each of the four decisions it rests on is
 * pinned separately rather than as one composite case:
 *  - §0.2 absent row ⇒ no access, even at the area's `Full` rung;
 *  - §2.1 an explicit row still beats an area shut to `None`;
 *  - §0.5 a WORKER seat is denied even on an instance it owns outright;
 *  - §0.6 an org ADMIN gets no override on another member's private instance.
 *
 * Both resources are asserted every time. They are configured identically today,
 * and a case written for only one would not notice the two drifting apart —
 * which is exactly what "an org can open snippets while locking signatures down"
 * (plan 36 §0.1) invites someone to try.
 */
describe('private (`baselineAtCreate: true`) resources — signatures + snippets (plan 36)', () => {
  /** `[instance-access key, its area, an instance id owned by SOMEONE ELSE]`. */
  const PRIVATE = [
    ['signature', Area.signatures, 'sig_theirs'],
    ['snippet', Area.snippets, 'snip_theirs'],
  ] as const

  it.each(PRIVATE)('%s: an absent row denies even at the area’s Full rung (§0.2)', (key, area) => {
    // `signatures`/`snippets` are BOTH `Level.Full` on the seeded Member
    // baseline, so this member has the maximum area level the product offers and
    // still cannot see an instance nobody granted them.
    const m = member()
    expect(MEMBER_BASELINE_LEVELS[area]).toBe(Level.Full)
    expect(m.server.areaLevel(area)).toBe(Level.Full)

    expect(levelFor(m, key, 'inst_rowless')).toBeUndefined()
    expect(m.server.canViewInstance(key, 'inst_rowless')).toBe(false)
    expect(m.server.canEditInstance(key, 'inst_rowless')).toBe(false)
    expect(m.server.canAdminInstance(key, 'inst_rowless')).toBe(false)
    expect(() => m.server.assertViewInstance(key, 'inst_rowless')).toThrow()

    // The contrast that proves this is the POSTURE and not a blanket denial: the
    // very same member, at a LOWER area level (`datasets: Read`), can view a
    // row-less dataset — because `dataset` is `baselineAtCreate: false`.
    expect(m.server.areaLevel(Area.datasets)).toBe(Level.Read)
    expect(m.server.canViewInstance('dataset', 'ds_rowless')).toBe(true)
  })

  it.each(PRIVATE)('%s: a row that exists for SOMEONE ELSE reads as denial', (key, _area, id) => {
    // Both denial paths, because the 2026-07-29 narrowing changed WHICH one runs
    // and the old fixture claimed a set membership the provider can no longer
    // produce ("the instance is in the set because its owner holds an `admin`
    // row" — a lone creator row does not govern).
    //
    // Path 1, the reachable governing case: somebody authored a restriction, so
    // the org-wide set denies a member whose grantee union returns nothing.
    const governed = member({ rows: [], restrictedInstances: [id] })
    expect(levelFor(governed, key, id)).toBeUndefined()
    expect(governed.server.canViewInstance(key, id)).toBe(false)

    // Path 2, what an owner-only `admin` row actually looks like now: NOT in the
    // governing set, so the denial comes from `baselineAtCreate: true` — no row
    // of my own ⇒ `instanceFallbackLevel` returns `undefined`. Same answer, and
    // it must stay the same answer, which is why both are pinned.
    const unshared = member({ rows: [], restrictedInstances: [] })
    expect(levelFor(unshared, key, id)).toBeUndefined()
    expect(unshared.server.canViewInstance(key, id)).toBe(false)
  })

  it.each(PRIVATE)('%s: an explicit row beats an area shut to None (§2.1)', (key, area) => {
    // Sharing has to work for a member whose profile closes the area entirely —
    // otherwise the only way to share one signature is to open the whole area,
    // which under this posture still shows them nothing else, so the grant would
    // simply be inert.
    const m = member({
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [area]: Level.None },
      rows: [{ entityDefinitionId: key, entityInstanceId: 'inst_shared', rung: 'edit' }],
    })
    expect(m.server.areaLevel(area)).toBe(Level.None)

    expect(levelFor(m, key, 'inst_shared')).toBe('edit')
    expect(m.server.canViewInstance(key, 'inst_shared')).toBe(true)
    expect(m.server.canEditInstance(key, 'inst_shared')).toBe(true)
    // `edit`, not `admin`: delete and re-share stay closed.
    expect(m.server.canAdminInstance(key, 'inst_shared')).toBe(false)
    // …and nothing else in that area opened up.
    expect(levelFor(m, key, 'inst_other')).toBeUndefined()
  })

  it.each(PRIVATE)('%s: an explicit `none` row denies under an open area too', (key) => {
    const m = member({
      rows: [{ entityDefinitionId: key, entityInstanceId: 'inst_locked', rung: 'none' }],
    })
    expect(levelFor(m, key, 'inst_locked')).toBe('none')
    expect(m.server.canViewInstance(key, 'inst_locked')).toBe(false)
  })

  it.each(PRIVATE)('%s: a worker seat is denied on an instance it OWNS (§0.5)', (key, area) => {
    // The sharpest consequence of leaving both areas out of `WORKER_AREAS`: the
    // seat ceiling is checked ABOVE the explicit-row branch, so an `admin` row
    // the field tech holds on content they authored themselves buys nothing.
    // Stated in `seat-policy.ts` as intended; pinned here so nobody "fixes" it.
    expect(SEAT_CEILINGS.worker[area]).toBe(Level.None)
    const m = member({
      seatType: 'worker',
      rows: [{ entityDefinitionId: key, entityInstanceId: 'inst_mine', rung: 'admin' }],
    })
    expect(levelFor(m, key, 'inst_mine')).toBeUndefined()
    expect(m.server.canViewInstance(key, 'inst_mine')).toBe(false)
    expect(m.server.canAdminInstance(key, 'inst_mine')).toBe(false)
    // The row really is composed — it is the CEILING doing the denying, not an
    // empty grant map that would make this test vacuous.
    expect(m.caps.instanceAccess).toEqual({ inst_mine: 'admin' })
  })

  it.each(
    PRIVATE
  )('%s: neither an org ADMIN nor an OWNER gets an override (§0.6)', (key, area, id) => {
    // Deliberate, and deliberately the surprising one: on the seeded all-`Full`
    // admin profile the area reads `Full`, and for `dataset`/`kb` that fallback
    // would hand them the instance. Under `baselineAtCreate: true` there is no
    // fallback to ride — so a member's private signature is invisible to their
    // admin.
    const admin = member({ role: 'ADMIN', profileLevels: {}, restrictedInstances: [id] })
    expect(admin.server.areaLevel(area)).toBe(Level.Full)
    expect(levelFor(admin, key, id)).toBeUndefined()
    expect(admin.server.canViewInstance(key, id)).toBe(false)
    expect(admin.server.canAdminInstance(key, id)).toBe(false)

    // And OWNER is no longer the exception (user decision 2026-07-28, §0.6
    // revised): the §0.10 bypass is scoped to `baselineAtCreate: false`, so
    // personal content is invisible to org ownership too.
    const owner = member({ role: 'OWNER', restrictedInstances: [id] })
    expect(owner.server.areaLevel(area)).toBe(Level.Full)
    expect(levelFor(owner, key, id)).toBeUndefined()
    expect(owner.server.canViewInstance(key, id)).toBe(false)
    expect(owner.server.canAdminInstance(key, id)).toBe(false)
  })

  it.each(PRIVATE)('%s: an OWNER still reaches content they own', (key) => {
    // The control for the case above — without it that test would also pass
    // against a resource nobody can reach at all. The author's `admin` row is
    // written at create, and it resolves through the ordinary row path.
    const owner = member({
      role: 'OWNER',
      rows: [{ entityDefinitionId: key, entityInstanceId: 'inst_mine', rung: 'admin' }],
    })
    expect(levelFor(owner, key, 'inst_mine')).toBe('admin')
    expect(owner.server.canAdminInstance(key, 'inst_mine')).toBe(true)
  })
})

/**
 * `privateInstanceListScope` — the LIST twin of `canViewInstance` for the
 * `baselineAtCreate: true` resources (plan 36 §6.1), and the only list helper
 * their routers may call: `instanceListScope` is narrowed to
 * `OrgSharedInstanceAccessKey`, so passing `'snippet'` to it is a COMPILE error
 * by construction.
 *
 * The property under test is that it reproduces `effectiveInstanceLevel` at the
 * `view` rung for every id at once. If the two disagree the member gets an empty
 * list for an instance whose detail route opens fine, or — the direction that
 * actually leaks — a listed row the detail route then 403s on.
 */
describe('privateInstanceListScope (plan 36 §6.1)', () => {
  const PRIVATE = ['signature', 'snippet'] as const

  it.each(PRIVATE)('%s: OWNER is filtered like anyone else — no exclusion arm', (key) => {
    // User decision 2026-07-28 (§0.6 revised). Every key this function accepts
    // is `baselineAtCreate: true` BY TYPE, so there is no owner branch left to
    // reach: an owner with no rows lists nothing, and an owner WITH a row lists
    // exactly that row. The result is always an allow-list.
    expect(privateInstanceListScope(member({ role: 'OWNER' }).client, key)).toEqual({
      kind: 'none',
    })

    const owner = member({
      role: 'OWNER',
      rows: [
        { entityDefinitionId: key, entityInstanceId: 'inst_mine', rung: 'admin' },
        // Someone else's private instance — in the ORG-wide restricted set, but
        // carrying no row for this owner.
      ],
      restrictedInstances: ['inst_mine', 'inst_theirs'],
    })
    expect(privateInstanceListScope(owner.client, key)).toEqual({
      kind: 'include',
      includeIds: ['inst_mine'],
    })
  })

  it.each(PRIVATE)('%s: a worker seat gets `none` — no query at all (§0.5)', (key) => {
    const m = member({
      seatType: 'worker',
      rows: [{ entityDefinitionId: key, entityInstanceId: 'inst_mine', rung: 'admin' }],
    })
    expect(privateInstanceListScope(m.client, key)).toEqual({ kind: 'none' })
  })

  it.each(PRIVATE)('%s: names ONLY the rows that reach `view`', (key) => {
    const m = member({
      rows: [
        { entityDefinitionId: key, entityInstanceId: 'inst_view', rung: 'read' },
        { entityDefinitionId: key, entityInstanceId: 'inst_admin', rung: 'admin' },
        { entityDefinitionId: key, entityInstanceId: 'inst_none', rung: 'none' },
      ],
    })
    const scope = privateInstanceListScope(m.client, key)
    expect(scope.kind).toBe('include')
    expect([...(scope.includeIds ?? [])].sort()).toEqual(['inst_admin', 'inst_view'])
  })

  it.each(PRIVATE)('%s: no qualifying row at all collapses to `none`', (key) => {
    const m = member({
      rows: [{ entityDefinitionId: key, entityInstanceId: 'inst_none', rung: 'none' }],
    })
    expect(privateInstanceListScope(m.client, key)).toEqual({ kind: 'none' })
  })

  it.each(PRIVATE)('%s: deliberately does NOT consult the area level', (key) => {
    // Mirrors `effectiveInstanceLevel`, which never reads the area for a
    // row-bearing instance. Both directions are load-bearing:
    //  - area at `Full` with no rows must still be `none`, or every private
    //    instance in the org lands in the list;
    //  - area at `None` with one row must still name it, or a share to a
    //    sparse-profile member is inert in the list while the detail route
    //    honours it.
    const area = key === 'signature' ? Area.signatures : Area.snippets

    const open = member()
    expect(open.server.areaLevel(area)).toBe(Level.Full)
    expect(privateInstanceListScope(open.client, key)).toEqual({ kind: 'none' })

    const shut = member({
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [area]: Level.None },
      rows: [{ entityDefinitionId: key, entityInstanceId: 'inst_shared', rung: 'read' }],
    })
    expect(shut.server.areaLevel(area)).toBe(Level.None)
    expect(privateInstanceListScope(shut.client, key)).toEqual({
      kind: 'include',
      includeIds: ['inst_shared'],
    })
  })

  it.each(PRIVATE)('%s: agrees with canViewInstance id by id', (key) => {
    // The consistency claim itself, rather than a restatement of either side:
    // resolve a mixed set both ways and require the same answer for every id,
    // INCLUDING ids the org holds no row for (which only the id-at-a-time
    // resolver is asked about, and which the allow-list must therefore omit).
    const m = member({
      rows: [
        { entityDefinitionId: key, entityInstanceId: 'inst_view', rung: 'read' },
        { entityDefinitionId: key, entityInstanceId: 'inst_none', rung: 'none' },
      ],
      restrictedInstances: ['inst_view', 'inst_none', 'inst_theirs'],
    })
    const ids = ['inst_view', 'inst_none', 'inst_theirs', 'inst_rowless']
    const scope = privateInstanceListScope(m.client, key)
    const listed = new Set(scope.kind === 'include' ? scope.includeIds : [])

    expect(ids.filter((id) => m.server.canViewInstance(key, id))).toEqual(['inst_view'])
    expect(ids.filter((id) => listed.has(id))).toEqual(['inst_view'])
  })
})
