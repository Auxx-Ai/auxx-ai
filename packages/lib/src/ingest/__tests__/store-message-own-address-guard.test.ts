// packages/lib/src/ingest/__tests__/store-message-own-address-guard.test.ts
//
// message-trigger-scoping plan §6 #1 — the org-wide own-address union gating
// the `message:received` publish. A cross-channel echo (a reply sent on one
// channel, re-arriving `isInbound: true` on a different one — a second
// connected mailbox, or the SES forwarding alias) must not publish, because
// `message:received` fans out to five subscribers (workflows,
// mail-classification, bounce ingest, mail filters, signal derivation) — none
// of them should ever see the org's own outbound mail as new inbound.
//
// Also pins §4: the surviving publish carries `integrationId` + `inboxId`
// so the dispatcher can gate on channel scope without an extra query.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cachedChannels: [] as Array<{
    id: string
    email: string | null
    metadata: unknown
    inboxId?: string | null
  }>,
  published: [] as Array<{ type: string; data: Record<string, unknown> }>,
  senderIdentifier: 'sender@example.com',
  threadRow: {} as Record<string, unknown>,
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: async () => h.cachedChannels }),
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishThreadCreated: vi.fn(),
  publishThreadUpdated: vi.fn(),
  publishMessageCreated: vi.fn(),
}))

vi.mock('../../threads/mail-counts', () => ({ applyMailCountDeltas: vi.fn() }))
vi.mock('../../entity-instances/activity', () => ({ touchActivityForThreadLinks: vi.fn() }))
vi.mock('../../events/publisher', () => ({
  publisher: {
    publishLater: vi.fn(async (evt: { type: string; data: Record<string, unknown> }) => {
      h.published.push(evt)
    }),
  },
}))
vi.mock('../../permissions/visibility/audience', () => ({
  getFullLensAudienceForInbox: async () => [],
}))
vi.mock('../inbox-meta', () => ({ isPersonalInbox: async () => false }))
vi.mock('../../inbox-record-ids', () => ({ toInboxRecordId: async () => 'inbox:i_1' }))

vi.mock('../filtering/machine-mail', () => ({ detectMachineMail: () => null }))
vi.mock('../filtering/should-ignore', () => ({ shouldIgnoreMessage: () => false }))
vi.mock('../filtering/store-ignored', () => ({ storeIgnoredMessage: vi.fn() }))
vi.mock('../reconciliation/extract-internet-message-id', () => ({
  extractInternetMessageId: () => null,
}))
vi.mock('../reconciliation/reconcile-message', () => ({ reconcileMessage: async () => null }))
vi.mock('../threads/update-metadata', () => ({ updateThreadMetadataEfficient: vi.fn() }))
vi.mock('../participants/normalize', () => ({
  determineIdentifierType: async () => 'EMAIL',
  normalizeIdentifier: (v: string) => v.toLowerCase(),
}))
vi.mock('../participants/find-or-create', () => ({
  findOrCreateParticipantRecord: async () => ({
    id: 'p_1',
    identifier: h.senderIdentifier,
    name: 'Sender',
    entityInstanceId: null,
    isInternal: false,
  }),
}))

vi.mock('@auxx/database', () => ({
  schema: new Proxy(
    {},
    { get: (_t, table) => new Proxy({}, { get: (_t2, col) => `${String(table)}.${String(col)}` }) }
  ),
}))

vi.mock('drizzle-orm', () => {
  const passthrough = (...a: unknown[]) => a
  return {
    and: passthrough,
    eq: passthrough,
    isNull: passthrough,
    sql: Object.assign(passthrough, { raw: passthrough }),
  }
})

import { storeMessage } from '../store-message'

const ORG = 'org_1'
const INTEGRATION_ID = 'int_outlook'
const INBOX_ID = 'i_shared'
const SENT_AT = new Date('2026-08-12T10:00:00.000Z')

/** Chainable double where every terminal await resolves to `[]`. */
function emptyChain(): any {
  const obj: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (res: (v: unknown[]) => unknown) => Promise.resolve(res([]))
        return () => obj
      },
    }
  )
  return obj
}

function tx() {
  const returningFor = (table: string) => {
    if (table.startsWith('Thread')) return [h.threadRow]
    if (table.startsWith('Message')) return [{ id: 'm_1' }]
    return []
  }
  const chainFor = (table: string): any => {
    const obj: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'returning') return async () => returningFor(table)
          if (prop === 'then') return (res: (v: unknown[]) => unknown) => Promise.resolve(res([]))
          return () => obj
        },
      }
    )
    return obj
  }
  const tableName = (t: unknown) => String((t as any)?.id ?? '').split('.')[0] ?? ''
  return {
    insert: (t: unknown) => chainFor(tableName(t)),
    update: (t: unknown) => chainFor(tableName(t)),
  }
}

function ctx() {
  return {
    organizationId: ORG,
    db: {
      select: () => emptyChain(),
      update: () => emptyChain(),
      transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx()),
      query: { SequenceRun: { findFirst: async () => null } },
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    systemUserId: 'sys',
    crudHandler: {},
    reconciler: {},
    threadManager: {},
    selectiveCache: {},
    isInitialSync: false,
    ownEmails: new Set<string>(),
    inSyncBatch: false,
    touchedInboxIds: new Set<string | null>(),
    companyIdByDomain: new Map(),
    ownDomainsByOrg: new Map(),
    providerByIntegrationId: new Map(),
  } as any
}

function messageData(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    integrationId: INTEGRATION_ID,
    externalId: 'ext_1',
    externalThreadId: 'extthread_1',
    inboxId: INBOX_ID,
    subject: 'Hello',
    isInbound: true,
    sentAt: SENT_AT,
    receivedAt: SENT_AT,
    createdTime: SENT_AT,
    hasAttachments: false,
    from: { identifier: h.senderIdentifier, name: 'Sender' },
    to: [{ identifier: 'dest@example.com' }],
    ...overrides,
  } as any
}

