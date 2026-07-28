// packages/lib/src/permissions/capabilities/grantee-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CapabilitySet } from './capability-set'
import { composeUserCapabilities } from './compose-user-capabilities'
import { Area, Level } from './registry'

/**
 * Plan 31 §4, phase 2 — **`granteeAccess` agrees with the enforcement path.**
 *
 * The bar §4 sets is deliberate: assert against `effectiveInstanceLevel`, not
 * against a hand-written expectation. So every scenario below builds a REAL
 * `CapabilitySet` from `composeUserCapabilities` — the same composition the read
 * path runs — and checks what the endpoint reports for it.
 *
 * What that leaves this file testing is the WIRING, which is where a bug would
 * actually live: that each instance is resolved against its own resource type
 * (a dashboard id must not be answered through the workflows area), that the
 * row-less fallback is per type, and that `own` / `baseline` / `effective` are
 * split from one org-wide row set without bleeding into each other. Composition
 * itself is already pinned by `compose-user-capabilities.test.ts` and
 * `capability-set-instance.test.ts`.
 */

const ORG = 'org_1'
const USER = 'user_alice'

const h = vi.hoisted(() => ({ caps: null as unknown }))

vi.mock('./get-capabilities', () => ({ getCapabilities: async () => h.caps }))

const { getGranteeAccess } = await import('./grantee-access')

/** Rows the fake db returns, in `ResourceAccess` shape. */
interface AccessRow {
  entityDefinitionId: string
  entityInstanceId: string | null
  granteeType: string
  granteeId: string
  permission: ResourcePermission
}

/**
 * The two selects `getGranteeAccess` issues, in order: the grantee's own
 * `PermissionGrant` row (`.limit(1)`) and the org's `ResourceAccess` rows.
 */
function fakeDb(grantLevels: unknown, accessRows: AccessRow[]) {
  let call = 0
  const builder = (rows: unknown[]) => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    }
    return chain
  }
  return {
    select: () => {
      call += 1
      return call === 1 ? builder([{ levels: grantLevels }]) : builder(accessRows)
    },
  } as never
}

/** A real `CapabilitySet`, composed exactly as the read path composes one. */
function capsFor(input: Parameters<typeof composeUserCapabilities>[0], seatType = 'full' as const) {
  const composed = composeUserCapabilities(input)
  const instanceIds = new Set(Object.keys(composed.instanceAccess))
  return new CapabilitySet(
    new Set(composed.keys),
    composed.defAccess,
    input.role ?? 'USER',
    seatType,
    (id) => id,
    new Set(),
    (id) => id,
    composed.instanceAccess,
    instanceIds,
    {},
    new Set(composed.instanceDerivedKeys)
  )
}

const WF = 'wf_shared'
const DASH = 'dash_shared'

beforeEach(() => {
  h.caps = null
})

describe('getGranteeAccess — own / baseline / effective are split cleanly', () => {
  it('keeps another grantee\'s row out of "own" while still answering "effective"', async () => {
    const rows: AccessRow[] = [
      // Alice's own row.
      {
        entityDefinitionId: 'workflow',
        entityInstanceId: WF,
        granteeType: 'user',
        granteeId: USER,
        permission: ResourcePermission.none,
      },
      // Bob's row on the SAME workflow — org-scope data that must not surface
      // as Alice's, which is the §2.1 leak restated at the data layer.
      {
        entityDefinitionId: 'workflow',
        entityInstanceId: WF,
        granteeType: 'user',
        granteeId: 'user_bob',
        permission: ResourcePermission.admin,
      },
      // The workspace default — one row per instance, no grantee in it.
      {
        entityDefinitionId: 'workflow',
        entityInstanceId: WF,
        granteeType: 'role',
        granteeId: 'org_member',
        permission: ResourcePermission.view,
      },
    ]

    h.caps = capsFor({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.workflows]: Level.Read },
      typeAccessRows: [],
      instanceAccessRows: [
        {
          entityDefinitionId: 'workflow',
          entityInstanceId: WF,
          permission: ResourcePermission.none,
        },
      ],
    })

    const result = await getGranteeAccess(
      { organizationId: ORG, granteeType: 'user', granteeId: USER },
      fakeDb({ [Area.workflows]: Level.Read }, rows)
    )

    expect(result.own.instances).toEqual({ [WF]: ResourcePermission.none })
    expect(result.baseline.instances).toEqual({ [WF]: ResourcePermission.view })
    // Bob's `admin` appears NOWHERE in the payload.
    expect(JSON.stringify(result)).not.toContain('user_bob')
  })

  it("reads the grantee's own area levels from their PermissionGrant row", async () => {
    h.caps = capsFor({ role: 'USER', seatType: 'full', typeAccessRows: [] })

    const result = await getGranteeAccess(
      { organizationId: ORG, granteeType: 'user', granteeId: USER },
      fakeDb({ [Area.workflows]: Level.Edit }, [])
    )

    expect(result.own.areas).toEqual({ [Area.workflows]: Level.Edit })
  })
})

