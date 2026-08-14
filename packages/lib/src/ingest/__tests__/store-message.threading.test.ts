// packages/lib/src/ingest/__tests__/store-message.threading.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Thread-splitting plan §Testing — the production regression, end to end through
 * `storeMessage` with a real (in-memory) Thread / Message / ThreadExternalKey
 * store and the real `resolveThreadId`.
 *
 * Observed in prod: one Outlook conversation, two threads, because Exchange gave
 * the inbound reply a `conversationId` different from the one it gave the
 * message we had sent. The reply's `In-Reply-To` was byte-identical to the sent
 * message's `internetMessageId` — the link was on the wire and we ignored it.
 *
 * The third message is the reason the alias table exists: it arrives under the
 * *forked* conversation key with no usable headers of its own, and must still
 * land on the merged thread.
 */

const h = vi.hoisted(() => ({
  store: {} as Record<string, Array<Record<string, any>>>,
  seq: 0,
  /** Table whose INSERT should blow up, standing in for a table the migration has not created yet. */
  failInsertOn: null as string | null,
}))

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  const table = (name: string) =>
    new Proxy({}, { get: (_t, key) => `${name}.${String(key)}` }) as Record<string, unknown>
  const pinned = [
    'Thread',
    'Message',
    'ThreadExternalKey',
    'Integration',
    'InboxIntegration',
    'MessageParticipant',
    'ThreadParticipant',
    'ThreadReadStatus',
  ]
  return {
    database: createChainableDatabaseMock(),
    schema: createSchemaMock(Object.fromEntries(pinned.map((n) => [n, table(n)]))),
  }
})

// Partial mock — replacing `drizzle-orm` wholesale dies at COLLECTION time once
// `store-message`'s import graph grows. Only the predicate builders are swapped.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    and: (...conds: unknown[]) => ({ op: 'and', conds: conds.filter(Boolean) }),
    eq: (col: unknown, value: unknown) => ({ op: 'eq', col, value }),
    isNull: (col: unknown) => ({ op: 'isNull', col }),
    inArray: (col: unknown, values: unknown[]) => ({ op: 'inArray', col, values }),
  }
})

vi.mock('../inbox-meta', () => ({ isPersonalInbox: async () => false }))
vi.mock('../../inbox-record-ids', () => ({ toInboxRecordId: async () => 'inbox:i_1' }))
// Own-address loop guard (message-trigger-scoping plan §6 #1) reads the
// `channels` org cache at the publish gate. No channels configured here means
// no address is ever "our own", matching every test in this file's intent —
// they're all about thread resolution, not the loop guard.
vi.mock('../../cache', () => ({ getOrgCache: () => ({ get: async () => [] }) }))
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
vi.mock('../../events/publisher', () => ({ publisher: { publishLater: vi.fn() } }))
vi.mock('../../permissions/visibility/audience', () => ({
  getFullLensAudienceForInbox: async () => [],
}))
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
    identifier: 'sender@example.com',
    name: 'Sender',
    entityInstanceId: null,
    isInternal: false,
  }),
}))

// NOT mocked, deliberately: `../threads/resolve-thread` is the unit under test.
import { storeMessage } from '../store-message'

const ORG = 'org_1'
const OUTLOOK = 'int_outlook'
const GOOGLE = 'int_google'
const INBOX = 'i_1'

/** `'Message.organizationId'` → `'organizationId'`. */
const field = (col: unknown) => String(col).split('.').slice(1).join('.')
const tableOf = (t: any) => String(t?.id ?? '').split('.')[0] ?? ''

function matches(row: Record<string, any>, pred: any): boolean {
  if (!pred || typeof pred !== 'object') return true
  switch (pred.op) {
    case 'and':
      return pred.conds.every((c: unknown) => matches(row, c))
    case 'eq':
      return row[field(pred.col)] === pred.value
    case 'isNull':
      return row[field(pred.col)] == null
    case 'inArray':
      return pred.values.includes(row[field(pred.col)])
    default:
      return true
  }
}

const rows = (name: string) => (h.store[name] ??= [])

/** Unique keys the real schema enforces, for the `ON CONFLICT` emulation. */
const CONFLICT_KEYS: Record<string, string[]> = {
  Thread: ['integrationId', 'externalId'],
  Message: ['integrationId', 'externalId'],
  ThreadExternalKey: ['integrationId', 'externalId'],
  MessageParticipant: ['messageId', 'participantId', 'role'],
  ThreadParticipant: ['threadId', 'email'],
}

function selectChain() {
  let table = ''
  let pred: unknown = null
  let lim: number | undefined
  const chain: any = {
    from(t: any) {
      table = tableOf(t)
      return chain
    },
    where(p: unknown) {
      pred = p
      return chain
    },
    limit(n: number) {
      lim = n
      return chain
    },
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      const all = rows(table).filter((r) => matches(r, pred))
      return Promise.resolve(lim === undefined ? all : all.slice(0, lim)).then(resolve, reject)
    },
  }
  return chain
}

