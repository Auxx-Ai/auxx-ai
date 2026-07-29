// packages/lib/src/resource-access/resource-access-service.test.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only onCacheEvent + getCachedUserGroupIds + getCachedResources are pulled from
// the cache barrel by this module; mocking them keeps the heavy cache/realtime
// deps out of the test. `getCachedResources` feeds the mail-keyspace backstop's
// def→slug resolver (see `mail-keyspace-backstop.test.ts` for its own coverage).
vi.mock('../cache', () => ({
  onCacheEvent: vi.fn(async () => {}),
  getCachedUserGroupIds: vi.fn(async () => []),
  getCachedResources: vi.fn(async () => []),
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
// `resolveResourceAccessGrantees` reads the org cache (memberRoleMap + profiles);
// the check-path tests below only care about the ROLE short-circuit, so the
// grantee union is stubbed to "no groups, no profile".
const resolveResourceAccessGrantees = vi.fn(async (_org: string, userId: string) => ({
  userId,
  groupIds: [] as string[],
  profileId: null as string | null,
}))
vi.mock('./grantee-resolution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./grantee-resolution')>()),
  resolveProfileHolders: (...a: unknown[]) => resolveProfileHolders(...(a as [])),
  resolveResourceAccessGrantees: (...a: unknown[]) =>
    resolveResourceAccessGrantees(...(a as [string, string])),
}))

import { onCacheEvent } from '../cache'
import {
  checkAccess,
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
    // Filtered by event name, like the profile-audience case above. `RECORD` is
    // an INBOX RecordId, and since plan 40 phase 1 `inbox` is an
    // `INSTANCE_ACCESS_RESOURCES` key — so `setInstanceAccess` now also fires
    // `resource-access.instance.changed`, and an unfiltered read of
    // `emit.mock.calls` sees each grantee twice.
    const targeted = emit.mock.calls
      .filter((c) => c[0] === 'resource-access.changed')
      .map((c) => c[1].userId)
      .sort()
    expect(targeted).toEqual(['u_added', 'u_removed'])
  })

  it('also emits the INSTANCE cache event for an inbox — it is a shareable instance now', async () => {
    // Pinned as its own case rather than folded into the filter above, because
    // the extra emit is the point, not noise: `instanceAccess` /
    // `governingInstanceIds` are now populated from inbox rows, so an inbox
    // grant that did not invalidate them would leave every affected member on a
    // stale capability blob for the full TTL. Break the
    // `isInstanceAccessKey(entityDefinitionId)` guard in `setInstanceAccess`, or
    // drop `inbox` from `INSTANCE_ACCESS_RESOURCES`, and this is what fails.
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
    const instanceEvents = emit.mock.calls
      .filter((c) => c[0] === 'resource-access.instance.changed')
      .map((c) => c[1].userId)
      .sort()
    expect(instanceEvents).toEqual(['u_added', 'u_removed'])
  })
})

/**
 * The FOURTH ADMIN bypass (doc 19 §5.3 piece 2) — an independent
 * `['OWNER','ADMIN']` short-circuit on a code path completely separate from
 * `capability-set` / `entity-access`. Narrowing only those left this one handing
 * admins `admin` on every instance, so sharing stayed bypassed.
 */
function checkDb(role: string | undefined, grants: Array<Record<string, unknown>> = []) {
  return {
    query: {
      OrganizationMember: { findFirst: async () => (role ? { role } : undefined) },
      ResourceAccess: { findMany: async () => grants },
    },
  } as any
}

describe('checkAccess role short-circuit (doc 19 §5.3 piece 2)', () => {
  const ctx = (role: string | undefined, grants?: Array<Record<string, unknown>>) => ({
    db: checkDb(role, grants),
    organizationId: ORG,
    userId: 'u_target',
  })

  it('OWNER keeps the unconditional bypass (the §0.10 recovery guarantee)', async () => {
    await expect(
      checkAccess(ctx('OWNER'), { recordId: RECORD, userId: 'u_target' })
    ).resolves.toEqual({
      hasAccess: true,
      permission: ResourcePermission.admin,
      grantedVia: 'role',
      accessLevel: 'type',
    })
  })

  it('ADMIN no longer bypasses — an ungranted instance is denied', async () => {
    await expect(
      checkAccess(ctx('ADMIN'), { recordId: RECORD, userId: 'u_target' })
    ).resolves.toEqual({ hasAccess: false, permission: null, grantedVia: null, accessLevel: null })
  })

  it('ADMIN resolves through their own grantee union like anyone else', async () => {
    const granted = [
      { permission: ResourcePermission.edit, entityInstanceId: 'inbox_1', granteeType: 'user' },
    ]
    await expect(
      checkAccess(ctx('ADMIN', granted), { recordId: RECORD, userId: 'u_target' })
    ).resolves.toMatchObject({
      hasAccess: true,
      permission: ResourcePermission.edit,
      accessLevel: 'instance',
    })
  })

  it('a plain USER is unaffected by the narrowing', async () => {
    await expect(
      checkAccess(ctx('USER'), { recordId: RECORD, userId: 'u_target' })
    ).resolves.toEqual({ hasAccess: false, permission: null, grantedVia: null, accessLevel: null })
  })
})
