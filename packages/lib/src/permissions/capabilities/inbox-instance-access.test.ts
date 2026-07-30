// packages/lib/src/permissions/capabilities/inbox-instance-access.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { CapabilitySet } from './capability-set'
import { composeUserCapabilities } from './compose-user-capabilities'
import {
  effectiveInstanceLevel,
  instanceFallbackLevel,
  toResolvedRecordAccess,
} from './entity-access'
import {
  INSTANCE_ACCESS_READ_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
} from './instance-access'
import { AREA_ORDER, Area, Level, PERMISSION_AREAS, PermissionKey } from './registry'
import { MEMBER_BASELINE_LEVELS, SEAT_CEILINGS } from './seat-policy'

/**
 * Plan 40 phase 1 — `Area.inboxes` plus the two mail instance-access keys.
 *
 * Behavioral throughout: every case starts from the `ResourceAccess` rows a
 * member's grantee union actually returns, runs them through
 * `composeUserCapabilities`, and only then resolves the gate — the same
 * "row → blob → gate" path `capability-set-instance.test.ts` exercises, so a
 * break anywhere along it fails here rather than a source-text assertion passing
 * over it.
 *
 * The load-bearing claim these cases exist to pin is the TWO-KEY split
 * (§0.2): `inbox` and `personal_inbox` share one area but have opposite
 * `baselineAtCreate` postures, and the whole reason for the second key is that
 * `effectiveInstanceLevel`'s OWNER short-circuit is scoped to
 * `baselineAtCreate: false`. If someone ever collapses them to one key, the
 * owner-on-a-personal-mailbox case below is what should stop them.
 */

