// packages/lib/src/channels/personal-inbox-lifecycle.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 40a §3 — provisioning, claim and the offboarding guard, after the def split.
 *
 * The property under test is the one the whole plan exists for: a personal
 * mailbox is private because of **unforgeable definition membership**, not
 * because of an `inbox_is_personal` FieldValue that a write-wall pre-hook
 * defends. Two halves:
 *
 *  - **Provisioning** creates on `personal_inbox` and writes ONE owner `admin`
 *    row. Until this landed it created on the SHARED def with `isPersonal: true`
 *    — private only because `composeUserInstanceGrants` happened to branch on
 *    the marker, which is exactly the dependency phase 4 cannot delete.
 *  - **Claim** is therefore a cross-def MOVE rather than a marker flip, and it
 *    must leave the instance, its FieldValues and its grant rows all on the
 *    shared def, with the `role:org_member @ none` floor written.
 */

const hoisted = vi.hoisted(() => ({
  createInbox: vi.fn(),
  updateInbox: vi.fn(),
  getInboxById: vi.fn(),
  setInstanceAccess: vi.fn(async () => undefined),
  setInboxFloor: vi.fn(async () => undefined),
  moveInboxInstance: vi.fn(async () => ({
    instanceMoved: true,
    valuesRemapped: 3,
    valuesDeleted: 0,
    unmapped: [],
  })),
  rekeyInboxGrants: vi.fn(async () => ({ recoded: 1, raised: 0, dropped: 0 })),
  loadExistingState: vi.fn(),
  buildDefFieldIdMap: vi.fn(() => new Map([['inbox_name', 'cf_s_name']])),
  memberRoleMap: {} as Record<string, { role: string } | undefined>,
  integrationLink: undefined as { inboxId: string } | undefined,
}))

