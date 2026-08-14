// packages/lib/src/ingest/__tests__/store-message-echoed-message-id-guard.test.ts
//
// message-trigger-scoping plan §6 supplement — the org-scoped, suppress-only
// `X-AuxxAi-Message-Id` check at the `message:received` publish gate.
// Complementary to the own-address guard (`store-message-own-address-guard.test.ts`):
// that check catches an echo while `From` is still one of our addresses; this
// catches it when an intermediate forwarder rewrote `From` to something we
// don't recognize, but the inbound copy still carries the header we stamped
// on our own outbound send.
//
// Suppress-only: no merge, no thread grafting, no reconciliation — this is a
// plain existence check on `Message.id`, org-scoped, `sendToken IS NOT NULL`.
// Same in-memory `where`-predicate harness as
// `messages/__tests__/message-reconciler.echo.test.ts`, so a wrong predicate
// (missing org scope, missing the sendToken guard) fails here the same way it
// would against Postgres.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, any>
type Predicate = (row: Row) => boolean

/** `messages.organizationId` → `'organizationId'`, so predicates close over column names. */
const columnRefs = new Proxy({} as Record<string, string>, {
  get: (_target, key: string) => key,
})

const whereOperators = {
  eq:
    (col: string, value: unknown): Predicate =>
    (row) =>
      row[col] === value,
  and:
    (...predicates: (Predicate | undefined)[]): Predicate =>
    (row) =>
      predicates.every((predicate) => (predicate ? predicate(row) : true)),
  isNotNull:
    (col: string): Predicate =>
    (row) =>
      row[col] !== null && row[col] !== undefined,
}

function project(row: Row, columns?: Record<string, boolean>): Row {
  if (!columns) return { ...row }
  const out: Row = {}
  for (const [key, wanted] of Object.entries(columns)) {
    if (wanted) out[key] = row[key]
  }
  return out
}

function createMessageTable(rows: Row[]) {
  return {
    findFirst: vi.fn(async (args: any) => {
      const predicate: Predicate | undefined = args?.where?.(columnRefs, whereOperators)
      const matched = predicate ? rows.filter(predicate) : rows
      const first = matched[0]
      return first ? project(first, args?.columns) : undefined
    }),
  }
}

const h = vi.hoisted(() => ({
  cachedChannels: [] as Array<{ id: string; email: string | null; metadata: unknown }>,
  published: [] as Array<{ type: string; data: Record<string, unknown> }>,
  senderIdentifier: 'sender@example.com',
  threadRow: {} as Record<string, unknown>,
  /** Rows the fake `Message` table exposes to `ctx.db.query.Message.findFirst`. */
  messageRows: [] as Row[],
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
    isNotNull: passthrough,
    sql: Object.assign(passthrough, { raw: passthrough }),
  }
})

import { storeMessage } from '../store-message'

const ORG = 'org_1'
const OTHER_ORG = 'org_2'
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
  const messageTable = createMessageTable(h.messageRows)
  return {
    organizationId: ORG,
    db: {
      select: () => emptyChain(),
      update: () => emptyChain(),
      transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx()),
      query: {
        SequenceRun: { findFirst: async () => null },
        Message: messageTable,
      },
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
  h.senderIdentifier = 'forwarder@thirdparty.example.com'
  h.messageRows = []
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
 * `ownEcho` is the HARD loop signal: the header resolved to a row this org
 * actually sent, so the message is a literal copy of our own outbound mail.
 * The publish still happens (timeline, filters, bounce ingest and signals all
 * describe the message as it exists) — the dispatcher and mail classification
 * are what skip on the flag.
 */
describe('storeMessage — X-AuxxAi-Message-Id echo signal', () => {
  const publishedData = () => (h.published[0] as any)?.data

  it('flags ownEcho when the header resolves to a sent message in this org', async () => {
    h.messageRows = [{ id: 'm_sent_1', organizationId: ORG, sendToken: 'tok_1' }]

    await storeMessage(ctx(), messageData({ echoedMessageId: 'm_sent_1' }))

    expect(h.published).toHaveLength(1)
    expect(publishedData()).toMatchObject({ ownEcho: { sentMessageId: 'm_sent_1' } })
  })

  it('logs the signal with the resolved sent-message id', async () => {
    h.messageRows = [{ id: 'm_sent_1', organizationId: ORG, sendToken: 'tok_1' }]
    const c = ctx()

    await storeMessage(c, messageData({ echoedMessageId: 'm_sent_1' }))

    expect(c.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('loop signals attached'),
      expect.objectContaining({ echoedMessageId: 'm_sent_1', sentMessageId: 'm_sent_1' })
    )
  })

  it('does NOT flag when the header is absent', async () => {
    h.messageRows = [{ id: 'm_sent_1', organizationId: ORG, sendToken: 'tok_1' }]

    await storeMessage(ctx(), messageData())

    expect(h.published).toHaveLength(1)
    expect(publishedData().ownEcho).toBeUndefined()
  })

  it('does NOT flag when the id is unknown (no matching row)', async () => {
    h.messageRows = [{ id: 'm_sent_1', organizationId: ORG, sendToken: 'tok_1' }]

    await storeMessage(ctx(), messageData({ echoedMessageId: 'm_unknown' }))

    expect(h.published).toHaveLength(1)
    expect(publishedData().ownEcho).toBeUndefined()
  })

  it('does NOT flag a match belonging to a different org', async () => {
    h.messageRows = [{ id: 'm_sent_1', organizationId: OTHER_ORG, sendToken: 'tok_1' }]

    await storeMessage(ctx(), messageData({ echoedMessageId: 'm_sent_1' }))

    expect(h.published).toHaveLength(1)
    expect(publishedData().ownEcho).toBeUndefined()
  })

  it('does NOT flag when sendToken is null (not a message we sent)', async () => {
    h.messageRows = [{ id: 'm_sent_1', organizationId: ORG, sendToken: null }]

    await storeMessage(ctx(), messageData({ echoedMessageId: 'm_sent_1' }))

    expect(h.published).toHaveLength(1)
    expect(publishedData().ownEcho).toBeUndefined()
  })

  it('carries both signals when the sender is also one of our addresses', async () => {
    h.senderIdentifier = 'shopify-demo@mail.auxx.ai'
    h.cachedChannels = [
      { id: 'int_ses', email: 'shopify-demo@mail.auxx.ai', metadata: { systemManaged: true } },
    ]
    h.messageRows = [{ id: 'm_sent_1', organizationId: ORG, sendToken: 'tok_1' }]
    const c = ctx()

    await storeMessage(c, messageData({ echoedMessageId: 'm_sent_1' }))

    expect(h.published).toHaveLength(1)
    expect(publishedData()).toMatchObject({
      fromOwnAddress: true,
      ownEcho: { sentMessageId: 'm_sent_1' },
    })
    // The two signals are independent now — an own-address sender no longer
    // short-circuits the header lookup, because each drives a different gate.
    expect(c.db.query.Message.findFirst).toHaveBeenCalled()
  })

  it('publishes unflagged for a genuinely external sender carrying no header at all', async () => {
    await storeMessage(ctx(), messageData())

    expect(h.published).toHaveLength(1)
    expect(publishedData().ownEcho).toBeUndefined()
    expect(publishedData().fromOwnAddress).toBeUndefined()
  })
})
