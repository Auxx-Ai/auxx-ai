// packages/lib/src/permissions/capabilities/capability-set-workflow-instance.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { CapabilitySet } from './capability-set'
import { composeUserCapabilities } from './compose-user-capabilities'
import { effectiveInstanceLevel, toResolvedRecordAccess } from './entity-access'
import { INSTANCE_ACCESS_RESOURCES } from './instance-access'
import { Area, Level, PermissionKey } from './registry'
import { MEMBER_BASELINE_LEVELS } from './seat-policy'

/**
 * Plan 30's composition half — `workflow` as an
 * {@link INSTANCE_ACCESS_RESOURCES} key, and the three `Area.workflows` rungs
 * that had to exist first.
 *
 * The sibling `capability-set-instance.test.ts` covers the shared machinery on
 * datasets/KBs/dashboards. What is workflow-SPECIFIC and pinned here:
 *  - **`baselineAtCreate: false`** — a workflow with no `ResourceAccess` row
 *    falls back to the AREA level, the opposite of dashboards. Asserted as a
 *    side-by-side contrast on ONE member, so the two configs can't silently
 *    converge.
 *  - **The Read/Edit rungs are real.** On the old single-rung ladder
 *    (`Full → workflowsManage` only) that fallback could only ever be `none` or
 *    `admin`, which would have made the per-instance view/edit tiers decorative.
 *  - **Worker seats compose `workflows: None`** and therefore cannot run a
 *    manual workflow — a deliberate decision (user, 2026-07-27, plan 30 §8
 *    item 1), pinned so that adding `Area.workflows` to `WORKER_AREAS` breaks a
 *    test rather than quietly changing seat semantics.
 *
 * Rows go through the real `composeUserCapabilities`, and every case asserts the
 * server gate AND the client mirror (reached through the wire snapshot) agree —
 * a UI that offers what the server denies is the failure the mirror prevents.
 */

interface MemberOpts {
  role?: OrganizationRole
  seatType?: SeatType
  profileLevels?: Partial<Record<Area, Level>>
  /** `entityDefinitionId` defaults to `'workflow'` — the resource under test here. */
  rows?: Array<{
    entityDefinitionId?: string
    entityInstanceId: string
    permission: ResourcePermission
    /**
     * Grantee kind (plan 43 §4.1). Defaults to `'user'` — the individual lane —
     * which reproduces this harness's pre-plan-43 behaviour exactly. Pass
     * `'role'` to model the workspace baseline.
     */
    granteeType?: string
  }>
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
    instanceAccessRows: (opts.rows ?? []).map((row) => ({
      entityDefinitionId: 'workflow',
      granteeType: 'user',
      ...row,
    })),
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
  return { caps, server, client: toResolvedRecordAccess(server.toClientCapabilities()) }
}

/** Assert the server gate and the client mirror agree, and return the answer. */
function levelFor(
  m: ReturnType<typeof member>,
  key: 'workflow' | 'dashboard' | 'dataset',
  instanceId: string
): ResourcePermission | undefined {
  const client = effectiveInstanceLevel(m.client, key, instanceId)
  expect(m.server.canViewInstance(key, instanceId)).toBe(
    client !== undefined && client !== ResourcePermission.none
  )
  return client
}

describe('workflow registry entry (plan 30 §3)', () => {
  it('is org-shared by default and keyed on the workflows area', () => {
    // Two literals the whole slice rests on: flip `baselineAtCreate` to `true`
    // and every existing workflow disappears for everyone but its creator (with
    // no backfill migration written); point `area` elsewhere and the rungs stop
    // gating it.
    expect(INSTANCE_ACCESS_RESOURCES.workflow).toEqual({
      baselineAtCreate: false,
      area: Area.workflows,
    })
  })
})

