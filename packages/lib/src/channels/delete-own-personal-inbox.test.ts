// packages/lib/src/channels/delete-own-personal-inbox.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `deleteOwnPersonalInbox` — the member-facing half of the personal mailbox
 * lifecycle, and the only authority behind `inbox.delete`'s personal branch.
 *
 * It exists because nothing could delete a LIVE personal inbox at all: the
 * router's shared gates are `channels.manage` (which the owner, an ordinary
 * member, never holds) AND an inbox Manager grant (which an admin holding the
 * key never has on a `baselineAtCreate: true` mailbox), so every caller failed
 * one half or the other, while `deletePersonalInbox` refuses until the owner
 * leaves the org. Disconnecting the account did not help — it destroyed the
 * threads and soft-deleted the `Integration` but left the inbox instance
 * standing forever.
 *
 * Three properties are pinned, and each is a way this could ship wrong:
 *
 *  - **Authority is OWNERSHIP, not a grant.** A `personal_inbox` `admin`
 *    `ResourceAccess` row is something the owner hands out by sharing, so
 *    reusing `canManageInboxAccess` (as the shared branch does) would let a
 *    Manager grantee destroy the owner's mail.
 *  - **The def, not `isPersonal`.** The derived flag is `def OR legacy marker`
 *    and the two disagree by design across the 059 → 060 window; only def
 *    membership proves the data was never org-visible.
 *  - **The channel goes with it.** `InboxService.deleteInbox` refuses while an
 *    active channel is routed here, so skipping the cascade turns the whole
 *    feature into a `ConflictError` — the exact dead end it was written to fix.
 */

const hoisted = vi.hoisted(() => ({
  getInboxById: vi.fn(),
  deleteInbox: vi.fn(async () => undefined),
  // `disconnect` returns a `TypedResult`, so the fake has to be able to resolve
  // BOTH arms — an inferred `{ ok: true; value }` would reject the error case.
  disconnect: vi.fn(
    async (): Promise<{ ok: boolean; value?: unknown; error?: unknown }> => ({
      ok: true,
      value: { success: true },
    })
  ),
  onCacheEvent: vi.fn(async () => undefined),
  links: [] as Array<{ integrationId: string }>,
}))

vi.mock('@auxx/database', () => ({
  database: { query: { InboxIntegration: { findMany: async () => hoisted.links } } },
  schema: { InboxIntegration: { inboxId: 'inboxId' } },
}))
vi.mock('../cache', () => ({
  getOrgCache: () => ({ get: async () => ({}) }),
  onCacheEvent: hoisted.onCacheEvent,
}))
vi.mock('../email/polling-import-cache', () => ({ clearImportCache: vi.fn() }))
vi.mock('../jobs/maintenance/storage-cleanup-job', () => ({ enqueueStorageCleanupJob: vi.fn() }))
vi.mock('../providers/google/google-oauth', () => ({
  GoogleOAuthService: { revokeAccess: vi.fn() },
}))
vi.mock('../providers/outlook/outlook-oauth', () => ({
  OutlookOAuthService: { revokeAccess: vi.fn() },
}))
vi.mock('../providers/provider-capabilities', () => ({ PROVIDER_CAPABILITIES: {} }))
vi.mock('./channel-connection-def', () => ({ CHANNEL_PROVIDER_TO_KEY: {} }))
vi.mock('./disconnect', () => ({
  deleteChannelData: vi.fn(),
  disconnect: hoisted.disconnect,
}))
vi.mock('../resource-access/resource-access-service', () => ({ setInstanceAccess: vi.fn() }))
vi.mock('../inboxes/inbox-floor', () => ({ setInboxFloor: vi.fn() }))
vi.mock('../inboxes/inbox-def-move', () => ({
  moveInboxInstance: vi.fn(),
  rekeyInboxGrants: vi.fn(),
  buildDefFieldIdMap: vi.fn(),
}))
vi.mock('../seed/entity-migrations/helpers', () => ({ loadExistingState: vi.fn() }))
vi.mock('../inboxes/inbox-service', () => ({
  InboxService: class {
    getInboxById = hoisted.getInboxById
    deleteInbox = hoisted.deleteInbox
  },
}))

const { deleteOwnPersonalInbox } = await import('./personal-connection')

const ORG = 'org_1'
const OWNER = 'usr_owner'
const OTHER = 'usr_other'
const INBOX = 'ibx_personal'
const CHANNEL = 'int_channel'

const personalInbox = (over: Record<string, unknown> = {}) => ({
  id: INBOX,
  recordId: `personal_inbox:${INBOX}`,
  entityDefinitionKey: 'personal_inbox',
  isPersonal: true,
  ownerUserId: OWNER,
  ...over,
})

