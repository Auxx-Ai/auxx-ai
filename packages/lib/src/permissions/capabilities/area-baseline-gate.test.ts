// packages/lib/src/permissions/capabilities/area-baseline-gate.test.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { isGoverningInstanceRow } from '../../cache/providers/governing-instance-ids-provider'
import { CapabilitySet } from './capability-set'
import { composeUserCapabilities } from './compose-user-capabilities'
import {
  effectiveInstanceLevel,
  instanceFallbackLevel,
  instanceListScope,
  type OrgSharedInstanceAccessKey,
  type PrivateInstanceAccessKey,
  privateInstanceListScope,
  toResolvedRecordAccess,
} from './entity-access'
import {
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
} from './instance-access'
import { Area, areaLevelFromKeys, Level, PERMISSION_AREAS, PermissionKey } from './registry'
import { MEMBER_BASELINE_LEVELS, ROLE_DEFAULTS, SEAT_CEILINGS } from './seat-policy'

/**
 * **Plan 43 §0.2a decision C — the area level gates the BASELINE path; an
 * individual grant always overrules it.**
 *
 * That one sentence is the whole slice, and it exists because two wants collided:
 *
 *  - *"`Dashboards: None` means this profile sees no dashboards"* — a lever
 *    admins asked for and did not have. `dashboardsView` is asserted nowhere, and
 *    `dashboard-mutations.ts` writes a `role:org_member @ view` row on every
 *    dashboard at create (89 of them in dev), so practically every member was
 *    derived into the area whatever their profile said.
 *  - *"an explicit instance grant overrides area `None`"* — **#1346** (plan 25
 *    §2), shipped, and the only reason a single-instance share works at all.
 *
 * Splitting the composed instance map into an INDIVIDUAL lane (`user` / `group` /
 * `profile` rows) and a BASELINE lane (`role:org_member` rows) is what lets both
 * be true at once: only the second is gated. `baselineAtCreate` stops mattering
 * to the RULE and goes back to meaning only what it always meant — is there a
 * fall-through when no row exists — which is why every case below runs across
 * **all nine** instance-access resources rather than a representative two.
 *
 * Everything here resolves through BOTH copies of the rule (the private
 * `CapabilitySet` resolver and the client mirror reached through the real wire
 * snapshot) and, where enumerable, through the LIST scope as well. Two copies of
 * one rule that disagree is the failure mode this family of tests exists for.
 */

/** One `ResourceAccess` instance row as the org stores it. */
interface OrgRow {
  key: InstanceAccessKey
  instanceId: string
  granteeType: ResourceGranteeType
  granteeId: string
  permission: ResourcePermission
}

const ME = 'user_me'
const MY_GROUP = 'group_support'
const MY_PROFILE = 'prof_member'

/** `role:org_member @ <permission>` — the workspace default. The GATED lane. */
const baselineRow = (
  key: InstanceAccessKey,
  instanceId: string,
  permission: ResourcePermission
): OrgRow => ({
  key,
  instanceId,
  granteeType: ResourceGranteeType.role,
  granteeId: 'org_member',
  permission,
})

/** `user:me @ <permission>` — an individual grant. NEVER gated (#1346). */
const myRow = (
  key: InstanceAccessKey,
  instanceId: string,
  permission: ResourcePermission
): OrgRow => ({
  key,
  instanceId,
  granteeType: ResourceGranteeType.user,
  granteeId: ME,
  permission,
})

/** `group:support @ <permission>`, and I am in support. Also individual. */
const myGroupRow = (
  key: InstanceAccessKey,
  instanceId: string,
  permission: ResourcePermission
): OrgRow => ({
  key,
  instanceId,
  granteeType: ResourceGranteeType.group,
  granteeId: MY_GROUP,
  permission,
})

/** `profile:member @ <permission>` — the third individual grantee kind. */
const myProfileRow = (
  key: InstanceAccessKey,
  instanceId: string,
  permission: ResourcePermission
): OrgRow => ({
  key,
  instanceId,
  granteeType: ResourceGranteeType.profile,
  granteeId: MY_PROFILE,
  permission,
})

interface MemberOpts {
  role?: OrganizationRole
  seatType?: SeatType
  /** Sparse profile levels; defaults to the seeded Member baseline. */
  profileLevels?: Partial<Record<Area, Level>>
  /** The blanket rung for areas `profileLevels` does not set. */
  profileBaseLevel?: Level | null
  /** EVERY instance row in the org. The governing set is derived from these. */
  orgRows?: OrgRow[]
}

/**
 * Build a member the way production does — rows → `composeUserCapabilities` →
 * `CapabilitySet` — with the grantee union (`user:me`, my group, my profile,
 * `role:org_member`) applied exactly as `computeUserCapabilities`' WHERE clause
 * applies it, and the org-wide governing set derived through the very same
 * `isGoverningInstanceRow` predicate the cache provider uses. Nothing here
 * re-states the rule under test.
 */
