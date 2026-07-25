// packages/lib/src/permissions/capabilities/grant-service.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'

const roleMap: Record<
  string,
  { role: string; seatType: string; userType: string; permissionProfileId: string | null }
> = {
  u_human: { role: 'USER', seatType: 'full', userType: 'USER', permissionProfileId: null },
  u_agent: { role: 'USER', seatType: 'full', userType: 'AGENT', permissionProfileId: null },
  u_bound: {
    role: 'USER',
    seatType: 'full',
    userType: 'USER',
    permissionProfileId: 'prof_custom',
  },
}

const profiles = [
  { id: 'prof_member', slug: 'member', isSystem: true },
  { id: 'prof_custom', slug: 'support_rep', isSystem: false },
]

// The cache barrel is only used here for `onCacheEvent` + the memberRoleMap /
// profiles reads; mocking it keeps the heavy cache/redis deps out of the test.
vi.mock('../../cache', () => ({
  onCacheEvent: vi.fn(async () => {}),
  getOrgCache: () => ({
    get: vi.fn(async (_orgId: string, key: string) => (key === 'profiles' ? profiles : roleMap)),
  }),
}))
vi.mock('../../dehydration/cache', () => ({
  DehydrationCacheService: class {
    async invalidateUser() {}
    async invalidateOrganization() {}
  },
}))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishCapabilitiesChanged: vi.fn(async () => {}),
}))
vi.mock('../feature-permission-service', () => ({
  FeaturePermissionService: class {
    async requireAccess() {}
  },
}))

import { composeUserCapabilities } from './compose-user-capabilities'
import { setGranteeLevels } from './grant-service'
import { Area, Level, PermissionKey, parseAreaLevels } from './registry'

const ORG = 'org_1'

/**
 * Minimal chainable drizzle stub covering only the shapes `setGranteeLevels`
 * touches; captures the `levels` payload that reaches the upsert.
 */
function fakeDb(sink: { levels?: Record<string, number> }): Database {
  const db = {
    insert: () => ({
      values: (row: { levels: Record<string, number> }) => {
        sink.levels = row.levels
        return {
          onConflictDoUpdate: () => ({ returning: async () => [row] }),
        }
      },
    }),
  }
  return db as unknown as Database
}

describe('setGranteeLevels — Level.None storability (v2 §1)', () => {
  it('KEEPS Level.None for an AGENT user grantee (the only way to lock an area down)', async () => {
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_agent',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.None, [Area.knowledgeBase]: Level.Read },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({
      [Area.records]: Level.None,
      [Area.knowledgeBase]: Level.Read,
    })
  })

  it('STRIPS Level.None for a human user grantee (raise-only ⇒ inert noise)', async () => {
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_human',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.None, [Area.knowledgeBase]: Level.Read },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({ [Area.knowledgeBase]: Level.Read })
  })

  it('STRIPS Level.None for a group grantee', async () => {
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'group',
      granteeId: 'grp_1',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.None, [Area.workflows]: Level.Full },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({ [Area.workflows]: Level.Full })
  })

  it('KEEPS Level.None for the legacy org_member policy row', async () => {
    // No composer reads this tier anymore (migration 041 moved it onto the `member`
    // profile), but the semantics are preserved so a pre-migration row round-trips
    // unchanged instead of being silently widened on a re-save.
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'role',
      granteeId: 'org_member',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.Read, [Area.workflows]: Level.None },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({
      [Area.records]: Level.Read,
      [Area.workflows]: Level.None,
    })
  })

  it('KEEPS Level.None for a PROFILE grantee (the composition base — fail-open if stripped)', async () => {
    // `composeUserCapabilities` reads
    // `profileLevels[a] ?? profileBaseLevel ?? ROLE_DEFAULTS[role][a]`, so a stored
    // None genuinely zeroes the area for every holder of the profile. Stripping it
    // would write "unset", fall through to the role default, and make the editor
    // display a denial the profile does not produce — a silent fail-OPEN.
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'profile',
      granteeId: 'prof_member',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.Read, [Area.workflows]: Level.None },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({
      [Area.records]: Level.Read,
      [Area.workflows]: Level.None,
    })
  })

  it('a profile grant round-trips an explicit None into a composed None for that area', async () => {
    // End-to-end proof of the same invariant: the levels that reach the DB are the
    // levels the composer consumes.
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'profile',
      granteeId: 'prof_member',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.None },
      db: fakeDb(sink),
    })
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: parseAreaLevels(sink.levels),
      typeAccessRows: [],
    })
    expect(caps.keys).not.toContain(PermissionKey.recordsView)
    expect(caps.keys).not.toContain(PermissionKey.recordsEdit)
    // Unset areas are untouched.
    expect(caps.keys).toContain(PermissionKey.workflowsManage)
  })

  it('treats an unknown user grantee (no member row) as a human and strips None', async () => {
    const sink: { levels?: Record<string, number> } = {}
    await setGranteeLevels({
      organizationId: ORG,
      granteeType: 'user',
      granteeId: 'u_ghost',
      grantedById: 'u_admin',
      levels: { [Area.records]: Level.None },
      db: fakeDb(sink),
    })
    expect(sink.levels).toEqual({})
  })
})
