// packages/lib/src/ingest/__tests__/store-message-backfill-cutoff.test.ts
//
// webhook-push-migration plan Phase 2.5 — the received-time backfill cutoff.
// While `ctx.backfillCutoffAt` is set (a provider found `metadata.backfillCutoffAt`
// stamped and `metadata.initialBackfillCompletedAt` unset), `message:received` must
// not publish for messages whose `receivedAt` is before the cutoff — regardless of
// which sync walker ingested them — but the message itself must still be stored.
// Once `ctx.backfillCutoffAt` is null (no active backfill window), publishing is
// unchanged.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cachedChannels: [] as Array<{
    id: string
    email: string | null
    metadata: unknown
    inboxId?: string | null
  }>,
  published: [] as Array<{ type: string; data: Record<string, unknown> }>,
  senderIdentifier: 'customer@external.com',
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
vi.mock('../../entity-instances/activity', () => ({
  touchActivityForThreadLinks: vi.fn(),
  resolveThreadLinkedEntityIds: vi.fn(async () => []),
  touchEntityActivity: vi.fn(),
  touchInteractionForMessage: vi.fn(),
}))
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
const CUTOFF = new Date('2026-08-13T00:00:00.000Z')
const BEFORE_CUTOFF = new Date('2026-08-12T10:00:00.000Z')
const AFTER_CUTOFF = new Date('2026-08-13T10:00:00.000Z')

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

function ctx(backfillCutoffAt: Date | null = null) {
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
    backfillCutoffAt,
    ownEmails: new Set<string>(),
    inSyncBatch: false,
    touchedInboxIds: new Set<string | null>(),
    companyIdByDomain: new Map(),
    ownDomainsByOrg: new Map(),
    providerByIntegrationId: new Map(),
  } as any
}

function messageData(receivedAt: Date, overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    integrationId: INTEGRATION_ID,
    externalId: 'ext_1',
    externalThreadId: 'extthread_1',
    inboxId: INBOX_ID,
    subject: 'Hello',
    isInbound: true,
    sentAt: receivedAt,
    receivedAt,
    createdTime: receivedAt,
    hasAttachments: false,
    from: { identifier: h.senderIdentifier, name: 'Sender' },
    to: [{ identifier: 'dest@example.com' }],
    ...overrides,
  } as any
}

beforeEach(() => {
  h.cachedChannels = []
  h.published = []
  h.senderIdentifier = 'customer@external.com'
  h.threadRow = {
    id: 't_1',
    inboxId: INBOX_ID,
    status: 'OPEN',
    assigneeId: null,
    messageCount: 1,
    firstMessageAt: BEFORE_CUTOFF,
    lastMessageAt: BEFORE_CUTOFF,
    participantCount: 1,
  }
})

describe('storeMessage — backfill-cutoff suppression on message:received', () => {
  it('suppresses the publish for a message received before an active cutoff, but still stores it', async () => {
    const result = await storeMessage(ctx(CUTOFF), messageData(BEFORE_CUTOFF))

    expect(result.isNew).toBe(true)
    expect(result.messageId).toBe('m_1')
    expect(h.published).toHaveLength(0)
  })

  it('publishes for a message received after the cutoff', async () => {
    const result = await storeMessage(ctx(CUTOFF), messageData(AFTER_CUTOFF))

    expect(result.isNew).toBe(true)
    expect(h.published).toHaveLength(1)
    expect(h.published[0]).toMatchObject({ type: 'message:received' })
  })

  it('publishes unchanged when there is no active cutoff (ctx.backfillCutoffAt is null)', async () => {
    const result = await storeMessage(ctx(null), messageData(BEFORE_CUTOFF))

    expect(result.isNew).toBe(true)
    expect(h.published).toHaveLength(1)
    expect(h.published[0]).toMatchObject({ type: 'message:received' })
  })
})