function insertChain(table: string) {
  let values: Array<Record<string, any>> = []
  let mode: 'throw' | 'nothing' | 'update' = 'throw'
  let target = CONFLICT_KEYS[table] ?? []
  let updateSet: Record<string, unknown> = {}

  const run = () => {
    if (h.failInsertOn === table) {
      throw new Error(`relation "${table}" does not exist`)
    }
    const out: Array<Record<string, any>> = []
    for (const value of values) {
      const existing = target.length
        ? rows(table).find((r) => target.every((c) => value[c] !== undefined && r[c] === value[c]))
        : undefined
      if (existing) {
        if (mode === 'update') {
          for (const [k, v] of Object.entries(updateSet)) {
            if (v !== undefined && typeof v !== 'object') existing[k] = v
          }
          out.push(existing)
        }
        continue
      }
      const row = { id: `${table}_${++h.seq}`, ...value }
      rows(table).push(row)
      out.push(row)
    }
    return out
  }

  const chain: any = {
    values(v: any) {
      values = Array.isArray(v) ? v : [v]
      return chain
    },
    onConflictDoNothing() {
      mode = 'nothing'
      return chain
    },
    onConflictDoUpdate(cfg: any) {
      mode = 'update'
      if (cfg?.target) target = cfg.target.map(field)
      updateSet = cfg?.set ?? {}
      return chain
    },
    returning() {
      return chain
    },
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(resolve, reject)
    },
  }
  return chain
}

function updateChain(table: string) {
  let assigned: Record<string, unknown> = {}
  let pred: unknown = null
  const chain: any = {
    set(s: Record<string, unknown>) {
      assigned = s
      return chain
    },
    where(p: unknown) {
      pred = p
      return chain
    },
    returning() {
      return chain
    },
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      const hit = rows(table).filter((r) => matches(r, pred))
      for (const row of hit) {
        for (const [k, v] of Object.entries(assigned)) {
          if (v !== undefined && typeof v !== 'object') row[k] = v
        }
      }
      return Promise.resolve(hit).then(resolve, reject)
    },
  }
  return chain
}

const db: any = {
  select: () => selectChain(),
  insert: (t: any) => insertChain(tableOf(t)),
  update: (t: any) => updateChain(tableOf(t)),
  transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
  query: { SequenceRun: { findFirst: async () => null } },
}

function ctx() {
  return {
    organizationId: ORG,
    db,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    systemUserId: 'sys',
    crudHandler: {},
    reconciler: {},
    threadManager: {},
    selectiveCache: {},
    integrationSettings: {},
    isInitialSync: false,
    ownEmails: new Set<string>(),
    inSyncBatch: false,
    touchedInboxIds: new Set<string | null>(),
    companyIdByDomain: new Map(),
    ownDomainsByOrg: new Map(),
    providerByIntegrationId: new Map(),
  } as any
}

let clock = 0
function messageData(overrides: Record<string, unknown> = {}) {
  const at = new Date(Date.UTC(2026, 6, 29, 10, ++clock))
  return {
    organizationId: ORG,
    integrationId: OUTLOOK,
    externalId: `ext_${clock}`,
    externalThreadId: 'convA',
    inboxId: INBOX,
    subject: 'Hello',
    isInbound: true,
    sentAt: at,
    receivedAt: at,
    createdTime: at,
    hasAttachments: false,
    from: { identifier: 'sender@example.com', name: 'Sender' },
    to: [{ identifier: 'dest@example.com' }],
    ...overrides,
  } as any
}

const messages = () => rows('Message')
const aliasKeysFor = (threadId: string) =>
  rows('ThreadExternalKey')
    .filter((r) => r.threadId === threadId)
    .map((r) => r.externalId)
    .sort()

beforeEach(() => {
  h.failInsertOn = null
  h.store = {
    Integration: [
      { id: OUTLOOK, provider: 'outlook', deletedAt: null, metadata: {} },
      { id: GOOGLE, provider: 'google', deletedAt: null, metadata: {} },
    ],
  }
  h.seq = 0
  clock = 0
})