describe('the Area.workflows ladder (plan 30 §1)', () => {
  it.each([
    [Level.None, [] as PermissionKey[]],
    [Level.Read, [PermissionKey.workflowsView]],
    [Level.Edit, [PermissionKey.workflowsView, PermissionKey.workflowsEdit]],
    [
      Level.Full,
      [PermissionKey.workflowsView, PermissionKey.workflowsEdit, PermissionKey.workflowsManage],
    ],
  ])('level %i composes exactly its rungs (cumulative, not exclusive)', (level, expected) => {
    const m = member({ profileLevels: { [Area.workflows]: level } })
    const held = [
      PermissionKey.workflowsView,
      PermissionKey.workflowsEdit,
      PermissionKey.workflowsManage,
    ].filter((k) => m.server.can(k))
    expect(held).toEqual(expected)
    expect(m.server.areaLevel(Area.workflows)).toBe(level)
  })

  it.each([
    [Level.Read, ResourcePermission.view],
    [Level.Edit, ResourcePermission.edit],
    [Level.Full, ResourcePermission.admin],
  ])('level %i is the absent-row fallback for a workflow', (level, permission) => {
    // THE reason §1 could not be skipped: with `baselineAtCreate: false` the
    // no-row answer IS the area level, so a single-rung area could only ever
    // answer `undefined` or `admin`.
    const m = member({ profileLevels: { [Area.workflows]: level } })
    expect(levelFor(m, 'workflow', 'wf_unrestricted')).toBe(permission)
  })

  it('area None denies a workflow with NO row, but an explicit row overrides it', () => {
    const m = member({
      profileLevels: { [Area.workflows]: Level.None },
      rows: [{ entityInstanceId: 'wf_shared', permission: 'admin' }],
    })
    // Fail-closed for the unshared majority — the load-bearing half.
    expect(levelFor(m, 'workflow', 'wf_unrestricted')).toBeUndefined()
    // …and the grant is LIVE (plan 25 §2, flipped from plan 24 §B.2.8's dead
    // grant): most-specific-wins runs all the way down, so "no workflows except
    // this one" is expressible at last.
    expect(m.caps.instanceAccess).toEqual({ wf_shared: 'admin' })
    expect(levelFor(m, 'workflow', 'wf_shared')).toBe(ResourcePermission.admin)
  })
})

describe('`baselineAtCreate: false` — the deliberate opposite of dashboards', () => {
  it('one member, no rows anywhere: the workflow is shared, the dashboard is not', () => {
    // The seeded Member baseline holds BOTH areas at Full, so the only thing
    // separating these two answers is the registry's `baselineAtCreate` flag.
    const m = member()
    expect(m.server.areaLevel(Area.workflows)).toBe(Level.Full)
    expect(m.server.areaLevel(Area.dashboards)).toBe(Level.Full)

    expect(levelFor(m, 'workflow', 'wf_never_shared')).toBe(ResourcePermission.admin)
    expect(levelFor(m, 'dashboard', 'dash_never_shared')).toBeUndefined()
  })

  it('a member who is not a grantee of an EXISTING row is denied that workflow', () => {
    // Once any row exists for a workflow, the instance is in
    // `governingInstanceIds` and the fallback is skipped — absent entry reads
    // as denial, never as "unrestricted". This is what makes Restricted work at
    // all under `baselineAtCreate: false`.
    const m = member({ rows: [], restrictedInstances: ['wf_locked'] })
    expect(levelFor(m, 'workflow', 'wf_locked')).toBeUndefined()
    expect(levelFor(m, 'workflow', 'wf_untouched')).toBe(ResourcePermission.admin)
  })
})