beforeEach(() => {
  hoisted.getInboxById.mockReset()
  hoisted.deleteInbox.mockReset()
  hoisted.disconnect.mockReset()
  hoisted.onCacheEvent.mockReset()
  hoisted.getInboxById.mockResolvedValue(personalInbox())
  hoisted.deleteInbox.mockResolvedValue(undefined)
  hoisted.disconnect.mockResolvedValue({ ok: true, value: { success: true } })
  hoisted.links = [{ integrationId: CHANNEL }]
})

describe('deleteOwnPersonalInbox', () => {
  it('disconnects the account, then deletes the mailbox on its own def', async () => {
    await deleteOwnPersonalInbox({ organizationId: ORG, userId: OWNER, inboxId: INBOX })

    expect(hoisted.disconnect).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, userId: OWNER }),
      CHANNEL
    )
    // The RecordId carries `personal_inbox`, not the shared slug — `deleteInbox`
    // deletes the entity instance through it, and a wrong def would delete
    // nothing while reporting success.
    expect(hoisted.deleteInbox).toHaveBeenCalledWith(`personal_inbox:${INBOX}`)
    expect(hoisted.onCacheEvent).toHaveBeenCalledWith('channel.disconnected', { orgId: ORG })
  })

  it('disconnects BEFORE deleting — the other order hits the active-channel guard', async () => {
    const order: string[] = []
    hoisted.disconnect.mockImplementation(async () => {
      order.push('disconnect')
      return { ok: true, value: { success: true } }
    })
    hoisted.deleteInbox.mockImplementation(async () => {
      order.push('deleteInbox')
    })

    await deleteOwnPersonalInbox({ organizationId: ORG, userId: OWNER, inboxId: INBOX })

    expect(order).toEqual(['disconnect', 'deleteInbox'])
  })

  it('refuses a member who is not the owner, however privileged', async () => {
    await expect(
      deleteOwnPersonalInbox({ organizationId: ORG, userId: OTHER, inboxId: INBOX })
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(hoisted.disconnect).not.toHaveBeenCalled()
    expect(hoisted.deleteInbox).not.toHaveBeenCalled()
  })

  it('refuses an ownerless personal mailbox — that is the orphan path, not this one', async () => {
    hoisted.getInboxById.mockResolvedValue(personalInbox({ ownerUserId: null }))

    await expect(
      deleteOwnPersonalInbox({ organizationId: ORG, userId: OWNER, inboxId: INBOX })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(hoisted.deleteInbox).not.toHaveBeenCalled()
  })

  it('refuses a SHARED inbox even when the caller is stamped as its owner', async () => {
    // The legacy `inbox_is_personal` marker still resolves `isPersonal: true` on
    // the shared def between migrations 059 and 060. Only def membership proves
    // the mail was never org-visible, so this path must read the def.
    hoisted.getInboxById.mockResolvedValue(
      personalInbox({ entityDefinitionKey: 'inbox', recordId: `inbox:${INBOX}` })
    )

    await expect(
      deleteOwnPersonalInbox({ organizationId: ORG, userId: OWNER, inboxId: INBOX })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(hoisted.deleteInbox).not.toHaveBeenCalled()
  })

  it('refuses an inbox that does not exist', async () => {
    hoisted.getInboxById.mockResolvedValue(null)

    await expect(
      deleteOwnPersonalInbox({ organizationId: ORG, userId: OWNER, inboxId: INBOX })
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('still deletes the mailbox when its channel is already gone', async () => {
    // Half-run offboarding, or a prior disconnect: `validateChannelOwnership`
    // no longer finds a soft-deleted Integration. Aborting here would recreate
    // the undeletable-empty-inbox state this function exists to end.
    hoisted.disconnect.mockResolvedValue({ ok: false, error: new Error('Channel not found') })

    await deleteOwnPersonalInbox({ organizationId: ORG, userId: OWNER, inboxId: INBOX })

    expect(hoisted.deleteInbox).toHaveBeenCalledWith(`personal_inbox:${INBOX}`)
  })

  it('deletes a mailbox with no channels at all and skips the inventory event', async () => {
    hoisted.links = []

    await deleteOwnPersonalInbox({ organizationId: ORG, userId: OWNER, inboxId: INBOX })

    expect(hoisted.disconnect).not.toHaveBeenCalled()
    expect(hoisted.deleteInbox).toHaveBeenCalledWith(`personal_inbox:${INBOX}`)
    expect(hoisted.onCacheEvent).not.toHaveBeenCalledWith('channel.disconnected', { orgId: ORG })
  })
})