function member(opts: MemberOpts = {}) {
  const role = opts.role ?? 'USER'
  const seatType = opts.seatType ?? 'full'
  const orgRows = opts.orgRows ?? []
  const mine = orgRows.filter(
    (row) =>
      (row.granteeType === ResourceGranteeType.user && row.granteeId === ME) ||
      (row.granteeType === ResourceGranteeType.group && row.granteeId === MY_GROUP) ||
      (row.granteeType === ResourceGranteeType.profile && row.granteeId === MY_PROFILE) ||
      (row.granteeType === ResourceGranteeType.role && row.granteeId === 'org_member')
  )

  const caps = composeUserCapabilities({
    role,
    seatType,
    profileLevels: opts.profileLevels ?? MEMBER_BASELINE_LEVELS,
    profileBaseLevel: opts.profileBaseLevel ?? null,
    typeAccessRows: [],
    instanceAccessRows: mine.map((row) => ({
      entityDefinitionId: row.key,
      entityInstanceId: row.instanceId,
      permission: row.permission,
      granteeType: row.granteeType,
    })),
  })

  const governing = new Set(orgRows.filter(isGoverningInstanceRow).map((row) => row.instanceId))

  const server = new CapabilitySet(
    new Set(caps.keys),
    caps.defAccess,
    role,
    seatType,
    (id) => id,
    new Set(),
    (id) => id,
    caps.instanceAccess,
    governing,
    {},
    new Set(caps.instanceDerivedKeys),
    caps.baselineInstanceAccess
  )
  return { caps, server, client: toResolvedRecordAccess(server.toClientCapabilities()), governing }
}

type Member = ReturnType<typeof member>

/** Resolve through BOTH copies of the rule and assert they agree. */
function levelFor(m: Member, key: InstanceAccessKey, instanceId: string) {
  const client = effectiveInstanceLevel(m.client, key, instanceId)
  expect(m.server.instanceLevel(key, instanceId), 'server/client mirror drift').toBe(client)
  return client
}

/**
 * Assert the LIST filter reproduces the point check for the given ids — §8 item
 * 12. Picks the right scope function by posture, which the two `key` types make
 * a compile-time choice rather than a runtime one.
 */
function assertListAgrees(m: Member, key: InstanceAccessKey, ids: string[]) {
  const scope = INSTANCE_ACCESS_RESOURCES[key].baselineAtCreate
    ? privateInstanceListScope(m.client, key as PrivateInstanceAccessKey)
    : instanceListScope(m.client, key as OrgSharedInstanceAccessKey)
  for (const id of ids) {
    const level = effectiveInstanceLevel(m.client, key, id)
    const visible = level !== undefined && level !== ResourcePermission.none
    const listed =
      scope.kind === 'none'
        ? false
        : scope.kind === 'include'
          ? scope.includeIds.includes(id)
          : !scope.excludeIds.includes(id)
    expect(listed, `${key}/${id}: list says ${listed}, gate says ${visible}`).toBe(visible)
  }
}

/** Every instance-access resource, with the area its rung lives on. */
const ALL_RESOURCES = INSTANCE_ACCESS_KEYS.map(
  (key) => [key, INSTANCE_ACCESS_RESOURCES[key].area] as const
)

/** A profile that is the seeded Member baseline with ONE area shut to `None`. */
const areaClosed = (area: Area): Partial<Record<Area, Level>> => ({
  ...MEMBER_BASELINE_LEVELS,
  [area]: Level.None,
})

/** …and the same with that one area at `Read`. */
const areaAt = (area: Area, level: Level): Partial<Record<Area, Level>> => ({
  ...MEMBER_BASELINE_LEVELS,
  [area]: level,
})

// ─────────────────────────────────────────────────────────────────────────────
// §8 items 1–7 — the truth table, across ALL NINE resources.
//
// C's whole claim is that ONE rule covers every instance-access resource, so
// running these on a representative two would leave the claim untested. Rows 1
// and 3 are the pair that collide; the rest pin the edges around them.
// ─────────────────────────────────────────────────────────────────────────────

describe('§8 truth table — area None (plan 43 §0.2a)', () => {
  it.each(
    ALL_RESOURCES
  )('1. %s: a `role:org_member @ view` baseline row is DENIED — the lever works', (key, area) => {
    const rows = [baselineRow(key, 'inst_1', ResourcePermission.view)]
    const m = member({ profileLevels: areaClosed(area), orgRows: rows })

    // The area really is shut, or this proves nothing.
    expect(m.server.areaLevel(area)).toBe(Level.None)
    // …and the row really did reach the member's grantee union.
    expect(m.caps.baselineInstanceAccess).toEqual({ inst_1: 'view' })
    expect(m.caps.instanceAccess).toEqual({})

    expect(levelFor(m, key, 'inst_1')).toBeUndefined()
    expect(m.server.canViewInstance(key, 'inst_1')).toBe(false)
    assertListAgrees(m, key, ['inst_1'])
  })

  it.each(
    ALL_RESOURCES
  )('2. %s: the creator keeps their own `user @ admin` row — you always keep what you made', (key, area) => {
    const rows = [myRow(key, 'inst_mine', ResourcePermission.admin)]
    const m = member({ profileLevels: areaClosed(area), orgRows: rows })

    expect(m.server.areaLevel(area)).toBe(Level.None)
    expect(levelFor(m, key, 'inst_mine')).toBe(ResourcePermission.admin)
    expect(m.server.canAdminInstance(key, 'inst_mine')).toBe(true)
    assertListAgrees(m, key, ['inst_mine'])
  })

  it.each(ALL_RESOURCES)('3. %s: a `user @ view` share still lands — #1346 holds', (key, area) => {
    const rows = [myRow(key, 'inst_shared', ResourcePermission.view)]
    const m = member({ profileLevels: areaClosed(area), orgRows: rows })

    expect(m.server.areaLevel(area)).toBe(Level.None)
    expect(levelFor(m, key, 'inst_shared')).toBe(ResourcePermission.view)
    assertListAgrees(m, key, ['inst_shared'])
  })

  it.each(
    ALL_RESOURCES
  )('4. %s: a `group @ view` row lands for a member of that group', (key, area) => {
    const rows = [myGroupRow(key, 'inst_team', ResourcePermission.view)]
    const m = member({ profileLevels: areaClosed(area), orgRows: rows })

    expect(m.caps.instanceAccess).toEqual({ inst_team: 'view' })
    expect(levelFor(m, key, 'inst_team')).toBe(ResourcePermission.view)
    assertListAgrees(m, key, ['inst_team'])
  })

  it.each(
    ALL_RESOURCES
  )('4b. %s: a `profile @ view` row is individual too, not baseline', (key, area) => {
    // The third individual grantee kind. It matters because `profile` rows are
    // the ones `governingInstanceIds` was invented for — they can restrict
    // org-wide — so a positive one must still behave as a grant, not a default.
    const rows = [myProfileRow(key, 'inst_prof', ResourcePermission.view)]
    const m = member({ profileLevels: areaClosed(area), orgRows: rows })

    expect(m.caps.instanceAccess).toEqual({ inst_prof: 'view' })
    expect(m.caps.baselineInstanceAccess).toEqual({})
    expect(levelFor(m, key, 'inst_prof')).toBe(ResourcePermission.view)
  })

  it.each(ALL_RESOURCES)('5. %s: no rows at all is denied', (key, area) => {
    const m = member({ profileLevels: areaClosed(area) })
    expect(levelFor(m, key, 'inst_nothing')).toBeUndefined()
    assertListAgrees(m, key, ['inst_nothing'])
  })
})