vi.mock('@auxx/database', () => ({
  database: { query: { InboxIntegration: { findFirst: async () => hoisted.integrationLink } } },
  schema: { InboxIntegration: { integrationId: 'integrationId' } },
}))
vi.mock('../cache', () => ({
  getOrgCache: () => ({ get: async () => hoisted.memberRoleMap }),
  onCacheEvent: vi.fn(async () => undefined),
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
vi.mock('./disconnect', () => ({ deleteChannelData: vi.fn(), disconnect: vi.fn() }))
vi.mock('../resource-access/resource-access-service', () => ({
  setInstanceAccess: hoisted.setInstanceAccess,
}))
vi.mock('../inboxes/inbox-floor', () => ({ setInboxFloor: hoisted.setInboxFloor }))
vi.mock('../inboxes/inbox-def-move', () => ({
  moveInboxInstance: hoisted.moveInboxInstance,
  rekeyInboxGrants: hoisted.rekeyInboxGrants,
  buildDefFieldIdMap: hoisted.buildDefFieldIdMap,
}))
vi.mock('../seed/entity-migrations/helpers', () => ({
  loadExistingState: hoisted.loadExistingState,
}))
vi.mock('../inboxes/inbox-service', () => ({
  InboxService: class {
    createInbox = hoisted.createInbox
    updateInbox = hoisted.updateInbox
    getInboxById = hoisted.getInboxById
  },
}))

const { claimPersonalInbox, provisionPersonalInbox } = await import('./personal-connection')

const ORG = 'org_1'
const OWNER = 'u_owner'
const ADMIN = 'u_admin'
const INBOX = 'ibx_1'
const SHARED_DEF = 'edf_shared'
const PERSONAL_DEF = 'edf_personal'

const personalInbox = (over: Record<string, unknown> = {}) => ({
  id: INBOX,
  recordId: `personal_inbox:${INBOX}`,
  entityDefinitionKey: 'personal_inbox',
  isPersonal: true,
  ownerUserId: OWNER,
  ...over,
})

beforeEach(() => {
  for (const fn of [
    hoisted.createInbox,
    hoisted.updateInbox,
    hoisted.getInboxById,
    hoisted.setInstanceAccess,
    hoisted.setInboxFloor,
    hoisted.moveInboxInstance,
    hoisted.rekeyInboxGrants,
    hoisted.loadExistingState,
  ]) {
    fn.mockReset()
  }
  hoisted.setInstanceAccess.mockResolvedValue(undefined as never)
  hoisted.setInboxFloor.mockResolvedValue(undefined as never)
  hoisted.moveInboxInstance.mockResolvedValue({
    instanceMoved: true,
    valuesRemapped: 3,
    valuesDeleted: 0,
    unmapped: [],
  } as never)
  hoisted.rekeyInboxGrants.mockResolvedValue({ recoded: 1, raised: 0, dropped: 0 } as never)
  hoisted.loadExistingState.mockResolvedValue({
    entityDefs: new Map([
      ['inbox', { id: SHARED_DEF, entityType: 'inbox' }],
      ['personal_inbox', { id: PERSONAL_DEF, entityType: 'personal_inbox' }],
    ]),
    fields: new Map(),
  } as never)
  hoisted.memberRoleMap = {}
  hoisted.integrationLink = undefined
})

// ═══════════════════════════════════════════════════════════════════════════
// Provisioning
// ═══════════════════════════════════════════════════════════════════════════

describe('provisionPersonalInbox', () => {
  beforeEach(() => {
    hoisted.createInbox.mockResolvedValue({
      id: INBOX,
      recordId: `personal_inbox:${INBOX}`,
    } as never)
  })

  it('creates on the `personal_inbox` DEF and stamps neither legacy field', async () => {
    await provisionPersonalInbox({
      organizationId: ORG,
      ownerUserId: OWNER,
      integrationId: 'int_1',
      email: 'me@example.com',
    }).catch(() => undefined)

    const input = hoisted.createInbox.mock.calls[0]?.[0] as Record<string, unknown>
    expect(input.entityDefinitionKey).toBe('personal_inbox')
    expect(input.ownerUserId).toBe(OWNER)
    // The def IS the marker, and it has no floor field — passing either would
    // write a field that does not exist on the new definition.
    expect(input).not.toHaveProperty('isPersonal')
    expect(input).not.toHaveProperty('defaultLens')
  })

  it('writes the owner’s Manager row in the `personal_inbox` KEYSPACE', async () => {
    await provisionPersonalInbox({
      organizationId: ORG,
      ownerUserId: OWNER,
      integrationId: 'int_1',
      email: 'me@example.com',
    }).catch(() => undefined)

    // Mail grant rows are matched by literal slug, so an `inbox:`-keyed row here
    // would leave the owner locked out of their own mailbox.
    expect(hoisted.setInstanceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, userId: OWNER }),
      `personal_inbox:${INBOX}`,
      'user',
      [{ granteeId: OWNER, rung: 'admin' }]
    )
  })

  it('writes NO org-wide floor row — `baselineAtCreate: true` means no row ⇒ no access', async () => {
    await provisionPersonalInbox({
      organizationId: ORG,
      ownerUserId: OWNER,
      integrationId: 'int_1',
      email: 'me@example.com',
    }).catch(() => undefined)
    expect(hoisted.setInboxFloor).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Claim — the cross-def move
// ═══════════════════════════════════════════════════════════════════════════

describe('claimPersonalInbox', () => {
  const claim = () =>
    claimPersonalInbox({ organizationId: ORG, adminUserId: ADMIN, inboxId: INBOX })

  it('moves the instance onto the shared def, remaps values and re-keys grants', async () => {
    hoisted.getInboxById.mockResolvedValue(personalInbox() as never)
    hoisted.updateInbox.mockResolvedValue({} as never)

    await claim()

    expect(hoisted.moveInboxInstance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        instanceId: INBOX,
        fromDefId: PERSONAL_DEF,
        toDefId: SHARED_DEF,
      })
    )
    // The field map is built for the TARGET def out of the SAME state object —
    // one `loadExistingState` call for both ends.
    expect(hoisted.buildDefFieldIdMap).toHaveBeenCalledWith(expect.anything(), SHARED_DEF)
    expect(hoisted.rekeyInboxGrants).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fromKey: 'personal_inbox', toKey: 'inbox' })
    )
  })

  it('writes the `role:org_member @ none` floor BEFORE clearing the owner', async () => {
    // Order matters: a shared-def instance with no baseline row takes the
    // `Area.inboxes` fallback, i.e. `full` for every member. Any window in that
    // state is an org-wide exposure of a mailbox nobody consented to share.
    const order: string[] = []
    hoisted.getInboxById.mockResolvedValue(personalInbox() as never)
    hoisted.setInboxFloor.mockImplementation(async () => {
      order.push('floor')
    })
    hoisted.updateInbox.mockImplementation(async () => {
      order.push('owner')
      return {} as never
    })

    await claim()

    expect(hoisted.setInboxFloor).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, userId: ADMIN }),
      `inbox:${INBOX}`,
      'none'
    )
    expect(order).toEqual(['floor', 'owner'])
  })

  it('NULLS `inbox_owner_user_id` on the shared def rather than dropping it', async () => {
    hoisted.getInboxById.mockResolvedValue(personalInbox() as never)
    hoisted.updateInbox.mockResolvedValue({} as never)

    await claim()

    expect(hoisted.updateInbox).toHaveBeenCalledWith(`inbox:${INBOX}`, { ownerUserId: null })
    // No marker flip any more — def membership already says "not personal".
    expect(hoisted.updateInbox.mock.calls[0]?.[1]).not.toHaveProperty('isPersonal')
  })

  it('REFUSES an inbox that is not on the `personal_inbox` def', async () => {
    // Def membership, not `isPersonal`: the derived flag is still true for a
    // legacy marker-only mailbox on the SHARED def, and there is nothing to move
    // such an instance off. Fail closed rather than half-claim it.
    hoisted.getInboxById.mockResolvedValue(
      personalInbox({ entityDefinitionKey: 'inbox', recordId: `inbox:${INBOX}` }) as never
    )
    await expect(claim()).rejects.toThrow(/Not a personal inbox/)
    expect(hoisted.moveInboxInstance).not.toHaveBeenCalled()
  })

  it('REFUSES while the owner is still an org member', async () => {
    hoisted.getInboxById.mockResolvedValue(personalInbox() as never)
    hoisted.memberRoleMap = { [OWNER]: { role: 'USER' } }
    await expect(claim()).rejects.toThrow(/still a member/)
    expect(hoisted.moveInboxInstance).not.toHaveBeenCalled()
  })

  it('REFUSES when the org has no seeded inbox definitions', async () => {
    hoisted.getInboxById.mockResolvedValue(personalInbox() as never)
    hoisted.loadExistingState.mockResolvedValue({
      entityDefs: new Map([['inbox', { id: SHARED_DEF, entityType: 'inbox' }]]),
      fields: new Map(),
    } as never)
    await expect(claim()).rejects.toThrow(/definitions are not seeded/)
    expect(hoisted.moveInboxInstance).not.toHaveBeenCalled()
  })
})
