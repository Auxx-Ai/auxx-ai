// packages/lib/src/resource-access/grantee-bidirectional-agreement.test.ts
//
// Plan 45 §3.3 — the FORWARD grantee union and the REVERSE expansion must reach
// the same users, per grantee kind.
//
// Why this matters for plan 45: item 3 narrows the group/team invalidation from an
// org-wide broadcast to a targeted set, and narrowing is the fail-OPEN direction.
// A user the forward resolver matches but the reverse expansion misses keeps a
// stale `userInstanceGrants` for the full ONE_DAY TTL, holding a share they cannot
// see — the class `mail-grant-index-provider`'s docstring names of itself: "the
// two must expand the same grantee kinds or a share is visible in one direction
// only (19a finding 4)."
//
// Two things this file deliberately does NOT do:
//
//  1. It does not assert on `resourceAccessGranteeConditions`. Those are Drizzle
//     predicates, and under the default Vitest config `schema` is a Proxy whose
//     columns are `undefined` — the assertion would pass vacuously. `granteeMatchers`
//     is the same union as data, which is why it was split out.
//  2. It is not the safety mechanism for item 3. That is the `default: broadcast`
//     branch in `resolveInvalidationTargets` (covered in
//     `resource-access-service.test.ts`), which holds for kinds nobody has thought
//     of yet. This file covers the kinds that ARE narrowed.

import { ResourceGranteeType } from '@auxx/database/enums'
import type { OrganizationRole, SeatType, UserType } from '@auxx/database/types'
import { describe, expect, it, vi } from 'vitest'
import type { MemberRoleEntry } from '../cache/org-cache-keys'
import type { CachedPermissionProfile } from '../permissions/profiles/types'

const ORG = 'org_1'

/** A 10-member org: 3 in one group, one worker seat, one admin. */
const GROUP_MEMBERS: Record<string, string[]> = {
  u_1: ['grp_support'],
  u_2: ['grp_support'],
  u_3: ['grp_support', 'grp_other'],
  u_4: ['grp_other'],
}
const MEMBER_IDS = ['u_1', 'u_2', 'u_3', 'u_4', 'u_5', 'u_6', 'u_7', 'u_8', 'u_9', 'u_10']

function profile(over: Partial<CachedPermissionProfile> = {}): CachedPermissionProfile {
  return {
    id: 'prof_member',
    slug: 'member',
    name: 'Member',
    description: null,
    icon: null,
    seat: 'full' as SeatType,
    appliesTo: 'member',
    role: 'USER' as OrganizationRole,
    baseLevel: null,
    ceiling: null,
    agentPolicy: null,
    isSystem: true,
    updatedAt: null,
    ...over,
  }
}

function member(over: Partial<MemberRoleEntry> = {}): MemberRoleEntry {
  return {
    role: 'USER' as OrganizationRole,
    seatType: 'full' as SeatType,
    userType: 'USER' as UserType,
    permissionProfileId: null,
    ...over,
  }
}

const PROFILES = [
  profile({ id: 'prof_member', slug: 'member' }),
  profile({ id: 'prof_field', slug: 'field_tech', seat: 'worker' as SeatType }),
  profile({ id: 'prof_admin', slug: 'admin' }),
]

const ROLE_MAP: Record<string, MemberRoleEntry> = Object.fromEntries(
  MEMBER_IDS.map((id) => [
    id,
    id === 'u_9'
      ? member({ seatType: 'worker' as SeatType })
      : id === 'u_10'
        ? member({ role: 'ADMIN' as OrganizationRole })
        : member(),
  ])
)

vi.mock('../cache', () => ({
  getOrgCache: () => ({
    get: async (_org: string, key: string) => {
      if (key === 'members') return MEMBER_IDS.map((userId) => ({ userId }))
      if (key === 'memberRoleMap') return ROLE_MAP
      if (key === 'profiles') return PROFILES
      if (key === 'groupMembers') return GROUP_MEMBERS
      return []
    },
  }),
  getCachedUserGroupIds: async (_org: string, userId: string) => GROUP_MEMBERS[userId] ?? [],
}))

const {
  expandGranteeToUserIds,
  granteeMatchers,
  resolveResourceAccessGrantees,
  ORG_MEMBER_GRANTEE_ID,
} = await import('./grantee-resolution')

/**
 * FORWARD: which members' own grantee union matches this row. The in-memory
 * stand-in for `or(...resourceAccessGranteeConditions(...))`.
 */
async function forwardReach(
  row: { granteeType: string; granteeId: string },
  opts: { treatTeamAsGroup?: boolean } = {}
): Promise<string[]> {
  const reached: string[] = []
  for (const userId of MEMBER_IDS) {
    const grantees = await resolveResourceAccessGrantees(ORG, userId)
    const matchers = granteeMatchers(grantees, opts)
    const matched = matchers.some(
      (m) =>
        m.granteeTypes.includes(row.granteeType as never) && m.granteeIds.includes(row.granteeId)
    )
    if (matched) reached.push(userId)
  }
  return reached.sort()
}

