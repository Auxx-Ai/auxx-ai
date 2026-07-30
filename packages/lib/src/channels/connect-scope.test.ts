// packages/lib/src/channels/connect-scope.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The connect-scope precheck in `channelProvisioningHook` (§11.1).
 *
 * `upsertIntegration` relinks the live Integration row for `(org, provider, email)` onto the
 * incoming credential and clears its sync breaker. The destination guards used to run AFTER that
 * write, so a personal connect of a mailbox that is already a shared channel failed for the user
 * yet left the ORG's channel holding the connector's personal credential — and
 * `disconnectPersonalChannelsForUser` matches on `Credential.userId`, so offboarding that member
 * would have soft-deleted the org channel. The property under test is therefore not the error
 * message (that already existed) but that a rejected connect performs **no writes at all**.
 */

const EMAIL = 'shared@example.com'
const ORG = 'org_1'
const USER = 'u_connector'
const OTHER = 'u_other'
const INTEGRATION = 'int_live'
const CREDENTIAL = 'cred_new'

const hoisted = vi.hoisted(() => ({
  integrationRows: [] as Array<{ id: string; metadata: unknown }>,
  link: undefined as { inboxId: string } | undefined,
  inbox: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  provisionPersonalInbox: vi.fn(async () => undefined),
  addIntegration: vi.fn(async () => undefined),
  assertSharedConnectInbox: vi.fn(async () => 'inbox:ibx_1'),
  enqueue: vi.fn(async () => undefined),
}))

const selectChain = () => ({
  from: () => ({ where: () => ({ limit: async () => hoisted.integrationRows }) }),
})

vi.mock('@auxx/database', () => ({
  database: {
    select: selectChain,
    update: () => ({
      set: (values: Record<string, unknown>) => {
        hoisted.updates.push(values)
        return { where: async () => undefined }
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        hoisted.inserts.push(values)
        return { returning: async () => [{ id: 'int_created' }] }
      },
    }),
    query: { InboxIntegration: { findFirst: async () => hoisted.link } },
  },
  schema: {
    Integration: {
      id: 'id',
      organizationId: 'organizationId',
      provider: 'provider',
      email: 'email',
      metadata: 'metadata',
      deletedAt: 'deletedAt',
    },
    InboxIntegration: { integrationId: 'integrationId' },
  },
}))

vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    init: () => ({
      api: () => ({
        select: () => ({ get: async () => ({ mail: EMAIL }) }),
        get: async () => ({ proxyAddresses: [] }),
      }),
    }),
  },
}))

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class {} },
    oauth2: () => ({ userinfo: { get: async () => ({ data: { email: EMAIL } }) } }),
  },
}))

vi.mock('../cache', () => ({ onCacheEvent: vi.fn(async () => undefined) }))
vi.mock('../events', () => ({ publisher: { publishLater: vi.fn(async () => undefined) } }))
vi.mock('../connections/resolve-connection-for-runtime', () => ({
  resolveConnectionForRuntime: async () => ({
    isErr: () => false,
    value: { userConnection: { value: 'tok', expiresAt: null, fields: {} } },
  }),
}))
vi.mock('../providers/google/google-oauth', () => ({
  GoogleOAuthService: { setupPushNotifications: vi.fn() },
}))
vi.mock('../providers/sync-mode-resolver', () => ({
  resolveEffectiveSyncMode: () => 'polling',
}))
vi.mock('../inboxes/inbox-service', () => ({
  InboxService: class {
    getInboxById = async () => hoisted.inbox
    addIntegration = hoisted.addIntegration
  },
}))
vi.mock('./connect-inbox', () => ({
  assertSharedConnectInbox: hoisted.assertSharedConnectInbox,
}))
vi.mock('./personal-connection', () => ({
  provisionPersonalInbox: hoisted.provisionPersonalInbox,
}))
// Only the brand-new-integration path reaches `seedSync`'s backfill kick, which
// enqueues on BullMQ. Unmocked, that opens a real Redis connection: it happens to
// resolve on a dev box with a local Redis and a `.env`, and HANGS to the 10s test
// timeout anywhere else (CI, a clean worktree).
vi.mock('../jobs/queues', () => ({
  Queues: { pollingSyncQueue: 'pollingSyncQueue' },
  getQueue: vi.fn(() => ({ add: hoisted.enqueue })),
}))

