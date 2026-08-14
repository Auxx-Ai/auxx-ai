// packages/lib/src/ingest/__tests__/store-message-inbox-recordid.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40a §5.1 — the ingest realtime publish, the hottest RecordId minting
 * site in the system.
 *
 * `thread:created` carries `inboxRecordId`, which the FE uses to route the new
 * thread to an inbox. It was minted as `toRecordId('inbox', …)`, so every
 * message landing in a personal mailbox would publish a RecordId whose
 * definition no longer owns the instance once data migration 060 runs.
 */

const h = vi.hoisted(() => ({
  cachedInboxes: [] as Array<{ id: string; entityDefinitionKey?: string; isPersonal?: boolean }>,
  personalInbox: false,
  published: [] as Array<{ threadId: string; inboxRecordId?: string | null }>,
  /** Rows the `InboxIntegration` lookup returns (unused — inboxId is supplied). */
  threadRow: {} as Record<string, unknown>,
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: async () => h.cachedInboxes }),
}))

vi.mock('../inbox-meta', () => ({
  // DELIBERATELY decoupled from the def: the marker and the definition disagree
  // for the whole 059 → 060 window, and the RecordId must follow the DEFINITION.
  isPersonalInbox: async () => h.personalInbox,
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishThreadCreated: vi.fn(async (_svc: unknown, _org: string, args: any) => {
    h.published.push({ threadId: args.threadId, inboxRecordId: args.inboxRecordId })
  }),
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
const SENT_AT = new Date('2026-07-29T10:00:00.000Z')

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

/** Transaction double: insert/update chains resolve to the rows we stage. */
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
          if (prop === 'then') {
            return (res: (v: unknown[]) => unknown) => Promise.resolve(res([]))
          }
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

function messageData(inboxId: string) {
  return {
    organizationId: ORG,
    integrationId: 'int_1',
    externalId: 'ext_1',
    externalThreadId: 'extthread_1',
    inboxId,
    subject: 'Hello',
    isInbound: true,
    sentAt: SENT_AT,
    receivedAt: SENT_AT,
    createdTime: SENT_AT,
    hasAttachments: false,
    from: { identifier: 'sender@example.com', name: 'Sender' },
    to: [{ identifier: 'dest@example.com' }],
  } as any
}

beforeEach(() => {
  h.cachedInboxes = []
  h.personalInbox = false
  h.published = []
  h.threadRow = {
    id: 't_1',
    inboxId: null,
    status: 'OPEN',
    assigneeId: null,
    messageCount: 1,
    firstMessageAt: SENT_AT,
    lastMessageAt: SENT_AT,
    participantCount: 1,
  }
})

describe('storeMessage thread:created publish — inbox definition (plan 40a §5.1)', () => {
  it('publishes `personal_inbox:` for a mailbox on the personal definition', async () => {
    h.cachedInboxes = [{ id: 'i_personal', entityDefinitionKey: 'personal_inbox' }]
    h.personalInbox = true
    h.threadRow.inboxId = 'i_personal'

    await storeMessage(ctx(), messageData('i_personal'))

    expect(h.published).toEqual([{ threadId: 't_1', inboxRecordId: 'personal_inbox:i_personal' }])
  })

  it('publishes `inbox:` for a shared mailbox (negative control)', async () => {
    h.cachedInboxes = [{ id: 'i_shared', entityDefinitionKey: 'inbox' }]
    h.threadRow.inboxId = 'i_shared'

    await storeMessage(ctx(), messageData('i_shared'))

    expect(h.published).toEqual([{ threadId: 't_1', inboxRecordId: 'inbox:i_shared' }])
  })

  it('follows the definition, not the `isPersonal` marker (059 → 060 window)', async () => {
    // The marker says personal (so Gmail-parity status derivation kicks in) but
    // the instance has not moved defs, and its grant rows are still `'inbox'`.
    h.cachedInboxes = [{ id: 'i_legacy', entityDefinitionKey: 'inbox', isPersonal: true }]
    h.personalInbox = true
    h.threadRow.inboxId = 'i_legacy'

    await storeMessage(ctx(), messageData('i_legacy'))

    expect(h.published).toEqual([{ threadId: 't_1', inboxRecordId: 'inbox:i_legacy' }])
  })

  it('publishes nothing during a sync batch (the hot path pays no cache read)', async () => {
    h.cachedInboxes = [{ id: 'i_personal', entityDefinitionKey: 'personal_inbox' }]
    h.threadRow.inboxId = 'i_personal'

    const c = ctx()
    c.inSyncBatch = true
    await storeMessage(c, messageData('i_personal'))

    expect(h.published).toEqual([])
    expect([...c.touchedInboxIds]).toEqual(['i_personal'])
  })
})
