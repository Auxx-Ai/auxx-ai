// packages/lib/src/resource-access/grantee-resolution.test.ts

import type { OrganizationRole, SeatType, UserType } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import type { MemberRoleEntry } from '../cache/org-cache-keys'
import type { CachedPermissionProfile } from '../permissions/profiles/types'
import {
  type GranteeMatcher,
  grantedViaFor,
  granteeMatchers,
  resolveProfileIdByUser,
} from './grantee-resolution'

const ORG = 'org_1'

function profile(over: Partial<CachedPermissionProfile> = {}): CachedPermissionProfile {
  return {
    id: 'prof_member',
    slug: 'member',
    name: 'Member',
    description: null,
    icon: null,
    seat: 'full' as SeatType,
    appliesTo: 'member',
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

/**
 * In-memory mirror of the `or(...granteeConditions)` SQL the resolvers build.
 * The Drizzle predicates themselves cannot be asserted under the default Vitest
 * config (`schema` is a Proxy with `undefined` columns), so the union is tested
 * as data and this evaluator stands in for the WHERE clause.
 */
function rowsVisibleTo(
  rows: Array<{ granteeType: string; granteeId: string; rung: string }>,
  matchers: GranteeMatcher[]
) {
  return rows.filter((row) =>
    matchers.some(
      (m) =>
        m.granteeTypes.includes(row.granteeType as never) && m.granteeIds.includes(row.granteeId)
    )
  )
}

describe('granteeMatchers', () => {
  it('always enumerates the direct user grant and the role:org_member baseline', () => {
    expect(granteeMatchers({ userId: 'u_1', groupIds: [], profileId: null })).toEqual([
      { granteeTypes: ['user'], granteeIds: ['u_1'] },
      { granteeTypes: ['role'], granteeIds: ['org_member'] },
    ])
  })

  it('adds the bound permission profile (19a #7/#8/#9/#10)', () => {
    const matchers = granteeMatchers({ userId: 'u_1', groupIds: [], profileId: 'prof_member' })
    expect(matchers).toContainEqual({ granteeTypes: ['profile'], granteeIds: ['prof_member'] })
  })

  it('omits the profile matcher entirely when nothing resolved', () => {
    const matchers = granteeMatchers({ userId: 'u_1', groupIds: ['g_1'], profileId: null })
    expect(matchers.some((m) => m.granteeTypes.includes('profile'))).toBe(false)
  })

  it('matches legacy team rows against group ids only when asked', () => {
    const grantees = { userId: 'u_1', groupIds: ['g_1'], profileId: null }
    expect(granteeMatchers(grantees)).toContainEqual({
      granteeTypes: ['group'],
      granteeIds: ['g_1'],
    })
    expect(granteeMatchers(grantees, { treatTeamAsGroup: true })).toContainEqual({
      granteeTypes: ['group', 'team'],
      granteeIds: ['g_1'],
    })
  })
})

describe('the finding-1 lockout', () => {
  // `restrictedEntityDefIds` is grantee-agnostic: ANY type-level row marks the
  // def restricted for the whole org. So a grantee kind a reader cannot resolve
  // does not fail closed for that grantee — it hides the def from everyone.
  const defRows = [
    { granteeType: 'role', granteeId: 'org_member', rung: 'read' },
    { granteeType: 'profile', granteeId: 'prof_field', rung: 'admin' },
  ]

  it('leaves an unrelated non-admin member on the workspace baseline', () => {
    const visible = rowsVisibleTo(
      defRows,
      granteeMatchers({ userId: 'u_other', groupIds: [], profileId: 'prof_member' })
    )
    expect(visible).toEqual([{ granteeType: 'role', granteeId: 'org_member', rung: 'read' }])
  })

  it('gives the granted profile’s holders the profile row', () => {
    const visible = rowsVisibleTo(
      defRows,
      granteeMatchers({ userId: 'u_tech', groupIds: [], profileId: 'prof_field' })
    )
    expect(visible.map((r) => r.rung).sort()).toEqual(['admin', 'read'])
  })

  it('reproduces the pre-step-9 lockout when the profile matcher is dropped', () => {
    // Same rows, but with the grantee union as it was BEFORE step 9 (no profile
    // matcher) AND no baseline row — the def is restricted org-wide and nobody
    // can resolve a grant through it.
    const restrictedOnly = [{ granteeType: 'profile', granteeId: 'prof_field', rung: 'read' }]
    const preStep9 = granteeMatchers({ userId: 'u_tech', groupIds: [], profileId: null })
    expect(rowsVisibleTo(restrictedOnly, preStep9)).toEqual([])

    const postStep9 = granteeMatchers({ userId: 'u_tech', groupIds: [], profileId: 'prof_field' })
    expect(rowsVisibleTo(restrictedOnly, postStep9)).toEqual(restrictedOnly)
  })
})

describe('resolveProfileIdByUser', () => {
  const profiles = [
    profile({ id: 'prof_member', slug: 'member' }),
    profile({ id: 'prof_field', slug: 'field_tech', seat: 'worker' as SeatType }),
    profile({ id: 'prof_admin', slug: 'admin' }),
    profile({ id: 'prof_custom', slug: 'support-lead', isSystem: false }),
  ]

  it('resolves an explicit binding', () => {
    const byUser = resolveProfileIdByUser({
      organizationId: ORG,
      roleMap: { u_1: member({ permissionProfileId: 'prof_custom' }) },
      profiles,
    })
    expect(byUser).toEqual({ u_1: 'prof_custom' })
  })

  it('resolves NULL-bound members through the system template — the majority case', () => {
    const byUser = resolveProfileIdByUser({
      organizationId: ORG,
      roleMap: {
        u_full: member(),
        u_field: member({ seatType: 'worker' as SeatType }),
        u_admin: member({ role: 'ADMIN' as OrganizationRole }),
      },
      profiles,
    })
    expect(byUser).toEqual({
      u_full: 'prof_member',
      u_field: 'prof_field',
      u_admin: 'prof_admin',
    })
  })

  it('falls back to the system template when the binding dangles', () => {
    const byUser = resolveProfileIdByUser({
      organizationId: ORG,
      roleMap: { u_1: member({ permissionProfileId: 'prof_from_another_org' }) },
      profiles,
    })
    expect(byUser).toEqual({ u_1: 'prof_member' })
  })

  it('omits users when the org has no seeded profiles at all', () => {
    const byUser = resolveProfileIdByUser({
      organizationId: ORG,
      roleMap: { u_1: member() },
      profiles: [],
    })
    expect(byUser).toEqual({})
  })
})

describe('grantedViaFor', () => {
  it('attributes each grantee kind distinctly', () => {
    expect(grantedViaFor('user')).toBe('direct')
    expect(grantedViaFor('group')).toBe('group')
    expect(grantedViaFor('team')).toBe('team')
    expect(grantedViaFor('role')).toBe('role')
    // 19a #27 — this used to fall through to 'direct', reading as "you were
    // named personally" for a grant nobody named you in.
    expect(grantedViaFor('profile')).toBe('profile')
  })
})