const { channelProvisioningHook } = await import('./provisioning-hook')

const connect = (over: Record<string, unknown> = {}) =>
  channelProvisioningHook.run({
    credentialId: CREDENTIAL,
    providerKey: 'outlookMail',
    organizationId: ORG,
    userId: USER,
    ...over,
  })

const sharedInbox = { id: 'ibx_1', recordId: 'inbox:ibx_1', isPersonal: false, ownerUserId: null }
const personalInboxOf = (owner: string) => ({
  id: 'ibx_2',
  recordId: `personal_inbox:ibx_2`,
  isPersonal: true,
  ownerUserId: owner,
})

beforeEach(() => {
  hoisted.integrationRows = [{ id: INTEGRATION, metadata: { email: EMAIL } }]
  hoisted.link = { inboxId: 'ibx_1' }
  hoisted.inbox = sharedInbox
  hoisted.updates = []
  hoisted.inserts = []
  hoisted.provisionPersonalInbox.mockReset()
  hoisted.addIntegration.mockReset()
  hoisted.enqueue.mockReset()
})

describe('personal connect', () => {
  it('rejects a mailbox already connected as a shared channel without writing anything', async () => {
    await expect(connect({ personal: true })).rejects.toThrow(/already connected as a shared/)

    expect(hoisted.updates).toEqual([])
    expect(hoisted.inserts).toEqual([])
    expect(hoisted.provisionPersonalInbox).not.toHaveBeenCalled()
  })

  it("rejects another member's personal mailbox", async () => {
    hoisted.inbox = personalInboxOf(OTHER)

    await expect(connect({ personal: true })).rejects.toThrow(/another member's personal account/)
    expect(hoisted.updates).toEqual([])
  })

  it('rejects a live integration with no inbox link — nothing proves it was never org-visible', async () => {
    hoisted.link = undefined
    hoisted.inbox = null

    await expect(connect({ personal: true })).rejects.toThrow(/already connected to this org/)
    expect(hoisted.updates).toEqual([])
  })

  it('allows a reconnect of the connector’s own personal mailbox', async () => {
    hoisted.inbox = personalInboxOf(USER)

    await connect({ personal: true })

    expect(hoisted.provisionPersonalInbox).toHaveBeenCalledOnce()
    expect(hoisted.updates.some((u) => u.credentialId === CREDENTIAL)).toBe(true)
  })

  it('provisions a brand-new mailbox', async () => {
    hoisted.integrationRows = []
    hoisted.link = undefined
    hoisted.inbox = null

    await connect({ personal: true })

    expect(hoisted.inserts).toHaveLength(1)
    expect(hoisted.provisionPersonalInbox).toHaveBeenCalledOnce()
    // A new integration also kicks the initial polling backfill; a reconnect does not.
    expect(hoisted.enqueue).toHaveBeenCalledOnce()
  })
})

describe('shared connect', () => {
  it('rejects a mailbox held as a personal account without writing anything', async () => {
    hoisted.inbox = personalInboxOf(OTHER)

    await expect(connect()).rejects.toThrow(/connected as a personal account/)

    expect(hoisted.updates).toEqual([])
    expect(hoisted.inserts).toEqual([])
    expect(hoisted.addIntegration).not.toHaveBeenCalled()
  })

  it('allows a reconnect of an existing shared channel', async () => {
    await connect()

    expect(hoisted.updates.some((u) => u.credentialId === CREDENTIAL)).toBe(true)
    // Already linked — the destination param is ignored on reconnect.
    expect(hoisted.assertSharedConnectInbox).not.toHaveBeenCalled()
  })
})
