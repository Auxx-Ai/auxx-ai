// packages/lib/src/resource-access/mail-keyspace-backstop.test.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 §5.1 — the LIB-SIDE half of phase 0b.
 *
 * `ResourceAccess.entityDefinitionId` is a dual keyspace with no FK: mail defs
 * must be keyed by slug (`inbox`/`thread`/`contact`), generic record defs by the
 * def CUID. `resourceAccess`'s router canonicalizes, but the router covers tRPC
 * only — the three write funnels are reachable from lib/REST/SDK directly, and
 * before this backstop they took `parseRecordId` at face value. A CUID-keyed
 * inbox grant landed in a keyspace `composeUserMailVisibility` never reads AND
 * skipped `assertCanManageMailSharing` + the enterprise gate (both slug tests).
 *
 * These pin the funnel-level invariant, in both directions:
 *  - a CUID that resolves to a MAIL def is REFUSED (never silently re-keyed —
 *    normalizing would promote an unauthorized row into an effective grant);
 *  - a CUID that resolves to anything else is written verbatim, because the
 *    record-capability layer reads those same rows CUID-keyed.
 */

/** Only the four keys `buildDefIdToSlug` reads off the org `resources` projection. */
interface FakeResource {
  id: string
  entityDefinitionId: string
  apiSlug: string
  entityType?: string
}

const getCachedResources = vi.fn(async (): Promise<FakeResource[]> => RESOURCES)

vi.mock('../cache', () => ({
  onCacheEvent: vi.fn(async () => {}),
  getCachedUserGroupIds: vi.fn(async () => []),
  getCachedResources: (...a: unknown[]) => getCachedResources(...(a as [])),
}))

vi.mock('./grantee-resolution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./grantee-resolution')>()),
  resolveProfileHolders: vi.fn(async () => []),
  resolveResourceAccessGrantees: vi.fn(async (_org: string, userId: string) => ({
    userId,
    groupIds: [] as string[],
    profileId: null as string | null,
  })),
}))

vi.mock('../permissions/profiles/profile-invalidation', () => ({
  resolveProfileAudience: vi.fn(async () => ({ userIds: [], broadcast: false })),
}))

import {
  grantInstanceAccess,
  revokeInstanceAccess,
  setInstanceAccess,
} from './resource-access-service'

const ORG = 'org_1'

/** Def CUIDs as they exist in the org's `resources` projection. */
const INBOX_DEF_ID = 'qiramlz5m0cswo4n4v10mxkz'
const THREAD_DEF_ID = 'thr4defcuid00000000000000'
const CONTACT_DEF_ID = 'mzxt3cxyzhm3cbtgcbpmeir1'
const DEALS_DEF_ID = 'deal5defcuid0000000000000'

/**
 * A custom def carries NO `entityType` — which is exactly why blanket
 * normalization is wrong: its fallback slug is the renameable `apiSlug`.
 */
const RESOURCES: FakeResource[] = [
  { id: INBOX_DEF_ID, entityDefinitionId: INBOX_DEF_ID, apiSlug: 'inboxes', entityType: 'inbox' },
  {
    id: THREAD_DEF_ID,
    entityDefinitionId: THREAD_DEF_ID,
    apiSlug: 'threads',
    entityType: 'thread',
  },
  {
    id: CONTACT_DEF_ID,
    entityDefinitionId: CONTACT_DEF_ID,
    apiSlug: 'contacts',
    entityType: 'contact',
  },
  { id: DEALS_DEF_ID, entityDefinitionId: DEALS_DEF_ID, apiSlug: 'deals', entityType: undefined },
]

/** AuxxError shape — service/lib code throws AuxxError, never TRPCError. */
const BAD_REQUEST = { name: 'BadRequestError', statusCode: 400 }

const writes = {
  insert: vi.fn(),
  delete: vi.fn(),
}

