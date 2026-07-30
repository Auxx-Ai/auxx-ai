// packages/lib/src/groups/permissions.test.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { GroupContext } from '@auxx/types/groups'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const GROUP_DEF_ID = 'def_entity_group'

let roleByUser: Record<string, string> = {}

// `getOrgCache` is the only cache symbol this module pulls; stubbing it keeps the
// realtime/redis barrel out of the test. Both call sites (`memberRoleMap`,
// `entityDefs`) go through the same `getOrRecompute`, so one stub serves both.
vi.mock('../cache', () => ({
  getOrgCache: () => ({
    getOrRecompute: async () => ({
      memberRoleMap: Object.fromEntries(
        Object.entries(roleByUser).map(([userId, role]) => [userId, { role }])
      ),
      entityDefs: { entity_group: GROUP_DEF_ID },
    }),
  }),
}))

const checkAccess = vi.fn(async () => ({
  hasAccess: false,
  rung: null as ResourcePermission | null,
  grantedVia: null,
  accessLevel: null,
}))
const hasPermission = vi.fn(async () => false)
vi.mock('../resource-access', () => ({
  checkAccess: (...a: unknown[]) => checkAccess(...(a as [])),
  hasPermission: (...a: unknown[]) => hasPermission(...(a as [])),
}))

import { getGroupPermission, hasGroupPermission } from './permissions'

const ctxFor = (userId: string): GroupContext =>
  ({ db: {} as never, organizationId: 'org_1', userId }) as GroupContext

describe('group permission gates — role short-circuit (doc 19 step 10)', () => {
  beforeEach(() => {
    roleByUser = { u_owner: 'OWNER', u_admin: 'ADMIN', u_member: 'USER' }
    checkAccess.mockClear()
    hasPermission.mockClear()
  })

  it('OWNER short-circuits to admin without consulting ResourceAccess (§0.10)', async () => {
    await expect(getGroupPermission(ctxFor('u_owner'), 'g_1')).resolves.toBe('admin')
    await expect(hasGroupPermission(ctxFor('u_owner'), 'g_1', 'admin')).resolves.toBe(true)
    expect(checkAccess).not.toHaveBeenCalled()
    expect(hasPermission).not.toHaveBeenCalled()
  })

  // The regression this file exists for: this bypass ran BEFORE `checkAccess`, so
  // narrowing `checkAccess` to OWNER (§5.3 piece 2) was a no-op for groups while
  // ADMIN still short-circuited here.
  it('ADMIN does NOT short-circuit — it resolves through ResourceAccess', async () => {
    await expect(getGroupPermission(ctxFor('u_admin'), 'g_1')).resolves.toBeNull()
    await expect(hasGroupPermission(ctxFor('u_admin'), 'g_1', 'admin')).resolves.toBe(false)
    expect(checkAccess).toHaveBeenCalledTimes(1)
    expect(hasPermission).toHaveBeenCalledTimes(1)
  })

  it('an ADMIN with a grant (e.g. a profile grantee row) still passes', async () => {
    checkAccess.mockResolvedValueOnce({
      hasAccess: true,
      rung: 'admin',
      grantedVia: 'profile',
      accessLevel: 'type',
    } as never)
    hasPermission.mockResolvedValueOnce(true)
    await expect(getGroupPermission(ctxFor('u_admin'), 'g_1')).resolves.toBe('admin')
    await expect(hasGroupPermission(ctxFor('u_admin'), 'g_1', 'admin')).resolves.toBe(true)
  })

  it('an ordinary member is unchanged', async () => {
    await expect(getGroupPermission(ctxFor('u_member'), 'g_1')).resolves.toBeNull()
    expect(checkAccess).toHaveBeenCalledTimes(1)
  })
})
