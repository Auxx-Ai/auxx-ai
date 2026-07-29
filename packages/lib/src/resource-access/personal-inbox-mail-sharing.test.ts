// packages/lib/src/resource-access/personal-inbox-mail-sharing.test.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 / 40a §1.3 — what `MAIL_SHARING_DEFS` membership actually BUYS the new
 * `personal_inbox` def.
 *
 * `ResourceAccess.entityDefinitionId` is a dual keyspace with no FK: mail defs are
 * keyed by their entity SLUG, generic record defs by the def CUID. #1388 put
 * `canonicalMailRecordId` on the `resourceAccess` router and the funnel-level
 * backstop (`assertCanonicalMailKey`) in the service — BOTH scoped to
 * `isMailSharingDef`. So the single-word list edit is the whole mechanism by
 * which `personal_inbox` inherits that protection; without it, a CUID-keyed
 * personal-inbox grant would be written into a keyspace mail visibility never
 * reads AND would have skipped `assertCanManageMailSharing` on the way in.
 *
 * These are the `personal_inbox` half only — the `inbox`/`thread`/`contact` cases
 * live in `mail-keyspace-backstop.test.ts`.
 */

/** Only the four keys `buildDefIdToSlug` reads. Declared up front so the mock's
 *  return type does not have to be inferred from `RESOURCES` (which is declared
 *  after the hoisted `vi.mock` factories) — that cycle is a TS7022/TS7024. */
type ResourceRow = {
  id: string
  entityDefinitionId: string
  apiSlug: string
  entityType: string | undefined
}

const getCachedResources = vi.fn(async (): Promise<ResourceRow[]> => RESOURCES)

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

import { isMailSharingDef } from './mail-sharing-defs'
import { grantInstanceAccess, setInstanceAccess } from './resource-access-service'

const ORG = 'org_1'
const PERSONAL_INBOX_DEF_ID = 'pi000defcuid00000000000000'
const DEALS_DEF_ID = 'deal5defcuid0000000000000'

const RESOURCES: ResourceRow[] = [
  {
    id: PERSONAL_INBOX_DEF_ID,
    entityDefinitionId: PERSONAL_INBOX_DEF_ID,
    apiSlug: 'personal-inboxes',
    entityType: 'personal_inbox',
  },
  // A custom def carries NO `entityType` — which is why blanket normalization is
  // wrong: its fallback slug is the renameable `apiSlug`.
  { id: DEALS_DEF_ID, entityDefinitionId: DEALS_DEF_ID, apiSlug: 'deals', entityType: undefined },
]

/** Service/lib code throws AuxxError, never TRPCError. */
const BAD_REQUEST = { name: 'BadRequestError', statusCode: 400 }

const writes = { insert: vi.fn(), delete: vi.fn() }

function fakeDb() {
  const db: any = {
    query: {
      ResourceAccess: { findFirst: async () => undefined },
      User: { findFirst: async () => ({ name: 'Granter' }) },
    },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => {
      writes.insert()
      return { values: () => ({ onConflictDoUpdate: async () => {} }) }
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
    granteeId: 'u_owner',
    permission: ResourcePermission.admin,
  })

const set = (recordId: string) =>
  setInstanceAccess(ctx(), recordId as RecordId, ResourceGranteeType.user, [
    { granteeId: 'u_owner', permission: ResourcePermission.admin },
  ])

beforeEach(() => {
  writes.insert.mockReset()
  writes.delete.mockReset()
  getCachedResources.mockReset()
  getCachedResources.mockResolvedValue(RESOURCES)
})

describe('personal_inbox inherits the mail keyspace backstop', () => {
  it('is recognised as a mail-sharing def', () => {
    expect(isMailSharingDef('personal_inbox')).toBe(true)
  })

  it('refuses a grant keyed by the personal-inbox def CUID', async () => {
    await expect(grant(`${PERSONAL_INBOX_DEF_ID}:pi_1`)).rejects.toMatchObject(BAD_REQUEST)
    expect(writes.insert).not.toHaveBeenCalled()
  })

  it('names the slug the caller should have used', async () => {
    await expect(grant(`${PERSONAL_INBOX_DEF_ID}:pi_1`)).rejects.toThrow(
      /toRecordId\('personal_inbox', <id>\)/
    )
  })

  it('refuses the apiSlug spelling too — it resolves to the same mail def', async () => {
    await expect(grant('personal-inboxes:pi_1')).rejects.toMatchObject(BAD_REQUEST)
    expect(writes.insert).not.toHaveBeenCalled()
  })

  it('covers setInstanceAccess, not just grantInstanceAccess', async () => {
    await expect(set(`${PERSONAL_INBOX_DEF_ID}:pi_1`)).rejects.toMatchObject(BAD_REQUEST)
    expect(writes.insert).not.toHaveBeenCalled()
  })

  it('writes the slug-keyed owner row — the shape provisioning actually uses', async () => {
    await expect(grant(toRecordId('personal_inbox', 'pi_1'))).resolves.toBeUndefined()
    expect(writes.insert).toHaveBeenCalled()
    // Already canonical: the hot mail path never reads the resources projection.
    expect(getCachedResources).not.toHaveBeenCalled()
  })

  it('still leaves a CUID-keyed grant on a custom def alone', async () => {
    await expect(grant(`${DEALS_DEF_ID}:rec_1`)).resolves.toBeUndefined()
    expect(writes.insert).toHaveBeenCalled()
  })
})
