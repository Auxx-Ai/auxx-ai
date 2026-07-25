// packages/lib/src/resource-access/resource-access-service.test.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only onCacheEvent + getCachedUserGroupIds are pulled from the cache barrel by
// this module; mocking them keeps the heavy cache/realtime deps out of the test.
vi.mock('../cache', () => ({
  onCacheEvent: vi.fn(async () => {}),
  getCachedUserGroupIds: vi.fn(async () => []),
}))

// A profile grantee routes through the SAME audience sweep `grant-service.ts`
// uses, so it is stubbed here rather than reimplemented (19a #25).
const resolveProfileAudience = vi.fn(async () => ({
  userIds: ['u_holder_a', 'u_holder_b'],
  broadcast: false,
}))
vi.mock('../permissions/profiles/profile-invalidation', () => ({
  resolveProfileAudience: (...a: unknown[]) => resolveProfileAudience(...(a as [])),
}))

const resolveProfileHolders = vi.fn(async () => ['u_holder_a', 'u_holder_b'])
vi.mock('./grantee-resolution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./grantee-resolution')>()),
  resolveProfileHolders: (...a: unknown[]) => resolveProfileHolders(...(a as [])),
}))

import { onCacheEvent } from '../cache'
import {
  grantInstanceAccess,
  grantTypeAccess,
  revokeInstanceAccess,
  setInstanceAccess,
} from './resource-access-service'

const ORG = 'org_1'
const RECORD = toRecordId('inbox', 'inbox_1')

/** Minimal chainable fake db covering the write shapes these functions use. */
function fakeDb(opts: { deleteReturning?: Array<{ granteeId: string }> } = {}) {
  const db: any = {
    query: {
      ResourceAccess: {
        findFirst: async () => undefined,
      },
      User: { findFirst: async () => ({ name: 'Granter' }) },
    },
    // The share-notification path resolves the shared resource's name; an empty
    // result short-circuits it after the recipients have been resolved.
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({
      values: () => ({ onConflictDoUpdate: async () => {} }),
    }),
    delete: () => ({
      where: () => ({ returning: async () => opts.deleteReturning ?? [] }),
    }),
    transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
  }
  return db
}

const emit = vi.mocked(onCacheEvent)

describe('resource-access cache-event emission', () => {
  beforeEach(() => {
    emit.mockClear()
    resolveProfileAudience.mockClear()
  })

  it('targets a single user for a user grant', async () => {
    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: RECORD,
        granteeType: ResourceGranteeType.user,
        granteeId: 'u_target',
        permission: ResourcePermission.view,
      }
    )
    expect(emit).toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      userId: 'u_target',
    })
  })

  it('fans out org-wide for a role grant', async () => {
    await grantTypeAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        entityDefinitionId: 'inbox',
        granteeType: ResourceGranteeType.role,
        granteeId: 'org_member',
        permission: ResourcePermission.view,
      }
    )
    expect(emit).toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
  })

  it('does not emit when a revoke deletes nothing', async () => {
    await revokeInstanceAccess(
      { db: fakeDb({ deleteReturning: [] }), organizationId: ORG, userId: 'granter' },
      { recordId: RECORD, granteeType: ResourceGranteeType.user, granteeId: 'u_x' }
    )
    expect(emit).not.toHaveBeenCalled()
  })

  it('accepts a profile grantee — the step-9 write guard is gone', async () => {
    await expect(
      grantTypeAccess(
        { db: fakeDb(), organizationId: ORG, userId: 'granter' },
        {
          entityDefinitionId: 'def_deals',
          granteeType: ResourceGranteeType.profile,
          granteeId: 'prof_field',
          permission: ResourcePermission.view,
        }
      )
    ).resolves.toBeUndefined()
  })

  it('targets a profile grant at its holders instead of broadcasting (19a #25)', async () => {
    await grantTypeAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        entityDefinitionId: 'def_deals',
        granteeType: ResourceGranteeType.profile,
        granteeId: 'prof_field',
        permission: ResourcePermission.view,
      }
    )
    expect(resolveProfileAudience).toHaveBeenCalledWith({
      organizationId: ORG,
      profileId: 'prof_field',
    })
    const targeted = emit.mock.calls
      .filter((c) => c[0] === 'resource-access.changed')
      .map((c) => c[1].userId)
      .sort()
    expect(targeted).toEqual(['u_holder_a', 'u_holder_b'])
    expect(emit).not.toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
  })

  it('falls back to an org-wide broadcast when the profile audience says so', async () => {
    resolveProfileAudience.mockResolvedValueOnce({ userIds: [], broadcast: true })
    await grantTypeAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        entityDefinitionId: 'def_deals',
        granteeType: ResourceGranteeType.profile,
        granteeId: 'prof_field',
        permission: ResourcePermission.view,
      }
    )
    expect(emit).toHaveBeenCalledWith('resource-access.changed', {
      orgId: ORG,
      broadcastUserKeys: true,
    })
  })

  it('notifies a profile grant’s holders instead of nobody (19a #26)', async () => {
    resolveProfileHolders.mockClear()
    await grantInstanceAccess(
      { db: fakeDb(), organizationId: ORG, userId: 'granter' },
      {
        recordId: toRecordId('dashboard', 'dash_1'),
        granteeType: ResourceGranteeType.profile,
        granteeId: 'prof_field',
        permission: ResourcePermission.view,
      }
    )
    // The share notification is fire-and-forget; let the microtask queue drain.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolveProfileHolders).toHaveBeenCalledWith(ORG, 'prof_field')
  })

  it('emits for both removed and added grantees on a set', async () => {
    await setInstanceAccess(
      {
        db: fakeDb({ deleteReturning: [{ granteeId: 'u_removed' }] }),
        organizationId: ORG,
        userId: 'g',
      },
      RECORD,
      ResourceGranteeType.user,
      [{ granteeId: 'u_added', permission: ResourcePermission.view }]
    )
    const targeted = emit.mock.calls.map((c) => c[1].userId).sort()
    expect(targeted).toEqual(['u_added', 'u_removed'])
  })
})