describe('storeMessage — Outlook conversationId fork (thread-splitting plan)', () => {
  it('keeps a send → reply round-trip on ONE thread and aliases both keys', async () => {
    const c = ctx()

    // 1. The outbound "Hello" we sent, under Exchange conversation A.
    await storeMessage(
      c,
      messageData({
        externalThreadId: 'convA',
        internetMessageId: '<m1@auxx>',
        isInbound: false,
      })
    )

    // 2. The inbound reply. Exchange minted a NEW conversationId — today's
    //    `(integrationId, externalId)` upsert would fork a second thread — but
    //    In-Reply-To points straight at the message we just stored.
    await storeMessage(
      c,
      messageData({
        externalThreadId: 'convB',
        internetMessageId: '<m2@ext>',
        inReplyTo: '<m1@auxx>',
        subject: 'Re: Hello',
      })
    )

    expect(rows('Thread')).toHaveLength(1)
    const threadId = rows('Thread')[0]?.id
    expect(messages().map((m) => m.threadId)).toEqual([threadId, threadId])

    // 3. Both provider conversation keys are now aliased to that one thread.
    expect(aliasKeysFor(threadId)).toEqual(['convA', 'convB'])

    // 4. A third message under the FORKED key with no usable headers of its own.
    //    This is the case the alias table exists for.
    await storeMessage(
      c,
      messageData({
        externalThreadId: 'convB',
        internetMessageId: '<m3@ext>',
        subject: 'Re: Hello',
      })
    )

    expect(rows('Thread')).toHaveLength(1)
    expect(messages()).toHaveLength(3)
    expect(messages().every((m) => m.threadId === threadId)).toBe(true)
  })

  it('marks only the first message isFirstInThread', async () => {
    const c = ctx()
    await storeMessage(
      c,
      messageData({ externalThreadId: 'convA', internetMessageId: '<m1@auxx>', isInbound: false })
    )
    await storeMessage(
      c,
      messageData({
        externalThreadId: 'convB',
        internetMessageId: '<m2@ext>',
        inReplyTo: '<m1@auxx>',
      })
    )

    expect(messages().map((m) => m.isFirstInThread)).toEqual([true, false])
  })

  it('still forks when the reply carries no resolvable parent (today’s behaviour)', async () => {
    const c = ctx()
    await storeMessage(
      c,
      messageData({ externalThreadId: 'convA', internetMessageId: '<m1@auxx>', isInbound: false })
    )
    await storeMessage(c, messageData({ externalThreadId: 'convB', internetMessageId: '<m2@ext>' }))

    expect(rows('Thread')).toHaveLength(2)
  })

  it('records an alias for a plain single-conversation thread too', async () => {
    const c = ctx()
    await storeMessage(c, messageData({ internetMessageId: '<only@x>' }))

    const threadId = rows('Thread')[0]?.id
    expect(aliasKeysFor(threadId)).toEqual(['convA'])
  })

  // Regression: this exact failure took down ingest for EVERY provider in dev when
  // the code ran before migration 0323 created the table. The alias write used to
  // live inside the write transaction, and Postgres aborts the whole transaction on
  // any statement error — so the message was rolled back too. A missing alias must
  // cost us thread merging, never the message.
  it('still stores the message when the alias write fails', async () => {
    const c = ctx()
    h.failInsertOn = 'ThreadExternalKey'

    await expect(
      storeMessage(c, messageData({ internetMessageId: '<survives@x>' }))
    ).resolves.toBeDefined()

    expect(messages()).toHaveLength(1)
    expect(rows('Thread')).toHaveLength(1)
    expect(rows('ThreadExternalKey')).toHaveLength(0)
    expect(c.logger.error).toHaveBeenCalled()
  })

  it('falls back to the conversation key when the alias table is unreadable', async () => {
    const c = ctx()
    h.failInsertOn = 'ThreadExternalKey'

    await storeMessage(c, messageData({ internetMessageId: '<a@x>' }))
    await storeMessage(
      c,
      messageData({ externalThreadId: 'convA', internetMessageId: '<b@x>', isInbound: true })
    )

    // Both still land on one thread via the unchanged `(integrationId, externalId)`
    // upsert — i.e. exactly the behaviour that shipped before the alias table.
    expect(rows('Thread')).toHaveLength(1)
    expect(messages()).toHaveLength(2)
  })
})

describe('storeMessage — Gmail guard', () => {
  it('does NOT merge a google message whose In-Reply-To matches another thread', async () => {
    const c = ctx()

    await storeMessage(
      c,
      messageData({
        integrationId: GOOGLE,
        externalThreadId: 'gthread_1',
        internetMessageId: '<m1@auxx>',
        isInbound: false,
      })
    )
    await storeMessage(
      c,
      messageData({
        integrationId: GOOGLE,
        // Gmail splits long conversations on purpose and re-uses References
        // across the halves — this second threadId is deliberate, not a fork.
        externalThreadId: 'gthread_2',
        internetMessageId: '<m2@ext>',
        inReplyTo: '<m1@auxx>',
      })
    )

    expect(rows('Thread')).toHaveLength(2)
    const [first, second] = messages()
    expect(first?.threadId).not.toBe(second?.threadId)
  })
})
