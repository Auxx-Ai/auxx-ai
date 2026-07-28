// packages/lib/src/permissions/capabilities/capability-set-instance.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { CapabilitySet } from './capability-set'
import { composeUserCapabilities } from './compose-user-capabilities'
import { effectiveInstanceLevel, toResolvedRecordAccess } from './entity-access'
import type { InstanceAccessKey } from './instance-access'
import { Area, Level } from './registry'
import { MEMBER_BASELINE_LEVELS } from './seat-policy'

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
  rows?: Array<{ entityInstanceId: string; permission: ResourcePermission }>
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
    instanceAccessRows: opts.rows ?? [],
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
    {}
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

describe('dead grants — an instance grant under a closed area (plan 24 §B.2.8)', () => {
  it('grants nothing to a member whose profile closes the area', () => {
    // `effectiveInstanceLevel` short-circuits at area None BEFORE consulting
    // instance rows, so sharing to a sparse-profile holder is a silent no-op.
    // This is the behaviour the Share UI's "No effect" warning describes — and
    // the behaviour plan 25 §2 will deliberately flip, so it is pinned here.
    const m = member({
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.datasets]: Level.None },
      rows: [{ entityInstanceId: 'ds_shared', permission: 'admin' }],
    })
    expect(levelFor(m, 'dataset', 'ds_shared')).toBeUndefined()
    expect(m.server.canViewInstance('dataset', 'ds_shared')).toBe(false)

    // The two signals the server annotation (`forInstance.granteeAreaLevel`) is
    // built from: the grant is genuinely stored, and the area is genuinely shut.
    expect(m.caps.instanceAccess).toEqual({ ds_shared: 'admin' })
    expect(m.server.areaLevel(Area.datasets)).toBe(Level.None)
  })

  it('the same grant takes effect once the profile grants the area', () => {
    // The other half of the warning's lifecycle — without this the test above
    // would pass for a grant that never works at all.
    const m = member({ rows: [{ entityInstanceId: 'ds_shared', permission: 'admin' }] })
    expect(m.server.areaLevel(Area.datasets)).toBe(Level.Read)
    expect(levelFor(m, 'dataset', 'ds_shared')).toBe(ResourcePermission.admin)
  })

  it('an area closed only by the SEAT ceiling kills the grant too', () => {
    // A worker seat zeroes `datasets` regardless of the profile, and the ceiling
    // is applied last — an instance grant must not slip past a billing invariant.
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
