// apps/web/src/server/api/routers/resource-access-mail-canonicalization.test.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 §5.1 / §12 — the phase-0b ROUTER regression.
 *
 * `ResourceAccess.entityDefinitionId` is a dual keyspace: mail defs are keyed by
 * SLUG (`composeUserInstanceGrants:69` and `isMailSharingDef` both test the
 * literal), generic record defs by the def CUID. `inbox-detail.tsx` built the
 * inbox RecordId from the def CUID, so inbox grants landed in a keyspace mail
 * visibility never reads AND — because `isMailSharingDef` is a slug test —
 * skipped BOTH `assertCanManageMailSharing` and the plan
 * `granularPermissions` plan gate. Anyone with `channels.manage` wrote inbox grants
 * unguarded, and the grant then did nothing.
 *
 * Both halves are pinned here, together, because they have ONE cause: the
 * canonicalization must run BEFORE authorization, so breaking it must fail the
 * write-keyspace assertion and the authorization assertion at the same time.
 *
 * The negative control matters as much: a CUID on a generic/custom def must
 * survive verbatim — those rows ARE read CUID-keyed by the record-capability
 * layer, and a custom def has no stable slug to normalize to.
 */

const { getCapabilities, resourceAccess, isAdminOrOwner, recordAuditFromCtx, getCachedResources } =
  vi.hoisted(() => ({
    getCapabilities: vi.fn(),
    resourceAccess: {
      grantInstanceAccess: vi.fn(async () => undefined),
      setInstanceAccess: vi.fn(async () => undefined),
      revokeInstanceAccess: vi.fn(async () => true),
      grantTypeAccess: vi.fn(async () => undefined),
      setTypeAccess: vi.fn(async () => undefined),
      revokeTypeAccess: vi.fn(async () => true),
      getInstanceAccess: vi.fn(async () => []),
      getTypeAccess: vi.fn(async () => []),
      getAllInstanceAccess: vi.fn(async () => []),
      getAllTypeAccess: vi.fn(async () => []),
      assertCanManageMailSharing: vi.fn(async () => undefined),
      assertCanManageMailTypeAccess: vi.fn(async () => undefined),
      assertMailSharingFeature: vi.fn(async () => undefined),
    },
    isAdminOrOwner: vi.fn(async () => false),
    recordAuditFromCtx: vi.fn(async () => undefined),
    getCachedResources: vi.fn(),
  }))

// `isMailSharingDef` is kept REAL — it is half of the behaviour under test. It
// lives in a dependency-free leaf so it can be deep-imported without dragging
// the mail-sharing guard's db/permissions dependencies into the test.
vi.mock('@auxx/lib/resource-access', async () => {
  const { isMailSharingDef } = await import('@auxx/lib/resource-access/mail-sharing-defs')
  return { ...resourceAccess, isMailSharingDef, ORG_MEMBER_GRANTEE_ID: 'org_member' }
})
vi.mock('@auxx/lib/members', () => ({ isAdminOrOwner }))
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx }))
vi.mock('@auxx/lib/cache', () => ({
  getCachedResources,
  // `grantee-schema.ts` is kept real — it decides which grantee kinds are legal.
  getCachedPermissionProfiles: vi.fn(async () => []),
}))

// The permissions barrel reaches redis/db at import time and hangs under vitest.
// Re-export the REAL instance-access registry and the REAL `buildDefIdToSlug`
// resolver (the other half of the behaviour under test); stub only capabilities.
vi.mock('@auxx/lib/permissions', async () => {
  const instanceAccess = await import('@auxx/lib/permissions/capabilities/instance-access')
  const resolve = await import('@auxx/lib/permissions/capabilities/resolve-capability-inputs')
  const types = await import('@auxx/lib/permissions/types')
  return {
    ...instanceAccess,
    buildDefIdToSlug: resolve.buildDefIdToSlug,
    FeatureKey: types.FeatureKey,
    FeaturePermissionService: class {
      requireAccess = vi.fn(async () => undefined)
    },
    getCapabilities,
  }
})

vi.mock('../trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return { createTRPCRouter: t.router, protectedProcedure: t.procedure }
})

const { resourceAccessRouter } = await import('./resourceAccess')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

/** Def CUIDs, exactly as `inbox-detail.tsx` used to read them off `useResource()`. */
const INBOX_DEF_ID = 'qiramlz5m0cswo4n4v10mxkz'
const CONTACT_DEF_ID = 'mzxt3cxyzhm3cbtgcbpmeir1'
const DEALS_DEF_ID = 'deal5defcuid0000000000000'
const INBOX_ID = 'nfb3wo1bp0q72tdnvst902kl'