describe('getGranteeAccess — each instance is resolved against its OWN resource type', () => {
  /**
   * **This pair agrees with the enforcement path but does NOT pin the per-type
   * mapping, and that is worth stating rather than implying.** Mutating
   * `caps.instanceLevel(key, id)` to a hardcoded `'workflow'` leaves both green.
   *
   * The reason is structural: for an instance the org holds a row on,
   * `effectiveInstanceLevel` returns `instanceAccess[id]` outright, and every
   * branch above that is key-independent EXCEPT the seat ceiling — which today
   * cannot distinguish these areas, because `WORKER_AREAS` contains none of the
   * four instance-access areas, so a worker seat closes all of them and a full
   * seat opens all of them.
   *
   * So the mapping is currently correct-by-construction rather than
   * correct-by-test. It is kept because the alternative is correct only by
   * coincidence of today's seat table: a future tier that opens dashboards while
   * closing workflows would break a collapsed version silently. The row-less
   * fallback below IS key-dependent and IS mutation-caught — that is where the
   * per-type weight actually rests.
   */
  it('answers a dashboard through dashboards and a workflow through workflows', async () => {
    const rows: AccessRow[] = [
      {
        entityDefinitionId: 'workflow',
        entityInstanceId: WF,
        granteeType: 'role',
        granteeId: 'org_member',
        permission: ResourcePermission.view,
      },
      {
        entityDefinitionId: 'dashboard',
        entityInstanceId: DASH,
        granteeType: 'user',
        granteeId: USER,
        permission: ResourcePermission.edit,
      },
    ]

    const caps = capsFor({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.workflows]: Level.Read, [Area.dashboards]: Level.Read },
      typeAccessRows: [],
      instanceAccessRows: [
        {
          entityDefinitionId: 'workflow',
          entityInstanceId: WF,
          permission: ResourcePermission.view,
        },
        {
          entityDefinitionId: 'dashboard',
          entityInstanceId: DASH,
          permission: ResourcePermission.edit,
        },
      ],
    })
    h.caps = caps

    const result = await getGranteeAccess(
      { organizationId: ORG, granteeType: 'user', granteeId: USER },
      fakeDb({}, rows)
    )

    // The enforcement path is the expectation — §4's bar.
    expect(result.effective?.instances[WF]).toBe(caps.instanceLevel('workflow', WF))
    expect(result.effective?.instances[DASH]).toBe(caps.instanceLevel('dashboard', DASH))
  })

  it('reports a per-type row-less fallback, matching the enforcement path', async () => {
    const caps = capsFor({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.workflows]: Level.Read, [Area.dashboards]: Level.Full },
      typeAccessRows: [],
    })
    h.caps = caps

    const result = await getGranteeAccess(
      { organizationId: ORG, granteeType: 'user', granteeId: USER },
      fakeDb({}, [])
    )

    // `workflow` is baselineAtCreate:false → the open area supplies a level.
    expect(result.effective?.instanceFallback.workflow).toBe(caps.instanceFallbackLevel('workflow'))
    expect(result.effective?.instanceFallback.workflow).toBe(ResourcePermission.view)
    // `dashboard` is baselineAtCreate:true → a row-less dashboard is private
    // even on a wide-open area. Same value, opposite meaning.
    // `?? null` because "no access" is normalized to `null` on the wire — an
    // absent key would otherwise be indistinguishable from a denial.
    expect(result.effective?.instanceFallback.dashboard).toBe(
      caps.instanceFallbackLevel('dashboard') ?? null
    )
    expect(result.effective?.instanceFallback.dashboard).toBeNull()
  })
})

