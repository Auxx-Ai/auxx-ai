// packages/lib/src/permissions/capabilities/instance-sharing-vs-restriction.test.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { isGoverningInstanceRow } from '../../cache/providers/governing-instance-ids-provider'
import { CapabilitySet } from './capability-set'
import { composeUserCapabilities } from './compose-user-capabilities'
import {
  effectiveInstanceLevel,
  instanceListScope,
  type OrgSharedInstanceAccessKey,
  type PrivateInstanceAccessKey,
  privateInstanceListScope,
  toResolvedRecordAccess,
} from './entity-access'
import {
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  isInstanceAccessKey,
} from './instance-access'
import { type Area, Level } from './registry'
import { MEMBER_BASELINE_LEVELS } from './seat-policy'

/**
 * **Sharing is not restricting** — the 2026-07-29 fix to `effectiveInstanceLevel`
 * and its `capability-set.ts` twin.
 *
 * Before it, the org-wide set the resolver consulted meant *"this instance
 * carries ≥1 `ResourceAccess` row for ANYONE"*, and an instance in that set
 * resolved to the member's own row — `undefined` included. So the FIRST explicit
 * row written on an instance silently converted it to grantees-only for the whole
 * org, while every other layer meant *"has a RESTRICTION"*: mail's `rowGoverned`,
 * the Workspace-defaults tab's three-state model, migration 060's baseline rows.
 *
 * The live damage was mail-only, because `inbox` is the only
 * `baselineAtCreate: false` key whose create path writes a row — a default org
 * ADMIN at `inboxes: Full` 403'd on the Access section of any inbox they did not
 * create. But the mechanism was general, so the cases below cover EVERY
 * instance-access resource, in both postures.
 *
 * Two properties are load-bearing and are asserted separately, because getting
 * either alone would be a regression:
 *  1. the set is narrowed to GOVERNING rows (`role:org_member` at any permission,
 *     or any `none` marker) — otherwise the inbox 403 survives;
 *  2. the member's OWN row is read BEFORE the set — otherwise every
 *     `baselineAtCreate: true` creator loses their own signature / snippet /
 *     dashboard / personal mailbox, since a lone creator row no longer governs.
 *
 * Every case runs BOTH resolvers (the private `CapabilitySet` copy and the
 * client mirror reached through the real wire snapshot) and both list scopes,
 * because two copies of one rule that disagree is the failure this whole family
 * of tests exists to prevent.
 */

/** One `ResourceAccess` instance row as the org stores it. */
interface OrgRow {
  key: InstanceAccessKey
  instanceId: string
  granteeType: ResourceGranteeType
  granteeId: string
  permission: ResourcePermission
}

const baseline = (key: InstanceAccessKey, instanceId: string, permission: ResourcePermission) =>
  ({
    key,
    instanceId,
    granteeType: ResourceGranteeType.role,
    granteeId: 'org_member',
    permission,
  }) satisfies OrgRow

const userRow = (
  key: InstanceAccessKey,
  instanceId: string,
  granteeId: string,
  permission: ResourcePermission
) =>
  ({
    key,
    instanceId,
    granteeType: ResourceGranteeType.user,
    granteeId,
    permission,
  }) satisfies OrgRow

const profileRow = (key: InstanceAccessKey, instanceId: string, permission: ResourcePermission) =>
  ({
    key,
    instanceId,
    granteeType: ResourceGranteeType.profile,
    granteeId: 'prof_1',
    permission,
  }) satisfies OrgRow

interface MemberOpts {
  role?: OrganizationRole
  seatType?: SeatType
  /** Sparse profile levels; defaults to the seeded Member baseline. */
  profileLevels?: Partial<Record<Area, Level>>
  /** The blanket rung for areas `profileLevels` does not set. */
  profileBaseLevel?: Level | null
  /** EVERY instance row in the org — the governing set is derived from these. */
  orgRows?: OrgRow[]
  /** Which of `orgRows` reach THIS member through their grantee union. */
  isMine?: (row: OrgRow) => boolean
}