interface MemberOpts {
  role?: OrganizationRole
  seatType?: SeatType
  profileLevels?: Partial<Record<Area, Level>>
  rows?: Array<{
    entityDefinitionId?: InstanceAccessKey
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
      entityDefinitionId: 'inbox',
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
  // The client only ever sees the wire snapshot — build its view from that, so a
  // field dropped in serialization shows up here.
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

/** A profile that closes mail entirely — every other area untouched. */
const MAIL_CLOSED: Partial<Record<Area, Level>> = {
  ...MEMBER_BASELINE_LEVELS,
  [Area.inboxes]: Level.None,
}
const MAIL_ADMIN: Partial<Record<Area, Level>> = {
  ...MEMBER_BASELINE_LEVELS,
  [Area.inboxes]: Level.Full,
}

describe('the registry shape itself (plan 40 §1.1)', () => {
  it('is a TWO-rung ladder — Read then Full, and no Edit rung to fall on', () => {
    expect(PERMISSION_AREAS[Area.inboxes].rungs).toEqual([
      { level: Level.Read, keys: [PermissionKey.inboxesView] },
      { level: Level.Full, keys: [PermissionKey.inboxesManage] },
    ])
    // The absent `Edit` rung is why `edit` is dead vocabulary for both mail
    // instance keys: the fallback can only ever produce what a rung maps to.
    expect(PERMISSION_AREAS[Area.inboxes].rungs.some((rung) => rung.level === Level.Edit)).toBe(
      false
    )
  })

  it('both mail keys hang off ONE area with OPPOSITE postures', () => {
    expect(INSTANCE_ACCESS_RESOURCES.inbox).toEqual({
      baselineAtCreate: false,
      area: Area.inboxes,
    })
    expect(INSTANCE_ACCESS_RESOURCES.personal_inbox).toEqual({
      baselineAtCreate: true,
      area: Area.inboxes,
    })
  })

  it('declares `inboxes` immediately after `channels`, which is what groups the row', () => {
    // `areaGroups()` (apps/web `profile-copy.ts`) walks AREA_ORDER — i.e. enum
    // declaration order — so this is not cosmetic: it is what puts the row under
    // the existing Channels heading instead of trailing behind every unrelated
    // area. Pinned here, where AREA_ORDER lives, rather than in the web package
    // that consumes it.
    expect(AREA_ORDER[AREA_ORDER.indexOf(Area.channels) + 1]).toBe(Area.inboxes)
    expect(PERMISSION_AREAS[Area.inboxes].group).toBe(PERMISSION_AREAS[Area.channels].group)
    // The four Channels-group areas, contiguous and in render order.
    const channelsGroup = AREA_ORDER.filter((area) => PERMISSION_AREAS[area].group === 'Channels')
    expect(channelsGroup).toEqual([Area.channels, Area.inboxes, Area.signatures, Area.snippets])
  })

  it('derives the Read-rung key for both mail keys (the plan-25 front-door path)', () => {
    expect(INSTANCE_ACCESS_READ_KEYS.inbox).toEqual([PermissionKey.inboxesView])
    expect(INSTANCE_ACCESS_READ_KEYS.personal_inbox).toEqual([PermissionKey.inboxesView])
  })
})

describe('org-shared inboxes — the area rung IS the row-less tier (§1.2)', () => {
  it('a member at `inboxes: None` is denied every org-shared inbox', () => {
    const m = member({ profileLevels: MAIL_CLOSED })
    expect(m.server.areaLevel(Area.inboxes)).toBe(Level.None)
    expect(levelFor(m, 'inbox', 'ib_support')).toBeUndefined()
    expect(levelFor(m, 'inbox', 'ib_sales')).toBeUndefined()
    expect(instanceFallbackLevel(m.client, 'inbox')).toBeUndefined()
  })

  it('a member at `inboxes: Read` resolves `view` on a row-less shared inbox', () => {
    const m = member()
    expect(m.server.areaLevel(Area.inboxes)).toBe(Level.Read)
    expect(levelFor(m, 'inbox', 'ib_support')).toBe(ResourcePermission.view)
  })

  it('a member at `inboxes: Full` resolves `admin` — Manager of EVERY row-less inbox', () => {
    // This is the surprising consequence the area's comment exists to state:
    // `Full` is not "a bigger front door", it is mail administrator.
    const m = member({ profileLevels: MAIL_ADMIN })
    expect(levelFor(m, 'inbox', 'ib_support')).toBe(ResourcePermission.admin)
    expect(levelFor(m, 'inbox', 'ib_any_other_one')).toBe(ResourcePermission.admin)
  })

  it('an explicit `role:org_member @ none` row beats the area fallback', () => {
    const m = member({
      rows: [{ entityDefinitionId: 'inbox', entityInstanceId: 'ib_locked', permission: 'none' }],
    })
    // The area is open and untouched — the row alone is what denies.
    expect(m.server.areaLevel(Area.inboxes)).toBe(Level.Read)
    expect(levelFor(m, 'inbox', 'ib_locked')).toBe(ResourcePermission.none)
    // ...and only that one inbox: the fallback still opens the rest.
    expect(levelFor(m, 'inbox', 'ib_support')).toBe(ResourcePermission.view)
  })

  it('an OWNER resolves `admin` on a row-less shared inbox (the `false` posture)', () => {
    // The positive control for the personal-mailbox case below: the OWNER
    // short-circuit is not gone, it is SCOPED.
    const m = member({ role: 'OWNER', profileLevels: MAIL_CLOSED })
    expect(levelFor(m, 'inbox', 'ib_support')).toBe(ResourcePermission.admin)
  })
})

describe('personal mailboxes — the whole reason there are two keys (§0.2)', () => {
  it('an OWNER does NOT resolve `admin` on a `personal_inbox` instance', () => {
    // A single `baselineAtCreate: false` key would have handed the org owner
    // every member's private mailbox at full lens, and an explicit
    // `role:org_member @ none` row would NOT have stopped it, because the OWNER
    // branch of `effectiveInstanceLevel` runs first. This is the assertion that
    // makes collapsing the two keys fail loudly.
    const m = member({ role: 'OWNER', profileLevels: MAIL_ADMIN })
    expect(levelFor(m, 'personal_inbox', 'pib_lutz')).toBeUndefined()
    expect(instanceFallbackLevel(m.client, 'personal_inbox')).toBeUndefined()
  })

  it('no area rung opens a row-less personal mailbox — not even `Full`', () => {
    for (const levels of [MEMBER_BASELINE_LEVELS, MAIL_ADMIN, MAIL_CLOSED]) {
      const m = member({ profileLevels: levels })
      expect(levelFor(m, 'personal_inbox', 'pib_lutz')).toBeUndefined()
    }
  })

  it('an explicit row IS how a personal mailbox opens — the owner keeps their own', () => {
    const m = member({
      profileLevels: MAIL_CLOSED,
      rows: [
        { entityDefinitionId: 'personal_inbox', entityInstanceId: 'pib_mine', permission: 'admin' },
      ],
    })
    expect(levelFor(m, 'personal_inbox', 'pib_mine')).toBe(ResourcePermission.admin)
    // Somebody else's mailbox stays shut, area level notwithstanding.
    expect(levelFor(m, 'personal_inbox', 'pib_theirs')).toBeUndefined()
  })
})

describe('positive controls — the derived-key front door (plan 25 §2)', () => {
  it('a member at area `None` with ONE `view` row still reaches that inbox', () => {
    // The repo's instance-access tests are denial-shaped; this is the
    // over-denial direction. A profile that closes mail must not close the ONE
    // inbox somebody was explicitly granted.
    const m = member({
      profileLevels: MAIL_CLOSED,
      rows: [{ entityDefinitionId: 'inbox', entityInstanceId: 'ib_only', permission: 'view' }],
    })
    expect(levelFor(m, 'inbox', 'ib_only')).toBe(ResourcePermission.view)
    // ...and exactly that one.
    expect(levelFor(m, 'inbox', 'ib_other')).toBeUndefined()
  })

  it('...and the coarse front-door key is synthesized from that row', () => {
    // Without this, every coarse gate (sidebar, cmd+K, the page guard phase 3
    // adds) would fire against a member who genuinely has mail access.
    const m = member({
      profileLevels: MAIL_CLOSED,
      rows: [{ entityDefinitionId: 'inbox', entityInstanceId: 'ib_only', permission: 'view' }],
    })
    expect(m.caps.instanceDerivedKeys).toContain(PermissionKey.inboxesView)
    expect(m.server.can(PermissionKey.inboxesView)).toBe(true)
    // The Read rung only — an instance grant must never confer the manage key.
    expect(m.server.can(PermissionKey.inboxesManage)).toBe(false)
  })

  it('a personal-mailbox `view` row opens the same front door', () => {
    const m = member({
      profileLevels: MAIL_CLOSED,
      rows: [
        { entityDefinitionId: 'personal_inbox', entityInstanceId: 'pib_mine', permission: 'view' },
      ],
    })
    expect(m.server.can(PermissionKey.inboxesView)).toBe(true)
  })
})

describe('seats and baselines (plan 40 §7)', () => {
  it('the Member baseline is `Read` — full working access, NOT Manager-of-everything', () => {
    expect(MEMBER_BASELINE_LEVELS[Area.inboxes]).toBe(Level.Read)
  })

  it('a worker seat is clamped to `None` and gets nothing, even holding an `admin` row', () => {
    // The ceiling is checked ABOVE the explicit-row branch, which is what makes
    // this the fix rather than a suggestion: today a worker seat reads every org
    // inbox at `full` because mail has no area for the ceiling to clamp.
    expect(SEAT_CEILINGS.worker[Area.inboxes]).toBe(Level.None)
    const m = member({
      seatType: 'worker',
      profileLevels: MAIL_ADMIN,
      rows: [{ entityDefinitionId: 'inbox', entityInstanceId: 'ib_support', permission: 'admin' }],
    })
    expect(levelFor(m, 'inbox', 'ib_support')).toBeUndefined()
    expect(levelFor(m, 'inbox', 'ib_other')).toBeUndefined()
  })

  it('a FULL seat is not clamped — the same member/rows resolve normally', () => {
    // Negative control for the clamp above: it must be the SEAT doing the
    // denying, not something in the row or the profile.
    const m = member({
      seatType: 'full',
      profileLevels: MAIL_ADMIN,
      rows: [{ entityDefinitionId: 'inbox', entityInstanceId: 'ib_support', permission: 'admin' }],
    })
    expect(levelFor(m, 'inbox', 'ib_support')).toBe(ResourcePermission.admin)
  })
})