describe('§8 truth table — area Read (plan 43 §0.2a)', () => {
  it.each(
    ALL_RESOURCES
  )('6. %s: a `role:org_member @ view` baseline row REACHES a member at Read', (key, area) => {
    const rows = [baselineRow(key, 'inst_1', ResourcePermission.view)]
    const m = member({ profileLevels: areaAt(area, Level.Read), orgRows: rows })

    expect(m.server.areaLevel(area)).toBe(Level.Read)
    expect(levelFor(m, key, 'inst_1')).toBe(ResourcePermission.view)
    expect(m.server.canViewInstance(key, 'inst_1')).toBe(true)
    assertListAgrees(m, key, ['inst_1'])
  })

  it.each(
    ALL_RESOURCES
  )('7. %s: a `user @ admin` row is NOT clamped down to the area rung', (key, area) => {
    // The area gates WHETHER the baseline reaches you. It is not a ceiling on
    // an individual grant's tier — that would silently downgrade every share.
    const rows = [myRow(key, 'inst_mine', ResourcePermission.admin)]
    const m = member({ profileLevels: areaAt(area, Level.Read), orgRows: rows })

    expect(m.server.areaLevel(area)).toBe(Level.Read)
    expect(levelFor(m, key, 'inst_mine')).toBe(ResourcePermission.admin)
    expect(m.server.canAdminInstance(key, 'inst_mine')).toBe(true)
  })

  it.each(
    ALL_RESOURCES
  )('7b. %s: an individual `none` still denies at an OPEN area — restrictions bite in both lanes', (key, area) => {
    const rows = [myRow(key, 'inst_locked', ResourcePermission.none)]
    const m = member({ profileLevels: areaAt(area, Level.Full), orgRows: rows })
    expect(levelFor(m, key, 'inst_locked')).toBe(ResourcePermission.none)
    expect(m.server.canViewInstance(key, 'inst_locked')).toBe(false)
    assertListAgrees(m, key, ['inst_locked'])
  })

  it.each(
    ALL_RESOURCES
  )('7c. %s: a `role:org_member @ none` restriction denies at an OPEN area', (key, area) => {
    const rows = [baselineRow(key, 'inst_locked', ResourcePermission.none)]
    const m = member({ profileLevels: areaAt(area, Level.Full), orgRows: rows })
    expect(levelFor(m, key, 'inst_locked')).toBe(ResourcePermission.none)
    expect(m.server.canViewInstance(key, 'inst_locked')).toBe(false)
    assertListAgrees(m, key, ['inst_locked'])
  })

  it.each(
    ALL_RESOURCES
  )('7d. %s: an individual grant OUTRANKS a `role:org_member @ none` on the same instance', (key, area) => {
    // Both lanes carry a row for the same instance. Step 1 wins outright —
    // this is the "shared with me despite the workspace lockdown" case.
    const rows = [
      baselineRow(key, 'inst_locked', ResourcePermission.none),
      myRow(key, 'inst_locked', ResourcePermission.edit),
    ]
    const m = member({ profileLevels: areaAt(area, Level.Full), orgRows: rows })
    expect(m.caps.baselineInstanceAccess).toEqual({ inst_locked: 'none' })
    expect(m.caps.instanceAccess).toEqual({ inst_locked: 'edit' })
    expect(levelFor(m, key, 'inst_locked')).toBe(ResourcePermission.edit)
    assertListAgrees(m, key, ['inst_locked'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §8 item 8 — THE GUARD. The ordering in `effectiveInstanceLevel` is the design.
// ─────────────────────────────────────────────────────────────────────────────

describe('§8 item 8 — the ORDERING guard (plan 43 §4.2)', () => {
  /**
   * These two tests are the mutation guard the plan asks for, restated so the
   * next reader knows what breaks them:
   *
   *  - **Move step 1 (the individual lane) BELOW step 2 (the area gate)** and
   *    the first case fails. That ordering is **#1346** / plan 25 §2 —
   *    *"explicit instance grant overrides area None"* — and it is also what
   *    keeps a creator's own `user @ admin` row reachable, so breaking it costs
   *    every member the content they made.
   *  - **Move step 2 (the area gate) BELOW step 3 (the baseline row)** and the
   *    second case fails. That ordering is what makes `Dashboards: None` mean no
   *    dashboards, which is the lever plan 43 exists to ship.
   *
   * A "simplify the conditionals" pass therefore has to delete a FAILING test to
   * happen, which is the entire point of writing them as a pair.
   */
  it('step 1 above step 2: an individual grant survives a closed area (#1346, plan 43 §4.2)', () => {
    const m = member({
      profileLevels: areaClosed(Area.dashboards),
      orgRows: [myRow('dashboard', 'dash_shared', ResourcePermission.view)],
    })
    expect(levelFor(m, 'dashboard', 'dash_shared')).toBe(ResourcePermission.view)
  })

  it('step 2 above step 3: a closed area cuts off the workspace baseline (plan 43 §4.2)', () => {
    const m = member({
      profileLevels: areaClosed(Area.dashboards),
      orgRows: [baselineRow('dashboard', 'dash_org', ResourcePermission.view)],
    })
    expect(levelFor(m, 'dashboard', 'dash_org')).toBeUndefined()
  })

  it('both at once, on one member — the §0.2a worked example in a single assertion', () => {
    // Straight out of plan 43 §0.2a's table: `Dashboards: None`, one dashboard
    // shared with them by name, one carrying only the auto-written baseline.
    // Exactly one is reachable. This is the browser pass's case 2, in code.
    const m = member({
      profileLevels: areaClosed(Area.dashboards),
      orgRows: [
        baselineRow('dashboard', 'dash_org', ResourcePermission.view),
        baselineRow('dashboard', 'dash_shared', ResourcePermission.view),
        myRow('dashboard', 'dash_shared', ResourcePermission.view),
        myRow('dashboard', 'dash_mine', ResourcePermission.admin),
      ],
    })
    expect(levelFor(m, 'dashboard', 'dash_org')).toBeUndefined()
    expect(levelFor(m, 'dashboard', 'dash_shared')).toBe(ResourcePermission.view)
    expect(levelFor(m, 'dashboard', 'dash_mine')).toBe(ResourcePermission.admin)
    assertListAgrees(m, 'dashboard', ['dash_org', 'dash_shared', 'dash_mine', 'dash_absent'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §8 items 9 + 10 — the derived front door must not defeat the gate.
// ─────────────────────────────────────────────────────────────────────────────

describe('§8 item 9 — `deriveInstanceReadKeys` reads the INDIVIDUAL lane only (§4.4)', () => {
  it.each(
    ALL_RESOURCES
  )('%s: a baseline-only row at area None derives NO area view key', (key, area) => {
    const readKey = PERMISSION_AREAS[area].rungs.find((r) => r.level === Level.Read)?.keys[0]
    expect(readKey, `${area} must have a Read rung for this test to mean anything`).toBeDefined()

    const m = member({
      profileLevels: areaClosed(area),
      orgRows: [baselineRow(key, 'inst_1', ResourcePermission.view)],
    })
    // Before §4.4 this was TRUE for practically every member of every org with
    // a dashboard, and the front door stood open for exactly the profile an
    // admin had just closed.
    expect(m.caps.instanceDerivedKeys).toEqual([])
    expect(m.server.can(readKey as PermissionKey)).toBe(false)
  })

  it.each(ALL_RESOURCES)('%s: an INDIVIDUAL row at area None still derives it', (key, area) => {
    const readKey = PERMISSION_AREAS[area].rungs.find((r) => r.level === Level.Read)?.keys[0]
    const m = member({
      profileLevels: areaClosed(area),
      orgRows: [myRow(key, 'inst_1', ResourcePermission.view)],
    })
    expect(m.caps.instanceDerivedKeys).toEqual([readKey])
    expect(m.server.can(readKey as PermissionKey)).toBe(true)
  })
})

describe('§8 item 10 — `instanceDerivedKeys` does not defeat the gate', () => {
  it('an individual grant opens the front door AND resolves; a baseline row does neither', () => {
    // The load-bearing separation (`compose-user-capabilities.ts`): `keys`
    // answers "what is my area level", `keys ∪ instanceDerivedKeys` answers
    // "can I". If the two ever merge, step 2's gate silently stops firing for
    // every grant holder — the derived key would raise `areaLevelFromKeys` to
    // `Read` and the workspace baseline would flow again.
    const individual = member({
      profileLevels: areaClosed(Area.dashboards),
      orgRows: [myRow('dashboard', 'dash_1', ResourcePermission.view)],
    })
    expect(levelFor(individual, 'dashboard', 'dash_1')).toBe(ResourcePermission.view)
    expect(individual.server.can(PermissionKey.dashboardsView)).toBe(true)
    // …and the AREA level is still None, which is what keeps the gate armed.
    expect(individual.server.areaLevel(Area.dashboards)).toBe(Level.None)
    expect(areaLevelFromKeys(individual.client.keys, Area.dashboards)).toBe(Level.None)

    const baselineOnly = member({
      profileLevels: areaClosed(Area.dashboards),
      orgRows: [baselineRow('dashboard', 'dash_2', ResourcePermission.view)],
    })
    expect(levelFor(baselineOnly, 'dashboard', 'dash_2')).toBeUndefined()
    expect(baselineOnly.server.can(PermissionKey.dashboardsView)).toBe(false)
  })

  it('the derived key never leaks into the wire snapshot`s `keys`', () => {
    const m = member({
      profileLevels: areaClosed(Area.workflows),
      orgRows: [myRow('workflow', 'wf_1', ResourcePermission.admin)],
    })
    const wire = m.server.toClientCapabilities()
    expect(wire.keys).not.toContain(PermissionKey.workflowsView)
    expect(wire.instanceDerivedKeys).toContain(PermissionKey.workflowsView)
    // …so a row-LESS workflow is still denied, which is the whole reason the two
    // fields are separate.
    expect(levelFor(m, 'workflow', 'wf_other')).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §8 item 11 — the stale-blob simulation. This one asserts the BUG.
// ─────────────────────────────────────────────────────────────────────────────

describe('§8 item 11 — a stale `v15` blob FAILS OPEN (the proof the v16 bump is mandatory)', () => {
  /**
   * **This test asserts the WRONG answer on purpose.** Plan 43 §8 item 11 asks
   * for a stale-blob simulation and says: *"if it cannot be made to pass, that is
   * itself the proof the `v16` bump is mandatory rather than hygienic."* It
   * cannot. So the assertion below records the fail-open rather than pretending
   * it away, and the ledger entry at `user:capabilities:v16` cites it.
   *
   * The mechanism, exactly: a `v15` blob has NO `baselineInstanceAccess` — so
   * step 3 of the resolver finds nothing — but its `instanceAccess` still holds
   * the max-merged union of BOTH lanes, because that is what the old composer
   * wrote. Step 1 therefore returns the `role:org_member` permission as if it
   * were an individual grant, and step 2's gate never runs.
   *
   * The generalizable lesson, and the reason this was nearly missed: *"the new
   * field is absent, so it reads as empty"* is only safe when the fields AROUND
   * it still mean what they meant. Here `instanceAccess` NARROWED in the same
   * change, so the absence is not a gap — it is a wrong answer.
   */
  it('resolves the workspace baseline at area None when the blob predates the lane split', () => {
    const fresh = member({
      profileLevels: areaClosed(Area.dashboards),
      orgRows: [baselineRow('dashboard', 'dash_org', ResourcePermission.view)],
    })
    // Correct, v16-shaped answer: the lever works.
    expect(levelFor(fresh, 'dashboard', 'dash_org')).toBeUndefined()

    // The same member's blob as `v15` wrote it: one merged map, no second lane.
    const stale = {
      ...fresh.client,
      instanceAccess: { ...fresh.caps.instanceAccess, ...fresh.caps.baselineInstanceAccess },
      baselineInstanceAccess: undefined,
    }
    expect(effectiveInstanceLevel(stale, 'dashboard', 'dash_org')).toBe(ResourcePermission.view)
  })

  it('and the same staleness leaks the row into the LIST scope too', () => {
    const fresh = member({
      profileLevels: areaClosed(Area.dashboards),
      orgRows: [baselineRow('dashboard', 'dash_org', ResourcePermission.view)],
    })
    expect(privateInstanceListScope(fresh.client, 'dashboard')).toEqual({ kind: 'none' })

    const stale = {
      ...fresh.client,
      instanceAccess: { ...fresh.caps.instanceAccess, ...fresh.caps.baselineInstanceAccess },
      baselineInstanceAccess: undefined,
    }
    expect(privateInstanceListScope(stale, 'dashboard')).toEqual({
      kind: 'include',
      includeIds: ['dash_org'],
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §8 items 12–16 — the invariants C must NOT have disturbed.
// ─────────────────────────────────────────────────────────────────────────────

describe('§8 item 12 — the list scopes agree with the resolver on every row of the table', () => {
  it.each(ALL_RESOURCES)('%s: closed area, one of each lane', (key, area) => {
    const m = member({
      profileLevels: areaClosed(area),
      orgRows: [
        baselineRow(key, 'inst_baseline', ResourcePermission.view),
        myRow(key, 'inst_mine', ResourcePermission.admin),
        myRow(key, 'inst_locked', ResourcePermission.none),
      ],
    })
    assertListAgrees(m, key, ['inst_baseline', 'inst_mine', 'inst_locked', 'inst_absent'])
  })

  it.each(ALL_RESOURCES)('%s: open area, one of each lane', (key, area) => {
    const m = member({
      profileLevels: areaAt(area, Level.Full),
      orgRows: [
        baselineRow(key, 'inst_baseline', ResourcePermission.view),
        baselineRow(key, 'inst_restricted', ResourcePermission.none),
        myRow(key, 'inst_mine', ResourcePermission.admin),
        myRow(key, 'inst_locked', ResourcePermission.none),
      ],
    })
    assertListAgrees(m, key, [
      'inst_baseline',
      'inst_restricted',
      'inst_mine',
      'inst_locked',
      'inst_absent',
    ])
  })

  it('`deniesAll` is gone but its job is not: a closed area still spares individual grants', () => {
    // Plan 30 made the "deny everything at area None" arm load-bearing (shipping
    // the exclusion without it would have leaked every workflow to a
    // `workflows: None` member). Under C that arm must now SPARE instances the
    // member holds an individual grant on, or the list drops rows the resolver
    // allows. It presents as a support ticket rather than a leak, which is
    // exactly why it needs a test rather than a review.
    const m = member({
      profileLevels: areaClosed(Area.workflows),
      orgRows: [
        myRow('workflow', 'wf_mine', ResourcePermission.view),
        baselineRow('workflow', 'wf_org', ResourcePermission.view),
      ],
    })
    expect(instanceListScope(m.client, 'workflow')).toEqual({
      kind: 'include',
      includeIds: ['wf_mine'],
    })
  })
})

describe('§8 item 13 — the seat ceiling still dominates everything', () => {
  it.each(
    ALL_RESOURCES
  )('%s: a worker seat at area Full holding an `admin` row still resolves nothing', (key, area) => {
    // None of the nine areas is in `WORKER_AREAS`, so the ceiling closes all of
    // them. The clamp sits ABOVE both lanes and above the OWNER bypass for the
    // private resources — a billing invariant outranks every row.
    expect(SEAT_CEILINGS.worker[area]).toBe(Level.None)
    const m = member({
      seatType: 'worker',
      profileLevels: areaAt(area, Level.Full),
      orgRows: [myRow(key, 'inst_mine', ResourcePermission.admin)],
    })
    expect(levelFor(m, key, 'inst_mine')).toBeUndefined()
    assertListAgrees(m, key, ['inst_mine'])
  })
})

describe('§8 item 14 — the OWNER bypass is unchanged (plan 36 §0.6)', () => {
  it.each(ALL_RESOURCES)('%s: OWNER bypasses org-shared only, and C did not move that', (key) => {
    const cfg = INSTANCE_ACCESS_RESOURCES[key]
    const m = member({ role: 'OWNER' })
    const answer = levelFor(m, key, 'inst_nothing')
    expect(answer).toBe(cfg.baselineAtCreate ? undefined : ResourcePermission.admin)
  })

  it('an OWNER at area None still gets nothing on a private resource, baseline row or not', () => {
    // The bypass is scoped away from `baselineAtCreate: true`, so an owner runs
    // the same gate everyone else does — including step 2.
    const m = member({
      role: 'OWNER',
      profileLevels: areaClosed(Area.signatures),
      orgRows: [baselineRow('signature', 'sig_1', ResourcePermission.view)],
    })
    // NOTE: OWNER short-circuits `composeUserCapabilities` to the seat ceiling,
    // so their AREA level is Full regardless of the profile — that is §0.10's
    // recovery guarantee and is not what this asserts. What it asserts is that
    // the private-resource path has no owner arm.
    expect(levelFor(m, 'signature', 'sig_absent')).toBeUndefined()
  })
})

describe('§8 item 15 — a stored legacy `Level.Edit` composes to Read, not Full', () => {
  it.each([
    Area.signatures,
    Area.snippets,
    Area.dashboards,
  ] as const)('%s: level 2 yields exactly the Read rung after §3.1 dropped the Edit rung', (area) => {
    // Dev holds ZERO `PermissionGrant` rows storing `2` for any of the three
    // (checked before §3.1 shipped, the bar #1344 set), so this is a
    // defensive characterization rather than a live case — but `Level` is
    // ordinal and a stored 2 is still readable, so it needs a defined answer.
    // `areaLevelFromKeys` walks rungs in ascending order and stops at the
    // first unheld one, so level 2 grants the Read rung and stops: it can
    // never round UP into `Full` / create.
    const m = member({ profileLevels: { [area]: Level.Edit } })
    expect(m.server.areaLevel(area)).toBe(Level.Read)

    const rungs = PERMISSION_AREAS[area].rungs
    expect(rungs.map((r) => r.level)).toEqual([Level.Read, Level.Full])
    for (const key of rungs[0]?.keys ?? []) expect(m.server.can(key)).toBe(true)
    for (const key of rungs[1]?.keys ?? []) expect(m.server.can(key)).toBe(false)
  })

  it.each([
    Area.signatures,
    Area.snippets,
    Area.dashboards,
  ] as const)('%s: the `*Edit` PermissionKey survives as instance-ladder vocabulary', (area) => {
    // §3.1 dropped the RUNG, not the KEY: `ResourcePermission.edit` is a real
    // per-instance tier that `assertEditInstance` enforces. Deleting the enum
    // member would break it.
    const editKey = `${area}.edit` as PermissionKey
    expect(Object.values(PermissionKey)).toContain(editKey)
    // …and no rung emits it any more, at any level.
    expect(PERMISSION_AREAS[area].rungs.flatMap((r) => r.keys)).not.toContain(editKey)
  })
})

describe('§8 item 16 — `inbox` and `personal_inbox` obey the one rule though they share an area', () => {
  it('a closed `inboxes` area cuts the baseline off BOTH keys', () => {
    const m = member({
      profileLevels: areaClosed(Area.inboxes),
      orgRows: [
        baselineRow('inbox', 'ib_shared', ResourcePermission.view),
        baselineRow('personal_inbox', 'pib_other', ResourcePermission.view),
      ],
    })
    expect(levelFor(m, 'inbox', 'ib_shared')).toBeUndefined()
    expect(levelFor(m, 'personal_inbox', 'pib_other')).toBeUndefined()
  })

  it('an individual grant reaches through on BOTH keys — a regression here breaks org mail', () => {
    const m = member({
      profileLevels: areaClosed(Area.inboxes),
      orgRows: [
        myRow('inbox', 'ib_mine', ResourcePermission.edit),
        myRow('personal_inbox', 'pib_mine', ResourcePermission.admin),
      ],
    })
    expect(levelFor(m, 'inbox', 'ib_mine')).toBe(ResourcePermission.edit)
    expect(levelFor(m, 'personal_inbox', 'pib_mine')).toBe(ResourcePermission.admin)
  })

  it('the two keys still differ ONLY in their fall-through, which is all `baselineAtCreate` means', () => {
    const m = member({ profileLevels: areaAt(Area.inboxes, Level.Read) })
    expect(levelFor(m, 'inbox', 'ib_rowless')).toBe(ResourcePermission.view)
    expect(levelFor(m, 'personal_inbox', 'pib_rowless')).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §8 items 16a–16c — the §3.2 USER-rank floor.
// ─────────────────────────────────────────────────────────────────────────────

describe('§8 item 16a — the §3.2 floor: unset and explicit None must stay distinguishable', () => {
  it.each([
    ['dashboards', Area.dashboards, 'dashboard'],
    ['snippets', Area.snippets, 'snippet'],
    ['signatures', Area.signatures, 'signature'],
  ] as const)('%s: a USER-rank profile SILENT on the area receives the workspace baseline', (_name, area, key) => {
    // `support_rep` — the one real custom profile in dev — is exactly this
    // shape: rank USER, no `PermissionGrant` row at all. Without §3.2's floor
    // it would compose `None` and §4's gate would deny it the org baseline.
    const m = member({
      // `{}` is the SILENT profile — a `PermissionGrant` row that sets nothing,
      // or none at all. Not `undefined`, which this harness reads as "use the
      // seeded Member baseline".
      profileLevels: {},
      profileBaseLevel: null,
      orgRows: [baselineRow(key, 'inst_org', ResourcePermission.view)],
    })
    expect(m.server.areaLevel(area)).toBe(Level.Read)
    expect(levelFor(m, key, 'inst_org')).toBe(ResourcePermission.view)
  })

  it.each([
    ['dashboards', Area.dashboards, 'dashboard'],
    ['snippets', Area.snippets, 'snippet'],
    ['signatures', Area.signatures, 'signature'],
  ] as const)('%s: the SAME profile storing an explicit None does not', (_name, area, key) => {
    // The whole of §0.5(A) is that these two states differ. A single `?? Level.None`
    // creeping back into the fall-through chain collapses them, and the deny lever
    // silently becomes the default.
    const m = member({
      profileLevels: { [area]: Level.None },
      profileBaseLevel: null,
      orgRows: [baselineRow(key, 'inst_org', ResourcePermission.view)],
    })
    expect(m.server.areaLevel(area)).toBe(Level.None)
    expect(levelFor(m, key, 'inst_org')).toBeUndefined()
  })

  it('the floor lives in ROLE_DEFAULTS.USER and nowhere else', () => {
    expect(ROLE_DEFAULTS.USER[Area.signatures]).toBe(Level.Read)
    expect(ROLE_DEFAULTS.USER[Area.snippets]).toBe(Level.Read)
    expect(ROLE_DEFAULTS.USER[Area.dashboards]).toBe(Level.Read)
    // Every other area is still the `None` floor plan 22 shipped — §3.2 is three
    // entries, not a general relaxation.
    for (const area of Object.values(Area)) {
      if (area === Area.signatures || area === Area.snippets || area === Area.dashboards) continue
      expect(ROLE_DEFAULTS.USER[area], area).toBe(Level.None)
    }
  })
})

describe('§8 item 16b — the floor does NOT leak', () => {
  it.each([
    ['signatures', 'signature'],
    ['snippets', 'snippet'],
    ['dashboards', 'dashboard'],
  ] as const)('%s: a silent USER-rank profile still resolves undefined on an instance with no rows', (_name, key) => {
    // `Read` is permission to RECEIVE a workspace default, not a grant. All
    // three are `baselineAtCreate: true`, so with no `ResourceAccess` row
    // `instanceFallbackLevel` returns `undefined` by construction — which is
    // what makes §3.2 cost nothing.
    const m = member({ profileLevels: {}, profileBaseLevel: null })
    expect(levelFor(m, key, 'inst_nothing')).toBeUndefined()
    expect(instanceFallbackLevel(m.client, key)).toBeUndefined()
    expect(privateInstanceListScope(m.client, key)).toEqual({ kind: 'none' })
  })

  it('and the floor never reaches the CREATE rung', () => {
    const m = member({ profileLevels: {}, profileBaseLevel: null })
    expect(m.server.can(PermissionKey.signaturesManage)).toBe(false)
    expect(m.server.can(PermissionKey.snippetsManage)).toBe(false)
    expect(m.server.can(PermissionKey.dashboardsManage)).toBe(false)
    // Plan 22 §2.5's "a new area ships CLOSED" still holds for the one rung that
    // grants anything.
  })
})

describe('§8 item 16c — ADMIN/OWNER and the Member profile are untouched by §3.2', () => {
  it('ROLE_DEFAULTS.ADMIN and .OWNER are still all-Full', () => {
    for (const area of Object.values(Area)) {
      expect(ROLE_DEFAULTS.ADMIN[area], area).toBe(Level.Full)
      expect(ROLE_DEFAULTS.OWNER[area], area).toBe(Level.Full)
    }
  })

  it('the Member profile stores all three explicitly, so it never reaches the floor', () => {
    // This is the distinction §0.5 warns about twice: `ROLE_RANK_LABEL` renders
    // rank USER as the word "Member", so "the member default" is ambiguous in
    // this codebase. The Member PROFILE is a data row; the USER-RANK FLOOR is
    // this code. Changing the floor cannot move the profile.
    expect(MEMBER_BASELINE_LEVELS[Area.signatures]).toBe(Level.Full)
    expect(MEMBER_BASELINE_LEVELS[Area.snippets]).toBe(Level.Full)
    expect(MEMBER_BASELINE_LEVELS[Area.dashboards]).toBe(Level.Full)

    const m = member({ profileLevels: MEMBER_BASELINE_LEVELS })
    expect(m.server.areaLevel(Area.signatures)).toBe(Level.Full)
    expect(m.server.areaLevel(Area.snippets)).toBe(Level.Full)
    expect(m.server.areaLevel(Area.dashboards)).toBe(Level.Full)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2.2 + §3.1 — the registry itself. A lint-style assertion over the copy is
// worth more than three render tests (plan 43 §8 item 26, lib half).
// ─────────────────────────────────────────────────────────────────────────────

describe('§2.2 — the three area descriptions are NOUN PHRASES, not rights lists', () => {
  const PRIVATE_THREE = [Area.signatures, Area.snippets, Area.dashboards] as const

  it.each(PRIVATE_THREE)('%s says what the feature IS', (area) => {
    expect(PERMISSION_AREAS[area].description).toBe(
      {
        [Area.signatures]: 'Email signatures members can add to their replies.',
        [Area.snippets]: 'Saved reply snippets members can insert.',
        [Area.dashboards]: 'Dashboards and the widgets on them.',
      }[area]
    )
  })

  it.each(PRIVATE_THREE)('%s never promises SHARING from the area ladder', (area) => {
    // "Share" was the wrong verb in all three regardless of shape: sharing is the
    // per-instance `admin` rung, reachable from no position on an area ladder.
    expect(PERMISSION_AREAS[area].description.toLowerCase()).not.toContain('share')
  })

  it.each(PRIVATE_THREE)('%s does not claim the rung closes the feature outright', (area) => {
    // Post-§0.2a, "closes X entirely" / "everyone in the workspace" are FALSE:
    // the rung gates the workspace default only, and something shared directly
    // still reaches the member.
    const text = PERMISSION_AREAS[area].description.toLowerCase()
    for (const banned of ['closes', 'entirely', 'everyone in the workspace']) {
      expect(text, `${area} must not say "${banned}"`).not.toContain(banned)
    }
  })
})

describe('§3.1 — the three ladders are Read/Full, and the `*Edit` KEYS survive', () => {
  it.each([
    Area.signatures,
    Area.snippets,
    Area.dashboards,
  ] as const)('%s has exactly two rungs', (area) => {
    expect(PERMISSION_AREAS[area].rungs.map((r) => r.level)).toEqual([Level.Read, Level.Full])
  })

  it('the areas that KEEP their Edit rung are untouched', () => {
    // §3.1 is three areas, not a general pruning. The other instance-access
    // areas' Edit rungs are real fallback tiers (`baselineAtCreate: false` means
    // the area level IS the absent-row answer), so removing one would silently
    // re-tier every row-less dataset / KB / workflow / agent.
    for (const area of [Area.datasets, Area.knowledgeBase, Area.workflows, Area.agents] as const) {
      expect(PERMISSION_AREAS[area].rungs.map((r) => r.level)).toEqual([
        Level.Read,
        Level.Edit,
        Level.Full,
      ])
    }
    // `inboxes` was already partial before plan 43 (plan 40 §1.1) — the precedent.
    expect(PERMISSION_AREAS[Area.inboxes].rungs.map((r) => r.level)).toEqual([
      Level.Read,
      Level.Full,
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4.3 — `instanceFallbackLevel` is unchanged and must stay aligned.
// ─────────────────────────────────────────────────────────────────────────────

describe('§4.3 — `instanceFallbackLevel` already denies at area None, and still agrees', () => {
  it.each(
    ALL_RESOURCES
  )('%s: the fallback and the resolver answer alike for a row-LESS instance', (key, area) => {
    for (const level of [Level.None, Level.Read, Level.Edit, Level.Full]) {
      const m = member({ profileLevels: areaAt(area, level) })
      expect(levelFor(m, key, 'inst_rowless'), `${key} @ ${Level[level] ?? level}`).toBe(
        instanceFallbackLevel(m.client, key)
      )
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4.1/§4.4 — the two readers of the lane rule must agree about an UNKNOWN
// grantee kind. Found in review of this slice, not in the plan text.
// ─────────────────────────────────────────────────────────────────────────────

describe('§4.1 — an UNRECOGNIZED grantee kind sorts into the GATED lane', () => {
  /**
   * Two places sort a `ResourceAccess` row into a lane: the split in
   * `composeUserCapabilities` and the `instanceDerivedKeys` filter (§4.4). Both
   * shipped as `granteeType !== 'role'`, which sorts an unknown kind into the
   * INDIVIDUAL lane — the one that bypasses the area gate — while the split's own
   * comment claimed the opposite. Nothing can produce such a row today
   * (`computeUserCapabilities`' WHERE clause selects four known kinds), so this
   * pins the DIRECTION for whoever adds the fifth.
   *
   * `governingInstanceIdsProvider` records the same hazard: *"Adding a grantee
   * kind to the storage vocabulary still means adding it to every reader in the
   * same change."*
   */
  const unknownRow = {
    entityDefinitionId: 'dashboard',
    entityInstanceId: 'dash_unknown',
    permission: ResourcePermission.admin,
    granteeType: 'team' as ResourceGranteeType,
  }

  it('lands in `baselineInstanceAccess`, never in `instanceAccess`', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: MEMBER_BASELINE_LEVELS,
      profileBaseLevel: null,
      typeAccessRows: [],
      instanceAccessRows: [unknownRow],
    })

    expect(caps.instanceAccess).toEqual({})
    expect(caps.baselineInstanceAccess).toEqual({ dash_unknown: ResourcePermission.admin })
  })

  it('is GATED by an area at None, unlike a real individual grant', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.dashboards]: Level.None },
      profileBaseLevel: null,
      typeAccessRows: [],
      instanceAccessRows: [unknownRow],
    })

    const resolved = toResolvedRecordAccess({
      ...caps,
      role: 'USER',
      seatType: 'full',
      restrictedEntityDefIds: [],
    })
    expect(effectiveInstanceLevel(resolved, 'dashboard', 'dash_unknown')).toBeUndefined()
  })

  it('does NOT derive a front-door `<area>.view` key', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: { ...MEMBER_BASELINE_LEVELS, [Area.dashboards]: Level.None },
      profileBaseLevel: null,
      typeAccessRows: [],
      instanceAccessRows: [unknownRow],
    })

    expect(caps.instanceDerivedKeys).not.toContain(PermissionKey.dashboardsView)
  })
})