describe('restricting one workflow (plan 30 §7 — the `none` member)', () => {
  it('a `role:org_member @ none` row denies it at every rung while siblings stay open', () => {
    const m = member({ rows: [{ entityInstanceId: 'wf_locked', permission: 'none' }] })
    expect(m.server.areaLevel(Area.workflows)).toBe(Level.Full)

    expect(levelFor(m, 'workflow', 'wf_locked')).toBe(ResourcePermission.none)
    expect(m.server.canViewInstance('workflow', 'wf_locked')).toBe(false)
    expect(m.server.canEditInstance('workflow', 'wf_locked')).toBe(false)
    expect(m.server.canAdminInstance('workflow', 'wf_locked')).toBe(false)
    expect(() => m.server.assertViewInstance('workflow', 'wf_locked')).toThrow()

    expect(m.server.canAdminInstance('workflow', 'wf_other')).toBe(true)
  })

  it('the restricted workflow drops out of the same filter `workflow.list` runs', () => {
    const m = member({ rows: [{ entityInstanceId: 'wf_locked', permission: 'none' }] })
    const listed = ['wf_open', 'wf_locked', 'wf_other'].filter((id) =>
      m.server.canViewInstance('workflow', id)
    )
    expect(listed).toEqual(['wf_open', 'wf_other'])
  })

  it('an explicit grant on the restricted workflow restores exactly that rung', () => {
    // The grantee composes BOTH rows; the real grant outranks the `none` marker,
    // and `view` (not `admin`) is what they get — enough to open and RUN it,
    // not to save it.
    const m = member({
      rows: [
        { entityInstanceId: 'wf_locked', permission: 'none' },
        { entityInstanceId: 'wf_locked', permission: 'view' },
      ],
    })
    expect(levelFor(m, 'workflow', 'wf_locked')).toBe(ResourcePermission.view)
    expect(m.server.canViewInstance('workflow', 'wf_locked')).toBe(true)
    expect(m.server.canEditInstance('workflow', 'wf_locked')).toBe(false)
  })

  it('an instance row LOWERS a member who holds the area at Full', () => {
    // Instance grants are deliberately not raise-only (plan 24 §B.2.6): a `view`
    // row under `workflows: Full` must actually take Save/Publish/Delete away —
    // this is the "lock the billing automation away from general editing" case
    // plan 30 §3 names as the whole reason the entry exists.
    const m = member({ rows: [{ entityInstanceId: 'wf_billing', permission: 'view' }] })
    expect(m.server.areaLevel(Area.workflows)).toBe(Level.Full)
    expect(levelFor(m, 'workflow', 'wf_billing')).toBe(ResourcePermission.view)
    expect(m.server.canEditInstance('workflow', 'wf_billing')).toBe(false)
    expect(m.server.canAdminInstance('workflow', 'wf_billing')).toBe(false)
  })

  it('an instance grant is NOT clamped to the area level', () => {
    // Loose finding carried in HANDOFF: `effectiveInstanceLevel` returns the
    // row outright once the area gate is non-None, so `workflows: Read` + an
    // `admin` row = admin on that workflow. Pinned as the current model so plan
    // 25 §2 has to change a test to change it.
    const m = member({
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.workflows]: Level.Read },
      rows: [{ entityInstanceId: 'wf_shared', permission: 'admin' }],
    })
    expect(m.server.areaLevel(Area.workflows)).toBe(Level.Read)
    expect(levelFor(m, 'workflow', 'wf_shared')).toBe(ResourcePermission.admin)
    expect(m.server.canAdminInstance('workflow', 'wf_shared')).toBe(true)
    // …but the coarse `workflowsManage` rung — what `create` / `duplicate`
    // gate on — is still absent, so they cannot create a workflow.
    expect(m.server.can(PermissionKey.workflowsManage)).toBe(false)
  })
})

describe('worker seats compose `workflows: None` (plan 30 §8 item 1 — DELIBERATE)', () => {
  it('the seat ceiling zeroes the area even with a Full profile AND an admin grant', () => {
    // `workflows` is absent from `WORKER_AREAS`, and the seat ceiling is applied
    // LAST. The consequence, stated out loud: a field tech cannot trigger a
    // manual workflow from a record. Reopening it means adding `Area.workflows`
    // to `WORKER_AREAS` — at which point this test should fail loudly rather
    // than the semantics changing silently.
    //
    // Load-bearing since plan 25 §2: an explicit row now outranks the AREA
    // floor, so the seat ceiling had to become an explicit check in
    // `effectiveInstanceLevel` instead of riding on the already-clamped key set.
    // Without it this exact case — worker seat + `admin` grant — would hand out
    // a workflow the seat's billing packaging excludes.
    const m = member({
      seatType: 'worker',
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.workflows]: Level.Full },
      rows: [{ entityInstanceId: 'wf_shared', permission: 'admin' }],
    })
    expect(m.server.areaLevel(Area.workflows)).toBe(Level.None)
    expect(levelFor(m, 'workflow', 'wf_shared')).toBeUndefined()
    expect(levelFor(m, 'workflow', 'wf_unrestricted')).toBeUndefined()
    expect(m.server.canViewInstance('workflow', 'wf_unrestricted')).toBe(false)
  })

  it('a full seat on the same profile keeps every rung', () => {
    // The other half — without it the test above would pass for a profile that
    // grants nothing in the first place.
    const m = member({ profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.workflows]: Level.Full } })
    expect(m.server.areaLevel(Area.workflows)).toBe(Level.Full)
    expect(levelFor(m, 'workflow', 'wf_unrestricted')).toBe(ResourcePermission.admin)
  })
})