const CUID_INBOX_RECORD_ID = `${INBOX_DEF_ID}:${INBOX_ID}`
const SLUG_INBOX_RECORD_ID = `inbox:${INBOX_ID}`
const CUID_CONTACT_RECORD_ID = `${CONTACT_DEF_ID}:cnt_1`
const SLUG_CONTACT_RECORD_ID = 'contact:cnt_1'
const CUSTOM_RECORD_ID = `${DEALS_DEF_ID}:rec_1`

/** Only the four keys `buildDefIdToSlug` reads. A custom def has NO `entityType`. */
const RESOURCES = [
  { id: INBOX_DEF_ID, entityDefinitionId: INBOX_DEF_ID, apiSlug: 'inboxes', entityType: 'inbox' },
  {
    id: CONTACT_DEF_ID,
    entityDefinitionId: CONTACT_DEF_ID,
    apiSlug: 'contacts',
    entityType: 'contact',
  },
  { id: DEALS_DEF_ID, entityDefinitionId: DEALS_DEF_ID, apiSlug: 'deals', entityType: undefined },
]

const assertAdminInstance = vi.fn()
/**
 * The record-lane and read-lane asserts plan v3/03 §7.1/§7.2 added. Permissive
 * here on purpose: this file's subject is the KEYSPACE the authorizers see, not
 * which answer they give — the record lane's own denials live in
 * `resource-access-record-lane.test.ts`.
 */
const assertEditEntity = vi.fn()
const assertViewEntity = vi.fn()
const assertViewInstance = vi.fn()
// Plan v3/03 P5 — the record lane's share gate now takes the DEF branch first
// (`canEditEntity`) and only falls through to the row-effective read when that
// says no. Permissive here for the same reason the asserts above are: this
// file's subject is the KEYSPACE, not the answer.
const canEditEntity = vi.fn(() => true)

const caller = resourceAccessRouter.createCaller({
  db: {},
  headers: new Headers(),
  session: { organizationId: ORG_ID, userId: USER_ID, user: { id: USER_ID } },
} as any)

/**
 * Every RecordId the authorization layer actually saw, normalized to
 * `def:instance`.
 *
 * WHICH authorizer owns a mail def is deliberately not pinned here: `contact`
 * and `thread` answer to `assertCanManageMailSharing`, and plan 40 phase 1 moves
 * `inbox`/`personal_inbox` onto `assertAdminInstance` (§5.3) as they become
 * instance-access keys. The invariant under test is older than either routing
 * and survives both: **authorization runs on the CANONICAL key**. The CUID bug
 * was exactly the case where it ran on a key nothing recognized — or, for
 * `isMailSharingDef` targets, did not run at all.
 */
function authorizedKeys(): string[] {
  return [
    ...resourceAccess.assertCanManageMailSharing.mock.calls.map((c: unknown[]) => c[1] as string),
    ...assertAdminInstance.mock.calls.map((c: unknown[]) => `${c[0]}:${c[1]}`),
  ]
}

beforeEach(() => {
  for (const fn of Object.values(resourceAccess)) fn.mockReset()
  resourceAccess.revokeInstanceAccess.mockResolvedValue(true)
  resourceAccess.getInstanceAccess.mockResolvedValue([])
  resourceAccess.assertCanManageMailSharing.mockResolvedValue(undefined)
  resourceAccess.assertMailSharingFeature.mockResolvedValue(undefined)
  isAdminOrOwner.mockReset()
  isAdminOrOwner.mockResolvedValue(false)
  recordAuditFromCtx.mockReset()
  assertAdminInstance.mockReset()
  getCapabilities.mockReset()
  assertEditEntity.mockReset()
  assertViewEntity.mockReset()
  assertViewInstance.mockReset()
  canEditEntity.mockClear()
  getCapabilities.mockResolvedValue({
    assertAdminInstance,
    assertEditEntity,
    assertViewEntity,
    assertViewInstance,
    canEditEntity,
    areaLevel: vi.fn(),
  })
  getCachedResources.mockReset()
  getCachedResources.mockResolvedValue(RESOURCES)
})