/** Minimal chainable fake db covering the write shapes these functions use. */
function fakeDb() {
  const db: any = {
    query: {
      ResourceAccess: { findFirst: async () => undefined },
      User: { findFirst: async () => ({ name: 'Granter' }) },
    },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => {
      writes.insert()
      return {
        values: () => ({ onConflictDoUpdate: async () => {} }),
      }
    },
    delete: () => {
      writes.delete()
      return { where: () => ({ returning: async () => [] }) }
    },
    transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
  }
  return db
}

const ctx = () => ({ db: fakeDb(), organizationId: ORG, userId: 'granter' })

const grant = (recordId: string) =>
  grantInstanceAccess(ctx(), {
    recordId: recordId as RecordId,
    granteeType: ResourceGranteeType.user,
    granteeId: 'u_target',
    permission: ResourcePermission.view,
  })

const revoke = (recordId: string) =>
  revokeInstanceAccess(ctx(), {
    recordId: recordId as RecordId,
    granteeType: ResourceGranteeType.user,
    granteeId: 'u_target',
  })

const set = (recordId: string) =>
  setInstanceAccess(ctx(), recordId as RecordId, ResourceGranteeType.user, [
    { granteeId: 'u_target', permission: ResourcePermission.view },
  ])

beforeEach(() => {
  writes.insert.mockReset()
  writes.delete.mockReset()
  getCachedResources.mockReset()
  getCachedResources.mockResolvedValue(RESOURCES)
})

describe('mail keyspace backstop — a CUID mail RecordId cannot reach the table', () => {
  it.each([
    ['grantInstanceAccess', () => grant(`${INBOX_DEF_ID}:inbox_1`)],
    ['setInstanceAccess', () => set(`${INBOX_DEF_ID}:inbox_1`)],
    ['revokeInstanceAccess', () => revoke(`${INBOX_DEF_ID}:inbox_1`)],
  ])('%s refuses an inbox RecordId built from the def CUID', async (_name, call) => {
    await expect(call()).rejects.toMatchObject(BAD_REQUEST)
    expect(writes.insert).not.toHaveBeenCalled()
    expect(writes.delete).not.toHaveBeenCalled()
  })

  it('names the slug the caller should have used', async () => {
    await expect(grant(`${INBOX_DEF_ID}:inbox_1`)).rejects.toThrow(/toRecordId\('inbox', <id>\)/)
  })

  it('covers every MAIL_SHARING_DEFS member, not just inbox', async () => {
    await expect(grant(`${THREAD_DEF_ID}:thr_1`)).rejects.toMatchObject(BAD_REQUEST)
    await expect(grant(`${CONTACT_DEF_ID}:cnt_1`)).rejects.toMatchObject(BAD_REQUEST)
    expect(writes.insert).not.toHaveBeenCalled()
  })

  it('rejects the apiSlug spelling too — it resolves to the same mail def', async () => {
    await expect(grant('inboxes:inbox_1')).rejects.toMatchObject(BAD_REQUEST)
  })
})

describe('mail keyspace backstop — scoped strictly to mail defs', () => {
  it('writes a slug-keyed mail grant without consulting the resolver', async () => {
    await expect(grant(toRecordId('inbox', 'inbox_1'))).resolves.toBeUndefined()
    expect(writes.insert).toHaveBeenCalled()
    // Already canonical: no `resources` read at all on the hot mail path.
    expect(getCachedResources).not.toHaveBeenCalled()
  })

  it('leaves a CUID-keyed grant on a CUSTOM def alone (blanket normalization would break it)', async () => {
    await expect(grant(`${DEALS_DEF_ID}:rec_1`)).resolves.toBeUndefined()
    expect(writes.insert).toHaveBeenCalled()
  })

  it('leaves a non-mail instance-access key alone', async () => {
    await expect(grant(toRecordId('dashboard', 'dash_1'))).resolves.toBeUndefined()
    expect(writes.insert).toHaveBeenCalled()
  })

  it('leaves an unknown def id alone — the resolver falls through to itself', async () => {
    await expect(grant('def_not_in_cache:rec_1')).resolves.toBeUndefined()
    expect(writes.insert).toHaveBeenCalled()
  })
})
