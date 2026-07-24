// packages/lib/src/permissions/capabilities/grant-service.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'

const roleMap: Record<string, { role: string; seatType: string; userType: string }> = {
  u_human: { role: 'USER', seatType: 'full', userType: 'USER' },
  u_agent: { role: 'USER', seatType: 'full', userType: 'AGENT' },
}

// The cache barrel is only used here for `onCacheEvent` + the memberRoleMap read;
// mocking it keeps the heavy cache/redis deps out of the test.
vi.mock('../../cache', () => ({
  onCacheEvent: vi.fn(async () => {}),
  getOrgCache: () => ({ get: vi.fn(async () => roleMap) }),
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

import { setGranteeLevels } from './grant-service'
import { Area, Level } from './registry'

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

  it('KEEPS Level.None for the org_member policy (the one downward lever)', async () => {
    // `composeUserCapabilities` reads `orgPolicyLevels[a] ?? ROLE_DEFAULTS.USER[a]`,
    // so a stored None genuinely zeroes the area for every non-admin member.
    // Stripping it here would silently widen the workspace baseline back to Full.
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