describe('the seeded Member baseline is unaffected by the rung split', () => {
  it('a stock member still administers every workflow with no rows', () => {
    // `MEMBER_BASELINE_LEVELS[workflows]` is Full, so splitting the old single
    // Full rung into Read/Edit/Full must be a pure refinement — nobody loses
    // anything by default, and nobody gains.
    expect(MEMBER_BASELINE_LEVELS[Area.workflows]).toBe(Level.Full)
    const m = member()
    expect(m.server.can(PermissionKey.workflowsView)).toBe(true)
    expect(m.server.can(PermissionKey.workflowsEdit)).toBe(true)
    expect(m.server.can(PermissionKey.workflowsManage)).toBe(true)
    expect(levelFor(m, 'workflow', 'wf_any')).toBe(ResourcePermission.admin)
  })
})

/**
 * `instanceListScope` — the id filter `workflow.list` computes UP FRONT so its
 * query can narrow before it paginates.
 *
 * The property that matters is not the shape of the returned lists but that
 * applying them reproduces `canViewInstance` EXACTLY. Every case below asserts
 * that equivalence over a candidate id list, so the filter and the gate cannot
 * drift into a leak (an id the gate denies but the filter admits) or a
 * disappearance (an id the gate allows but the filter drops — the plan 25 §2
 * failure mode: an empty page for a workflow you can demonstrably open).
 */