describe('a CUID-keyed inbox grant is canonicalized BEFORE it is authorized (§5.1)', () => {
  /**
   * The two halves are asserted in SEPARATE tests on purpose: breaking
   * `canonicalMailRecordId` must be visible as two independent failures (plan
   * §12), not as one test that stops at its first `expect`.
   */
  const grantThroughCuid = () =>
    caller.grantInstance({
      recordId: CUID_INBOX_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
      rung: 'identity',
    })

  it('grantInstance (a): the row lands in the keyspace mail visibility reads', async () => {
    await expect(grantThroughCuid()).resolves.toEqual({ success: true })
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: SLUG_INBOX_RECORD_ID })
    )
  })

  it('grantInstance (b): authorization runs, and on the canonical key', async () => {
    await grantThroughCuid()
    expect(authorizedKeys()).toContain(SLUG_INBOX_RECORD_ID)
  })

  it('grantInstance (c): a mail-sharing def still reaches the mail authorizer + enterprise gate', async () => {
    await caller.grantInstance({
      recordId: CUID_CONTACT_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
      rung: 'identity',
    })
    expect(resourceAccess.assertCanManageMailSharing).toHaveBeenCalledWith(
      expect.anything(),
      SLUG_CONTACT_RECORD_ID
    )
    expect(resourceAccess.assertMailSharingFeature).toHaveBeenCalledWith(
      expect.anything(),
      SLUG_CONTACT_RECORD_ID,
      expect.anything()
    )
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: SLUG_CONTACT_RECORD_ID })
    )
  })

  it('setInstance: replace-all targets the slug keyspace, not a parallel one', async () => {
    await caller.setInstance({
      recordId: CUID_INBOX_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      grants: [{ granteeId: 'usr_grantee', rung: 'admin' }],
    })

    expect(resourceAccess.setInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      SLUG_INBOX_RECORD_ID,
      ResourceGranteeType.user,
      expect.anything()
    )
    expect(authorizedKeys()).toContain(SLUG_INBOX_RECORD_ID)
  })

  it('revokeInstance: deletes the slug row, and authorizes on it', async () => {
    await caller.revokeInstance({
      recordId: CUID_INBOX_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
    })

    expect(resourceAccess.revokeInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: SLUG_INBOX_RECORD_ID })
    )
    expect(authorizedKeys()).toContain(SLUG_INBOX_RECORD_ID)
  })

  it('forInstance: the READ path reads the same keyspace the writes use', async () => {
    await caller.forInstance({ recordId: CUID_INBOX_RECORD_ID })
    expect(resourceAccess.getInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      SLUG_INBOX_RECORD_ID
    )
  })

  it('forInstance: the READ AUTHORIZER also runs on the canonical key (§7.2)', async () => {
    // `forInstance` had NO authorization at all before plan v3/03 §7.2. Now that it
    // has one, canonicalization has to precede it for the same reason it precedes
    // the write authorizers: a gate resolved on a key nothing recognises is a gate
    // that answers about the wrong instance.
    await caller.forInstance({ recordId: CUID_INBOX_RECORD_ID })
    expect(assertViewInstance).toHaveBeenCalledWith('inbox', INBOX_ID)
  })

  it('audits the canonical key, so the log and the row agree', async () => {
    await caller.grantInstance({
      recordId: CUID_INBOX_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
      rung: 'read',
    })
    expect(recordAuditFromCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetId: SLUG_INBOX_RECORD_ID })
    )
  })

  it('an already-slug-keyed inbox grant is untouched (idempotent)', async () => {
    await caller.grantInstance({
      recordId: SLUG_INBOX_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
      rung: 'read',
    })
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: SLUG_INBOX_RECORD_ID })
    )
  })
})

describe('canonicalization is scoped to mail defs — the negative control', () => {
  it('a CUID on a custom def is written verbatim (custom defs have no stable slug)', async () => {
    await caller.grantInstance({
      recordId: CUSTOM_RECORD_ID,
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
      rung: 'read',
    })
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: CUSTOM_RECORD_ID })
    )
  })

  it('a non-mail instance-access key never reaches the mail authorizer', async () => {
    getCapabilities.mockResolvedValue({
      assertAdminInstance: vi.fn(),
      assertEditEntity,
      canEditEntity,
    })
    await caller.grantInstance({
      recordId: 'dataset:dset_1',
      granteeType: ResourceGranteeType.user,
      granteeId: 'usr_grantee',
      rung: 'read',
    })
    expect(resourceAccess.assertCanManageMailSharing).not.toHaveBeenCalled()
    expect(resourceAccess.grantInstanceAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordId: 'dataset:dset_1' })
    )
  })
})