describe('getGranteeAccess — finding 4: a user-level "none" loses to a group grant', () => {
  /**
   * The whole reason the effective line is not optional polish (§2.5). The admin
   * sets No access, the select changes, and today nothing tells them the group
   * grant still wins — `instanceAccess` is `max` by `PERMISSION_RANK` with `none`
   * ranked 0.
   */
  it("reports the composed level, not the grantee's own row", async () => {
    const rows: AccessRow[] = [
      {
        entityDefinitionId: 'workflow',
        entityInstanceId: WF,
        granteeType: 'user',
        granteeId: USER,
        permission: ResourcePermission.none,
      },
    ]

    h.caps = capsFor({
      role: 'USER',
      seatType: 'full',
      profileLevels: { [Area.workflows]: Level.Read },
      typeAccessRows: [],
      // Both rows reach composition: Alice's `none` and her team's `view`.
      instanceAccessRows: [
        {
          entityDefinitionId: 'workflow',
          entityInstanceId: WF,
          permission: ResourcePermission.none,
        },
        {
          entityDefinitionId: 'workflow',
          entityInstanceId: WF,
          permission: ResourcePermission.view,
        },
      ],
    })

    const result = await getGranteeAccess(
      { organizationId: ORG, granteeType: 'user', granteeId: USER },
      fakeDb({}, rows)
    )

    expect(result.own.instances[WF]).toBe(ResourcePermission.none)
    // Both true, and the screen can now say so.
    expect(result.effective?.instances[WF]).toBe(ResourcePermission.view)
  })
})

describe('getGranteeAccess — a group/profile is a level SOURCE, not a subject', () => {
  it('returns own + baseline but no effective for a group', async () => {
    h.caps = capsFor({ role: 'USER', seatType: 'full', typeAccessRows: [] })

    const result = await getGranteeAccess(
      { organizationId: ORG, granteeType: 'group', granteeId: 'grp_support' },
      fakeDb({ [Area.workflows]: Level.Read }, [
        {
          entityDefinitionId: 'workflow',
          entityInstanceId: WF,
          granteeType: 'group',
          granteeId: 'grp_support',
          permission: ResourcePermission.view,
        },
      ])
    )

    expect(result.own.instances).toEqual({ [WF]: ResourcePermission.view })
    expect(result.effective).toBeNull()
  })

  it('returns no effective for a profile either', async () => {
    h.caps = capsFor({ role: 'USER', seatType: 'full', typeAccessRows: [] })

    const result = await getGranteeAccess(
      { organizationId: ORG, granteeType: 'profile', granteeId: 'prof_1' },
      fakeDb({}, [])
    )

    expect(result.effective).toBeNull()
  })
})

describe('getGranteeAccess — the seat ceiling still dominates', () => {
  /**
   * A worker seat holds `workflows: None` unliftably. Plan 25 §2 made an
   * explicit row beat the AREA floor, so the ceiling had to become an explicit
   * check — a display path that missed it would tell an admin the field tech can
   * open a workflow their billing packaging excludes.
   */
  it('reports no access for a worker seat holding an explicit grant', async () => {
    const caps = capsFor(
      {
        role: 'USER',
        seatType: 'worker',
        profileLevels: { [Area.workflows]: Level.Full },
        typeAccessRows: [],
        instanceAccessRows: [
          {
            entityDefinitionId: 'workflow',
            entityInstanceId: WF,
            permission: ResourcePermission.admin,
          },
        ],
      },
      'worker'
    )
    h.caps = caps

    const result = await getGranteeAccess(
      { organizationId: ORG, granteeType: 'user', granteeId: USER },
      fakeDb({}, [
        {
          entityDefinitionId: 'workflow',
          entityInstanceId: WF,
          granteeType: 'user',
          granteeId: USER,
          permission: ResourcePermission.admin,
        },
      ])
    )

    // The row is theirs, and it buys them nothing.
    expect(result.own.instances[WF]).toBe(ResourcePermission.admin)
    expect(result.effective?.instances[WF]).toBe(caps.instanceLevel('workflow', WF) ?? null)
    expect(result.effective?.instances[WF]).toBeNull()
  })
})