/** REVERSE: which users the invalidation path expands this row to. */
async function reverseReach(row: { granteeType: string; granteeId: string }): Promise<string[]> {
  const { userIds } = await expandGranteeToUserIds(ORG, row)
  return [...userIds].sort()
}

describe('§3.3 — forward and reverse agree on every NARROWED grantee kind', () => {
  it('group: the expansion is the exact inverse of the forward match', async () => {
    const row = { granteeType: ResourceGranteeType.group, granteeId: 'grp_support' }

    // Both sides read `groupMembers` — the forward side through
    // `getCachedUserGroupIds` (`groupMembers[userId]`), the reverse through
    // `resolveGroupHolders` inverting the same map. One projection, two directions.
    expect(await reverseReach(row)).toEqual(['u_1', 'u_2', 'u_3'])
    expect(await forwardReach(row)).toEqual(await reverseReach(row))
  })

  it('team: agrees under the shared loader’s treatTeamAsGroup', async () => {
    const row = { granteeType: ResourceGranteeType.team, granteeId: 'grp_support' }

    // `loadUserInstanceGrants` passes `treatTeamAsGroup: true`, and since plan
    // v3/03 P4 that is the ONE instance-level query — `computeUserCapabilities`
    // runs it too, where it used to hand-roll a union that omitted `team`
    // entirely. The reverse expansion mirrors it by routing `team` through
    // `resolveGroupHolders`. Drop the `team` case from EITHER side and this fails
    // while every behavioural test still passes — the §3.3 mutation.
    expect(await forwardReach(row, { treatTeamAsGroup: true })).toEqual(await reverseReach(row))
    expect(await reverseReach(row)).toEqual(['u_1', 'u_2', 'u_3'])
  })

  it('team WITHOUT treatTeamAsGroup over-invalidates, which is the safe direction', async () => {
    const row = { granteeType: ResourceGranteeType.team, granteeId: 'grp_support' }

    // The point-check readers (`checkAccess`, `getUserAccessibleInstances`) do not
    // treat team as group, so a team row reaches nobody forward while the reverse still
    // busts three users. Recorded deliberately: an over-broad bust costs a refetch,
    // an under-broad one hides a share.
    expect(await forwardReach(row)).toEqual([])
    expect(await reverseReach(row)).toEqual(['u_1', 'u_2', 'u_3'])
  })

  it('user: trivially agrees', async () => {
    const row = { granteeType: ResourceGranteeType.user, granteeId: 'u_5' }
    expect(await forwardReach(row)).toEqual(['u_5'])
    expect(await reverseReach(row)).toEqual(['u_5'])
  })
})

describe('§3.3 — the kinds that stay broadcasts still agree, so the door is open later', () => {
  it('role:org_member reaches every member on both sides', async () => {
    const row = { granteeType: ResourceGranteeType.role, granteeId: ORG_MEMBER_GRANTEE_ID }

    // Narrowing this one would trade 1 publish for N, which is why
    // `resolveInvalidationTargets` keeps it a broadcast. The agreement is asserted
    // anyway: if it ever stops holding, "broadcast" was hiding a real divergence.
    expect(await forwardReach(row)).toEqual([...MEMBER_IDS].sort())
    expect(await reverseReach(row)).toEqual([...MEMBER_IDS].sort())
  })

  it('an unrelated role grantee reaches nobody, rather than being read as a group id', async () => {
    const row = { granteeType: ResourceGranteeType.role, granteeId: 'ADMIN' }
    expect(await reverseReach(row)).toEqual([])
    expect(await forwardReach(row)).toEqual([])
  })

  it('profile: the reverse holder sweep matches the forward resolved binding', async () => {
    const row = { granteeType: ResourceGranteeType.profile, granteeId: 'prof_member' }

    // Note this is `resolveProfileHolders`, which shares `resolveBaseProfile` with
    // the forward resolver — NOT `resolveProfileAudience`, the invalidation sweep
    // `resolveInvalidationTargets` actually calls for profiles, which may collapse
    // to a broadcast by design. That collapse is the safe direction.
    const expected = MEMBER_IDS.filter((id) => id !== 'u_9' && id !== 'u_10').sort()
    expect(await reverseReach(row)).toEqual(expected)
    expect(await forwardReach(row)).toEqual(expected)
  })

  it('an unknown grantee kind reaches nobody and is not reinterpreted as a group', async () => {
    const row = { granteeType: 'future_kind', granteeId: 'grp_support' }
    expect(await reverseReach(row)).toEqual([])
    expect(await forwardReach(row)).toEqual([])
  })
})