/**
 * Build the member the way production does: rows → `composeUserCapabilities` →
 * `CapabilitySet`, with the org-wide governing set derived from the org's rows
 * through the SAME `isGoverningInstanceRow` predicate the cache provider and the
 * escalation guard use. Nothing here re-states the rule under test.
 */
function member(opts: MemberOpts = {}) {
  const role = opts.role ?? 'USER'
  const seatType = opts.seatType ?? 'full'
  const orgRows = opts.orgRows ?? []
  const mine = opts.isMine ?? ((row: OrgRow) => row.granteeType === ResourceGranteeType.role)

  const caps = composeUserCapabilities({
    role,
    seatType,
    profileLevels: opts.profileLevels ?? MEMBER_BASELINE_LEVELS,
    profileBaseLevel: opts.profileBaseLevel ?? null,
    typeAccessRows: [],
    instanceAccessRows: orgRows.filter(mine).map((row) => ({
      entityDefinitionId: row.key,
      entityInstanceId: row.instanceId,
      permission: row.permission,
      // Real grantee kind, straight off the row — this harness has always built
      // from `OrgRow`, so plan 43 §4.1's lane split needs nothing invented here.
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
  return { server, client: toResolvedRecordAccess(server.toClientCapabilities()), governing }
}

type Member = ReturnType<typeof member>

/** Resolve through BOTH copies of the rule and assert they agree. */
function levelFor(m: Member, key: InstanceAccessKey, instanceId: string) {
  const client = effectiveInstanceLevel(m.client, key, instanceId)
  expect(m.server.instanceLevel(key, instanceId)).toBe(client)
  return client
}

/** Assert the LIST filter reproduces the point check for the given ids. */
function assertListAgrees(m: Member, key: InstanceAccessKey, ids: string[]) {
  const cfg = INSTANCE_ACCESS_RESOURCES[key]
  const scope = cfg.baselineAtCreate
    ? privateInstanceListScope(m.client, key as PrivateInstanceAccessKey)
    : instanceListScope(m.client, key as OrgSharedInstanceAccessKey)

  for (const id of ids) {
    const visible = m.server.canViewInstance(key, id)
    const listed =
      scope.kind === 'none'
        ? false
        : scope.kind === 'include'
          ? scope.includeIds.includes(id)
          : !scope.excludeIds.includes(id)
    expect(
      listed,
      `list scope (${scope.kind}) disagrees with canViewInstance for ${key}:${id}`
    ).toBe(visible)
  }
  return scope
}

const ORG_SHARED_KEYS = (Object.keys(INSTANCE_ACCESS_RESOURCES) as InstanceAccessKey[]).filter(
  (key) => !INSTANCE_ACCESS_RESOURCES[key].baselineAtCreate
) as OrgSharedInstanceAccessKey[]

const PRIVATE_KEYS = (Object.keys(INSTANCE_ACCESS_RESOURCES) as InstanceAccessKey[]).filter(
  (key) => INSTANCE_ACCESS_RESOURCES[key].baselineAtCreate
) as PrivateInstanceAccessKey[]

// ═══════════════════════════════════════════════════════════════════════════
// 1. The live regression: an inbox carrying only its creator's Manager row
// ═══════════════════════════════════════════════════════════════════════════

describe('the inbox regression — a creator row is not a restriction', () => {
  /** Exactly what `InboxService.createInbox` writes: one `user @ admin` row. */
  const CREATOR_ROW = userRow('inbox', 'ibx_1', 'usr_creator', ResourcePermission.admin)

  it('a default org ADMIN at inboxes: Full manages an inbox someone else created', () => {
    // `ROLE_DEFAULTS.ADMIN` is ALL_FULL and the seeded admin profile carries
    // `baseLevel: Full`, so this is the out-of-the-box admin — no custom shaping.
    const admin = member({
      role: 'ADMIN',
      profileLevels: {},
      profileBaseLevel: Level.Full,
      orgRows: [CREATOR_ROW],
      isMine: () => false,
    })

    expect(admin.server.areaLevel(INSTANCE_ACCESS_RESOURCES.inbox.area)).toBe(Level.Full)
    // The creator's row does NOT put the inbox in the governing set...
    expect(admin.governing.has('ibx_1')).toBe(false)
    // ...so the area fallback stands: Full → admin. This returned `undefined`
    // before the fix, which is the 403 on the inbox Access section.
    expect(levelFor(admin, 'inbox', 'ibx_1')).toBe(ResourcePermission.admin)
    expect(admin.server.canAdminInstance('inbox', 'ibx_1')).toBe(true)
    expect(() => admin.server.assertAdminInstance('inbox', 'ibx_1')).not.toThrow()
    assertListAgrees(admin, 'inbox', ['ibx_1'])
  })

  it('the creator still holds `admin` on the inbox they created', () => {
    const creator = member({
      orgRows: [CREATOR_ROW],
      isMine: (row) => row.granteeId === 'usr_creator',
    })
    expect(levelFor(creator, 'inbox', 'ibx_1')).toBe(ResourcePermission.admin)
  })

  it('a member at inboxes: None is still denied that same inbox', () => {
    // The fix must not turn "no restriction" into "no gate". The area still
    // governs every member holding no row of their own.
    const shut = member({
      profileLevels: { [INSTANCE_ACCESS_RESOURCES.inbox.area]: Level.None },
      orgRows: [CREATOR_ROW],
      isMine: () => false,
    })
    expect(levelFor(shut, 'inbox', 'ibx_1')).toBeUndefined()
    expect(shut.server.canViewInstance('inbox', 'ibx_1')).toBe(false)
    expect(() => shut.server.assertViewInstance('inbox', 'ibx_1')).toThrow()
    expect(assertListAgrees(shut, 'inbox', ['ibx_1'])).toEqual({ kind: 'none' })
  })

  it('an ordinary member at the seeded inboxes: Read baseline works it at `view`', () => {
    const m = member({ orgRows: [CREATOR_ROW], isMine: () => false })
    expect(levelFor(m, 'inbox', 'ibx_1')).toBe(ResourcePermission.view)
    expect(m.server.canAdminInstance('inbox', 'ibx_1')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Own-row-first — what keeps the narrowing from being a regression
// ═══════════════════════════════════════════════════════════════════════════

describe('creator preservation on every `baselineAtCreate: true` key', () => {
  it.each(
    PRIVATE_KEYS
  )('a %s carrying ONLY its creator’s `user @ admin` row still resolves `admin` for them', (key) => {
    // This is the case own-row-first exists for. A lone creator row does not
    // govern, so the instance is absent from the narrowed set; without the
    // own-row branch the resolver would fall through to `instanceFallbackLevel`,
    // which returns `undefined` for these keys — and the author would lose their
    // own content.
    const rows = [userRow(key, 'inst_1', 'usr_me', ResourcePermission.admin)]
    const me = member({
      orgRows: rows,
      isMine: (row) => row.granteeId === 'usr_me',
    })

    expect(me.governing.has('inst_1')).toBe(false)
    expect(levelFor(me, key, 'inst_1')).toBe(ResourcePermission.admin)
    expect(me.server.canAdminInstance(key, 'inst_1')).toBe(true)
    expect(assertListAgrees(me, key, ['inst_1'])).toEqual({
      kind: 'include',
      includeIds: ['inst_1'],
    })

    // ...and nobody else reaches it, however open their area is.
    const other = member({
      orgRows: rows,
      profileBaseLevel: Level.Full,
      isMine: () => false,
    })
    expect(levelFor(other, key, 'inst_1')).toBeUndefined()
    expect(assertListAgrees(other, key, ['inst_1'])).toEqual({ kind: 'none' })
  })

  it('an OWNER keeps their own private instance and gains nothing else', () => {
    // The §0.6-revised bypass is scoped to `baselineAtCreate: false`, so an owner
    // reaches their own signature only through the own-row branch.
    const rows = [
      userRow('signature', 'sig_mine', 'usr_owner', ResourcePermission.admin),
      userRow('signature', 'sig_theirs', 'usr_other', ResourcePermission.admin),
    ]
    const owner = member({
      role: 'OWNER',
      orgRows: rows,
      isMine: (row) => row.granteeId === 'usr_owner',
    })
    expect(levelFor(owner, 'signature', 'sig_mine')).toBe(ResourcePermission.admin)
    expect(levelFor(owner, 'signature', 'sig_theirs')).toBeUndefined()
    assertListAgrees(owner, 'signature', ['sig_mine', 'sig_theirs'])
  })

  it('own-row-first does not defeat the seat ceiling', () => {
    // The billing invariant still outranks every row — it is checked above the
    // own-row branch, exactly as before.
    const tech = member({
      seatType: 'worker',
      orgRows: [userRow('signature', 'sig_1', 'usr_me', ResourcePermission.admin)],
      isMine: () => true,
    })
    expect(levelFor(tech, 'signature', 'sig_1')).toBeUndefined()
    expect(assertListAgrees(tech, 'signature', ['sig_1'])).toEqual({ kind: 'none' })
  })

  it('own-row-first does not defeat an explicit `none` on the member themselves', () => {
    // `none` is a RESTRICTION, never a grant. Returning the own row first must
    // therefore keep returning `'none'` — which satisfies nothing.
    const m = member({
      profileBaseLevel: Level.Full,
      orgRows: [userRow('dataset', 'ds_1', 'usr_me', ResourcePermission.none)],
      isMine: () => true,
    })
    expect(levelFor(m, 'dataset', 'ds_1')).toBe(ResourcePermission.none)
    expect(m.server.canViewInstance('dataset', 'ds_1')).toBe(false)
    assertListAgrees(m, 'dataset', ['ds_1'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Restriction still restricts
// ═══════════════════════════════════════════════════════════════════════════

describe('restriction still restricts', () => {
  it.each(
    ORG_SHARED_KEYS
  )('a `role:org_member @ none` baseline on a %s denies a non-grantee at area Full', (key) => {
    const rows = [baseline(key, 'inst_locked', ResourcePermission.none)]
    // The baseline row DOES reach every member through the grantee union — but
    // `composeUserCapabilities` keeps `none` in `instanceAccess`, so this member
    // is denied by their own row. Assert the org-wide arm too, below.
    const m = member({ profileBaseLevel: Level.Full, orgRows: rows })
    expect(m.governing.has('inst_locked')).toBe(true)
    expect(levelFor(m, key, 'inst_locked')).toBe(ResourcePermission.none)
    expect(m.server.canViewInstance(key, 'inst_locked')).toBe(false)
    assertListAgrees(m, key, ['inst_locked'])
  })

  it.each(
    ORG_SHARED_KEYS
  )('a %s governed by a baseline row the member is NOT a grantee of is denied org-wide', (key) => {
    // The org-wide arm: nothing in `instanceAccess`, so ONLY the governing set
    // can deny. This is the case the set exists for.
    const m = member({
      profileBaseLevel: Level.Full,
      orgRows: [baseline(key, 'inst_locked', ResourcePermission.none)],
      isMine: () => false,
    })
    expect(levelFor(m, key, 'inst_locked')).toBeUndefined()
    assertListAgrees(m, key, ['inst_locked'])
  })

  it('a `profile`-keyed `none` row the resolver cannot expand STILL denies', () => {
    // 19a finding 1, and the whole reason the org-wide set survives the fix:
    // a `profile` grantee never reaches `instanceAccess`, so own-row-first sees
    // nothing and only the governing set can produce the denial.
    const m = member({
      profileBaseLevel: Level.Full,
      orgRows: [profileRow('workflow', 'wf_1', ResourcePermission.none)],
      isMine: () => false,
    })
    expect(m.client.instanceAccess?.wf_1).toBeUndefined()
    expect(m.governing.has('wf_1')).toBe(true)
    expect(levelFor(m, 'workflow', 'wf_1')).toBeUndefined()
    assertListAgrees(m, 'workflow', ['wf_1'])
  })

  it('a positive `role:org_member` baseline PINS the instance below the area level', () => {
    // Presence governs, not strength: an admin at `datasets: Full` gets the
    // authored `view` baseline, not `admin`, because the fallback stands down.
    const m = member({
      role: 'ADMIN',
      profileLevels: {},
      profileBaseLevel: Level.Full,
      orgRows: [baseline('dataset', 'ds_1', ResourcePermission.view)],
    })
    expect(levelFor(m, 'dataset', 'ds_1')).toBe(ResourcePermission.view)
    expect(m.server.canAdminInstance('dataset', 'ds_1')).toBe(false)
    assertListAgrees(m, 'dataset', ['ds_1'])
  })

  it('an explicit `user @ none` restricts that member alone, at area Full', () => {
    const rows = [userRow('kb', 'kb_1', 'usr_shut', ResourcePermission.none)]
    const shut = member({
      profileBaseLevel: Level.Full,
      orgRows: rows,
      isMine: () => true,
    })
    expect(levelFor(shut, 'kb', 'kb_1')).toBe(ResourcePermission.none)

    // The `none` row governs the instance org-wide, so a colleague with no row of
    // their own is denied too — the deliberate, documented asymmetry (19a
    // finding 1), unchanged by this slice.
    const colleague = member({
      profileBaseLevel: Level.Full,
      orgRows: rows,
      isMine: () => false,
    })
    expect(levelFor(colleague, 'kb', 'kb_1')).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Sharing no longer restricts — the deliberate behaviour delta
// ═══════════════════════════════════════════════════════════════════════════

describe('sharing an org-shared instance leaves everyone else at their area level', () => {
  it.each(ORG_SHARED_KEYS)('a first `user @ edit` row on a %s does not privatize it', (key) => {
    // THE DELIBERATE DELTA. Pinned so it is a decision, not an accident: before
    // 2026-07-29 this row alone denied every member without one of their own,
    // and one React hook papered over it by writing an unrequested baseline.
    const rows = [userRow(key, 'inst_1', 'usr_grantee', ResourcePermission.edit)]

    const grantee = member({
      orgRows: rows,
      isMine: (row) => row.granteeId === 'usr_grantee',
    })
    expect(levelFor(grantee, key, 'inst_1')).toBe(ResourcePermission.edit)

    const bystander = member({
      profileLevels: {},
      profileBaseLevel: Level.Read,
      orgRows: rows,
      isMine: () => false,
    })
    expect(bystander.governing.has('inst_1')).toBe(false)
    expect(levelFor(bystander, key, 'inst_1')).toBe(ResourcePermission.view)
    expect(assertListAgrees(bystander, key, ['inst_1'])).toEqual({
      kind: 'exclude',
      excludeIds: [],
    })
  })

  it('adding a Restricted baseline afterwards DOES privatize it', () => {
    // The lever still exists; it is now explicit rather than a side effect of the
    // first share. This is the pair of assertions the delta is safe because of.
    const rows = [
      userRow('dataset', 'ds_1', 'usr_grantee', ResourcePermission.edit),
      baseline('dataset', 'ds_1', ResourcePermission.none),
    ]
    const bystander = member({
      profileLevels: {},
      profileBaseLevel: Level.Read,
      orgRows: rows,
      isMine: () => false,
    })
    expect(bystander.governing.has('ds_1')).toBe(true)
    expect(levelFor(bystander, 'dataset', 'ds_1')).toBeUndefined()

    const grantee = member({
      profileLevels: {},
      profileBaseLevel: Level.Read,
      orgRows: rows,
      isMine: (row) => row.granteeId === 'usr_grantee',
    })
    expect(levelFor(grantee, 'dataset', 'ds_1')).toBe(ResourcePermission.edit)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. List scopes agree with the point check in BOTH directions
// ═══════════════════════════════════════════════════════════════════════════

describe('list filtering agrees with the gate', () => {
  const MIXED: OrgRow[] = [
    baseline('workflow', 'wf_locked', ResourcePermission.none),
    userRow('workflow', 'wf_shared', 'usr_me', ResourcePermission.edit),
    userRow('workflow', 'wf_theirs', 'usr_other', ResourcePermission.admin),
    userRow('workflow', 'wf_mine_none', 'usr_me', ResourcePermission.none),
    // `wf_open` deliberately carries no row at all.
  ]
  const ALL_IDS = ['wf_locked', 'wf_shared', 'wf_theirs', 'wf_mine_none', 'wf_open']

  it('open area: excludes exactly the denied ids and nothing else', () => {
    const m = member({
      profileLevels: {},
      profileBaseLevel: Level.Read,
      orgRows: MIXED,
      isMine: (row) => row.granteeId === 'usr_me',
    })
    const scope = assertListAgrees(m, 'workflow', ALL_IDS)
    expect(scope.kind).toBe('exclude')
    expect([...(scope.excludeIds ?? [])].sort()).toEqual(['wf_locked', 'wf_mine_none'])
    // `wf_theirs` must NOT be excluded — someone else's share is not a restriction.
    expect(scope.excludeIds).not.toContain('wf_theirs')
  })

  it('closed area: includes exactly the member’s own ≥view rows', () => {
    const m = member({
      profileLevels: { [INSTANCE_ACCESS_RESOURCES.workflow.area]: Level.None },
      orgRows: MIXED,
      isMine: (row) => row.granteeId === 'usr_me',
    })
    const scope = assertListAgrees(m, 'workflow', ALL_IDS)
    expect(scope).toEqual({ kind: 'include', includeIds: ['wf_shared'] })
  })

  it('closed area with no usable rows denies all', () => {
    const m = member({
      profileLevels: { [INSTANCE_ACCESS_RESOURCES.workflow.area]: Level.None },
      orgRows: MIXED,
      isMine: () => false,
    })
    expect(assertListAgrees(m, 'workflow', ALL_IDS)).toEqual({ kind: 'none' })
  })

  it('a worker seat denies all regardless of rows, in both scope shapes', () => {
    const shared = member({
      seatType: 'worker',
      orgRows: MIXED,
      isMine: (row) => row.granteeId === 'usr_me',
    })
    expect(assertListAgrees(shared, 'workflow', ALL_IDS)).toEqual({ kind: 'none' })

    const priv = member({
      seatType: 'worker',
      orgRows: [userRow('snippet', 'sn_1', 'usr_me', ResourcePermission.admin)],
      isMine: () => true,
    })
    expect(assertListAgrees(priv, 'snippet', ['sn_1'])).toEqual({ kind: 'none' })
  })

  it('an OWNER excludes nothing on an org-shared key', () => {
    const owner = member({ role: 'OWNER', orgRows: MIXED, isMine: () => false })
    expect(assertListAgrees(owner, 'workflow', ALL_IDS)).toEqual({
      kind: 'exclude',
      excludeIds: [],
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. The shared predicate itself
// ═══════════════════════════════════════════════════════════════════════════

describe('isGoverningInstanceRow — one definition, two readers', () => {
  it('counts the workspace baseline at EVERY permission', () => {
    for (const permission of Object.values(ResourcePermission)) {
      expect(isGoverningInstanceRow(baseline('dataset', 'x', permission))).toBe(true)
    }
  })

  it('counts a `none` marker at EVERY grantee kind', () => {
    for (const granteeType of Object.values(ResourceGranteeType)) {
      expect(
        isGoverningInstanceRow({
          granteeType,
          granteeId: 'whoever',
          permission: ResourcePermission.none,
        })
      ).toBe(true)
    }
  })

  it('does NOT count a positive grant to a user, group, team or profile', () => {
    for (const granteeType of Object.values(ResourceGranteeType)) {
      if (granteeType === ResourceGranteeType.role) continue
      for (const permission of [
        ResourcePermission.view,
        ResourcePermission.edit,
        ResourcePermission.admin,
      ]) {
        expect(isGoverningInstanceRow({ granteeType, granteeId: 'whoever', permission })).toBe(
          false
        )
      }
    }
  })

  it('does not count a `role` row that is not the org-member baseline', () => {
    expect(
      isGoverningInstanceRow({
        granteeType: ResourceGranteeType.role,
        granteeId: 'some_other_role',
        permission: ResourcePermission.admin,
      })
    ).toBe(false)
  })

  it('every key the predicate is applied to is a registered instance-access key', () => {
    // Guards the `IN (...)` half of the provider's query: a key that leaves the
    // registry must leave the governing set with it.
    for (const key of [...ORG_SHARED_KEYS, ...PRIVATE_KEYS]) {
      expect(isInstanceAccessKey(key)).toBe(true)
    }
  })
})