describe('instanceListScope — the list filter reproduces the gate exactly', () => {
  const CANDIDATES = ['wf_open', 'wf_locked', 'wf_other', 'wf_shared', 'wf_never_touched']

  /** What the list SHOULD contain, derived from the shipped per-instance gate. */
  const viewableByGate = (m: ReturnType<typeof member>) =>
    CANDIDATES.filter((id) => m.server.canViewInstance('workflow', id))

  /** What the list DOES contain once the scope is applied to the query. */
  const viewableByScope = (m: ReturnType<typeof member>) => {
    const scope = m.server.instanceListScope('workflow')
    if (scope.kind === 'none') return []
    if (scope.kind === 'include') {
      const included = new Set(scope.includeIds)
      return CANDIDATES.filter((id) => included.has(id))
    }
    const excluded = new Set(scope.excludeIds)
    return CANDIDATES.filter((id) => !excluded.has(id))
  }

  it('names exactly the explicitly-restricted workflows, and nothing else', () => {
    const m = member({
      rows: [
        { entityInstanceId: 'wf_locked', permission: 'none' },
        { entityInstanceId: 'wf_shared', permission: 'view' },
      ],
    })
    // `wf_shared` carries a row but the member may still VIEW it, so it must NOT
    // be excluded — "has a row" is not "is denied".
    expect(m.server.instanceListScope('workflow')).toEqual({
      kind: 'exclude',
      excludeIds: ['wf_locked'],
    })
    expect(viewableByScope(m)).toEqual(viewableByGate(m))
  })

  it('excludes a workflow whose rows do not include this member', () => {
    // The `baselineAtCreate: false` denial that has no row of the member's own:
    // once ANY row exists the instance is restricted, and an absent entry reads
    // as denial. Still a restriction — still enumerable from
    // `governingInstanceIds`.
    const m = member({ rows: [], restrictedInstances: ['wf_locked'] })
    expect(m.server.instanceListScope('workflow').excludeIds).toEqual(['wf_locked'])
    expect(viewableByScope(m)).toEqual(viewableByGate(m))
  })

  it('area None with NO grants sees nothing at all', () => {
    // Row-less denial cannot be enumerated as an exclusion, so this arm must be
    // `'none'` and the caller must return an empty list without querying.
    const m = member({ profileLevels: { [Area.workflows]: Level.None } })
    expect(m.server.instanceListScope('workflow')).toEqual({ kind: 'none' })
    expect(viewableByGate(m)).toEqual([])
    expect(viewableByScope(m)).toEqual([])
  })

  it('area None WITH a grant INVERTS to an allow-list (plan 25 §2)', () => {
    // The live repro. Before the flip this member got `deniesAll` and an empty
    // page while `getById('wf_shared')` succeeded — `list` silently
    // contradicting `canViewInstance`.
    const m = member({
      profileLevels: { [Area.workflows]: Level.None },
      rows: [
        { entityInstanceId: 'wf_shared', permission: 'view' },
        { entityInstanceId: 'wf_locked', permission: 'none' },
      ],
    })
    expect(m.server.instanceListScope('workflow')).toEqual({
      kind: 'include',
      includeIds: ['wf_shared'],
    })
    expect(viewableByGate(m)).toEqual(['wf_shared'])
    expect(viewableByScope(m)).toEqual(['wf_shared'])
  })

  it('area None whose only rows are `none` restrictions still sees nothing', () => {
    const m = member({
      profileLevels: { [Area.workflows]: Level.None },
      rows: [{ entityInstanceId: 'wf_locked', permission: 'none' }],
    })
    expect(m.server.instanceListScope('workflow')).toEqual({ kind: 'none' })
    expect(viewableByScope(m)).toEqual(viewableByGate(m))
  })

  it('a worker seat sees nothing even holding an admin grant (seat ceiling)', () => {
    const m = member({
      seatType: 'worker',
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.workflows]: Level.Full },
      rows: [{ entityInstanceId: 'wf_shared', permission: 'admin' }],
    })
    expect(m.server.instanceListScope('workflow')).toEqual({ kind: 'none' })
    expect(viewableByScope(m)).toEqual(viewableByGate(m))
  })

  it('excludes nothing for an OWNER, even with a `none` row', () => {
    const m = member({
      role: 'OWNER',
      rows: [{ entityInstanceId: 'wf_locked', permission: 'none' }],
    })
    expect(m.server.instanceListScope('workflow')).toEqual({ kind: 'exclude', excludeIds: [] })
    expect(viewableByScope(m)).toEqual(CANDIDATES)
    expect(viewableByScope(m)).toEqual(viewableByGate(m))
  })

  it('excludes nothing when the org has no instance rows at all', () => {
    // The overwhelmingly common shape under `baselineAtCreate: false`: the
    // exclusion is empty, so the query is unchanged and the fix costs nothing.
    const m = member()
    expect(m.server.instanceListScope('workflow')).toEqual({ kind: 'exclude', excludeIds: [] })
    expect(viewableByScope(m)).toEqual(viewableByGate(m))
  })

  it('is grantable-up: an explicit grant on a restricted workflow drops out of the exclusion', () => {
    const m = member({
      rows: [
        { entityInstanceId: 'wf_locked', permission: 'none' },
        { entityInstanceId: 'wf_locked', permission: 'view' },
      ],
    })
    expect(m.server.instanceListScope('workflow').excludeIds).toEqual([])
    expect(viewableByScope(m)).toEqual(viewableByGate(m))
  })

  it('carries ids of OTHER instance-access types, which is harmless', () => {
    // `governingInstanceIds` is org-wide across datasets/KBs/dashboards/
    // workflows, so a restricted dataset lands in the workflow exclusion too.
    // Ids are globally-unique cuid2s, so an over-broad exclusion can never drop
    // a workflow the member may see — documented here so nobody "fixes" it by
    // adding a per-type query.
    const m = member({ rows: [{ entityInstanceId: 'ds_locked', permission: 'none' }] })
    expect(m.server.instanceListScope('workflow').excludeIds).toEqual(['ds_locked'])
    expect(viewableByScope(m)).toEqual(CANDIDATES)
    expect(viewableByScope(m)).toEqual(viewableByGate(m))
  })

  it('an allow-list may name foreign ids too, equally harmless', () => {
    // The `include` mirror of the case above: a `datasets: None` member holding
    // one dataset grant, listing WORKFLOWS. The allow-list names the dataset id,
    // which matches no workflow row — an over-broad allow-list can no more admit
    // a workflow than an over-broad exclusion can drop one.
    const m = member({
      profileLevels: { [Area.workflows]: Level.None },
      rows: [{ entityInstanceId: 'ds_shared', permission: 'view' }],
    })
    expect(m.server.instanceListScope('workflow')).toEqual({
      kind: 'include',
      includeIds: ['ds_shared'],
    })
    expect(viewableByScope(m)).toEqual([])
    expect(viewableByScope(m)).toEqual(viewableByGate(m))
  })
})

describe('OWNER regression (plan 30 §7)', () => {
  it('short-circuits to admin on a workflow restricted to `none`', () => {
    // §0.10 recovery guarantee: nothing authored on a workflow can lock the last
    // owner out of the workflow that would let them undo it.
    const m = member({
      role: 'OWNER',
      rows: [{ entityInstanceId: 'wf_locked', permission: 'none' }],
    })
    expect(levelFor(m, 'workflow', 'wf_locked')).toBe(ResourcePermission.admin)
    expect(m.server.canAdminInstance('workflow', 'wf_locked')).toBe(true)
  })

  it('short-circuits ahead of the area gate too (worker-seat owner)', () => {
    const m = member({ role: 'OWNER', seatType: 'worker' })
    expect(m.server.areaLevel(Area.workflows)).toBe(Level.None)
    expect(levelFor(m, 'workflow', 'wf_any')).toBe(ResourcePermission.admin)
  })
})