beforeEach(() => {
  h.cachedChannels = []
  h.published = []
  h.senderIdentifier = 'sender@example.com'
  h.threadRow = {
    id: 't_1',
    inboxId: INBOX_ID,
    status: 'OPEN',
    assigneeId: null,
    messageCount: 1,
    firstMessageAt: SENT_AT,
    lastMessageAt: SENT_AT,
    participantCount: 1,
  }
})

/**
 * Own-address mail is FLAGGED, never suppressed. The address level cannot tell
 * a cross-channel echo from a teammate writing in off their own connected
 * mailbox, so the publish always happens and `fromOwnAddress` lets each
 * workflow trigger decide (`trigger-message-workflows.ts`, default: fire). The
 * hard loop guard is `ownEcho` — see the sibling echoed-message-id suite.
 */
describe('storeMessage — own-address signal on message:received', () => {
  const publishedData = () => (h.published[0] as any)?.data

  it('flags fromOwnAddress when From matches a channel primary email', async () => {
    h.senderIdentifier = 'shopify-demo@mail.auxx.ai'
    h.cachedChannels = [
      { id: 'int_ses', email: 'shopify-demo@mail.auxx.ai', metadata: { systemManaged: true } },
    ]
    const c = ctx()

    await storeMessage(c, messageData())

    expect(h.published).toHaveLength(1)
    expect(publishedData()).toMatchObject({ fromOwnAddress: true })
    expect(publishedData().ownEcho).toBeUndefined()
    expect(c.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Publishing message:received with loop signals attached'),
      expect.objectContaining({ fromOwnAddress: true, from: 'shopify-demo@mail.auxx.ai' })
    )
  })

  it('flags fromOwnAddress when From matches an Outlook alias (metadata.emailAliases)', async () => {
    h.senderIdentifier = 'alias@outlook.example.com'
    h.cachedChannels = [
      {
        id: 'int_outlook',
        email: 'primary@outlook.example.com',
        metadata: { emailAliases: ['alias@outlook.example.com'] },
      },
    ]

    await storeMessage(ctx(), messageData())

    expect(h.published).toHaveLength(1)
    expect(publishedData()).toMatchObject({ fromOwnAddress: true })
  })

  it('flags fromOwnAddress when From matches a Gmail send-as alias (metadata.userEmails)', async () => {
    h.senderIdentifier = 'sendas@gmail.example.com'
    h.cachedChannels = [
      {
        id: 'int_google',
        email: 'primary@gmail.example.com',
        metadata: { userEmails: ['primary@gmail.example.com', 'sendas@gmail.example.com'] },
      },
    ]

    await storeMessage(ctx(), messageData())

    expect(h.published).toHaveLength(1)
    expect(publishedData()).toMatchObject({ fromOwnAddress: true })
  })

  it('matches case-insensitively', async () => {
    h.senderIdentifier = 'Shopify-Demo@Mail.Auxx.AI'
    h.cachedChannels = [{ id: 'int_ses', email: 'shopify-demo@mail.auxx.ai', metadata: null }]

    await storeMessage(ctx(), messageData())

    expect(h.published).toHaveLength(1)
    expect(publishedData()).toMatchObject({ fromOwnAddress: true })
  })

  it('flags a teammate mailing in from a personal channel — publish is never suppressed', async () => {
    h.senderIdentifier = 'alice@company.com'
    h.cachedChannels = [
      { id: 'int_support', email: 'support@company.com', metadata: null },
      { id: 'int_alice', email: 'alice@company.com', metadata: null, inboxId: 'inbox_personal' },
    ]

    await storeMessage(ctx(), messageData())

    expect(h.published).toHaveLength(1)
    expect(publishedData()).toMatchObject({ from: 'alice@company.com', fromOwnAddress: true })
  })

  it('publishes for a genuinely external sender, carrying integrationId + inboxId and no signals', async () => {
    h.senderIdentifier = 'customer@external.com'
    h.cachedChannels = [{ id: 'int_ses', email: 'shopify-demo@mail.auxx.ai', metadata: null }]

    await storeMessage(ctx(), messageData())

    expect(h.published).toHaveLength(1)
    expect(h.published[0]).toMatchObject({
      type: 'message:received',
      data: expect.objectContaining({
        from: 'customer@external.com',
        integrationId: INTEGRATION_ID,
        inboxId: INBOX_ID,
      }),
    })
    expect(publishedData().fromOwnAddress).toBeUndefined()
    expect(publishedData().ownEcho).toBeUndefined()
  })

  it('publishes unflagged when the org has no configured channels (empty own-address set)', async () => {
    h.senderIdentifier = 'customer@external.com'
    h.cachedChannels = []

    await storeMessage(ctx(), messageData())

    expect(h.published).toHaveLength(1)
    expect(publishedData().fromOwnAddress).toBeUndefined()
  })

  it('does not flag a DIFFERENT channel that merely shares no aliases with the sender', async () => {
    h.senderIdentifier = 'customer@external.com'
    h.cachedChannels = [
      {
        id: 'int_a',
        email: 'a@mail.auxx.ai',
        metadata: { emailAliases: ['alias-a@mail.auxx.ai'] },
      },
      { id: 'int_b', email: 'b@mail.auxx.ai', metadata: { userEmails: ['sendas-b@mail.auxx.ai'] } },
    ]

    await storeMessage(ctx(), messageData())

    expect(h.published).toHaveLength(1)
    expect(publishedData().fromOwnAddress).toBeUndefined()
  })
})
