// packages/lib/src/ingest/__tests__/store-message.social-alias.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * FB/IG runtime-fixes plan WS1b — the alias net on the reconcile path.
 *
 * Facebook and Instagram have no rung 2: `resolveThreadId` gates its RFC 5322
 * parentage fallback to `outlook`/`imap`, so if the alias lookup misses, the
 * thread forks with nothing to catch it.
 *
 * The pair key `dm:{pageId}:{counterpartId}` is only correct if the participant
 * ids the REST `/conversations` edge returns are the same PSIDs the webhook puts
 * in `sender.id` — unverified against live data. If they ever diverge, the two
 * doors compute two different keys for one conversation. What saves it is message
 * identity: both doors carry the same `mid`, so `reconcileMessage` dedupes on
 * `(integrationId, externalId)`, and recording the second door's key as an alias
 * at that moment binds the conversation back together for every later message.
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
// The real `reconcileMessage` falls back to an `(integrationId, externalId)`
// lookup — that is the arm this test exercises, so it is emulated rather than
// stubbed to null.
vi.mock('../reconciliation/reconcile-message', () => ({
  reconcileMessage: async (_ctx: unknown, messageData: any) =>
    (h.store.Message ?? []).find(
      (m: any) =>
        m.integrationId === messageData.integrationId && m.externalId === messageData.externalId
    ) ?? null,
}))
vi.mock('../threads/update-metadata', () => ({ updateThreadMetadataEfficient: vi.fn() }))
vi.mock('../participants/normalize', () => ({
  determineIdentifierType: async () => 'SOCIAL',
  normalizeIdentifier: (v: string) => v.toLowerCase(),
}))
vi.mock('../participants/find-or-create', () => ({
  findOrCreateParticipantRecord: async () => ({
    id: 'p_1',
    identifier: 'psid',
    name: undefined,
    entityInstanceId: null,
    isInternal: false,
  }),
}))

// NOT mocked, deliberately: `../threads/resolve-thread` is the unit under test.
import { socialThreadKey } from '../../providers/social/thread-key'
import { storeMessage } from '../store-message'

const ORG = 'org_1'
const FACEBOOK = 'int_facebook'
const PAGE = '869289333164075'
const PSID = '2495701234567890'
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
    ownIdentities: {},
    ownIdentitiesByOrg: new Map(),
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
    integrationId: FACEBOOK,
    externalId: `ext_${clock}`,
    externalThreadId: socialThreadKey(PAGE, PSID),
    inboxId: INBOX,
    subject: undefined,
    isInbound: true,
    sentAt: at,
    receivedAt: at,
    createdTime: at,
    hasAttachments: false,
    from: { identifier: PSID },
    to: [{ identifier: PAGE }],
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
    Integration: [{ id: FACEBOOK, provider: 'facebook', deletedAt: null, metadata: {} }],
  }
  h.seq = 0
  clock = 0
})

describe('storeMessage — WS1b alias net for providers with no header chain', () => {
  it('binds a second conversation key to the existing thread when the mid already exists', async () => {
    const c = ctx()
    const webhookKey = socialThreadKey(PAGE, PSID)
    // What sync would compute if `/conversations` returned a different id space
    // for the same human than the webhook does.
    const syncKey = socialThreadKey(PAGE, 'other_id_space_9999')

    // Door 1 — the webhook.
    await storeMessage(c, messageData({ externalId: 'm_1', externalThreadId: webhookKey }))
    expect(rows('Thread')).toHaveLength(1)
    const threadId = rows('Thread')[0]?.id

    // Door 2 — the REST sync re-delivering the SAME message under a key that
    // disagrees. Without WS1b this returns early and records nothing.
    await storeMessage(c, messageData({ externalId: 'm_1', externalThreadId: syncKey }))

    expect(rows('Thread')).toHaveLength(1)
    expect(messages()).toHaveLength(1)
    expect(aliasKeysFor(threadId)).toEqual([syncKey, webhookKey].sort())
  })

  it('routes a LATER message under the disagreeing key onto the same thread', async () => {
    // The point of recording the alias: rung 1 now answers for the key that was
    // never the thread's canonical `externalId`.
    const c = ctx()
    const webhookKey = socialThreadKey(PAGE, PSID)
    const syncKey = socialThreadKey(PAGE, 'other_id_space_9999')

    await storeMessage(c, messageData({ externalId: 'm_1', externalThreadId: webhookKey }))
    const threadId = rows('Thread')[0]?.id
    await storeMessage(c, messageData({ externalId: 'm_1', externalThreadId: syncKey }))

    // A message the webhook never saw, arriving only through sync.
    await storeMessage(c, messageData({ externalId: 'm_2', externalThreadId: syncKey }))

    expect(rows('Thread')).toHaveLength(1)
    expect(messages()).toHaveLength(2)
    expect(messages().every((m) => m.threadId === threadId)).toBe(true)
  })

  it('does not fail ingest when the alias write blows up', async () => {
    const c = ctx()
    const webhookKey = socialThreadKey(PAGE, PSID)
    await storeMessage(c, messageData({ externalId: 'm_1', externalThreadId: webhookKey }))

    h.failInsertOn = 'ThreadExternalKey'
    const result = await storeMessage(
      c,
      messageData({ externalId: 'm_1', externalThreadId: socialThreadKey(PAGE, 'zzz') })
    )

    expect(result?.isNew).toBe(false)
    expect(messages()).toHaveLength(1)
  })
})
