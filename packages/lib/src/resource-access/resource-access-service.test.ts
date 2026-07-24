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
    },
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
  beforeEach(() => emit.mockClear())

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
