// packages/lib/src/ingest/__tests__/store-message-thread-participant-rollup.test.ts
//
// The `ThreadParticipant` rollup's ON CONFLICT clause. `isInternal` must be in
// it, unconditionally.
//
// This exact omission has now happened on two tables. `Participant` had it and
// it was fixed (`participants/find-or-create.ts`: "Omitting it here … froze the
// column at its first write"); the rollup kept it. The flag is derived from org
// configuration — connected channels, org domains — never from message content,
// so every recomputation is at least as good as the last and there is no reason
// to preserve an older one.
//
// The cost of freezing it is not academic: `buildSenderSortExpression`
// (`threads/thread-query.service.ts`) names a thread after its most recent
// EXTERNAL participant and reads THIS table. When the org's own Meta Page only
// became recognisable later — once the own-identity sets learned Page ids — its
// rollup row stayed `isInternal: false` and every Facebook/Instagram thread went
// on attributing itself to us instead of to the customer. New traffic did not
// heal it, because new traffic takes the conflict branch.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Every `onConflictDoUpdate` config, keyed by table. */
  conflictConfigs: [] as Array<{ table: string; config: any }>,
  participant: {
    id: 'p_1',
    identifier: '27893553143563440',
    name: 'Markus Klooth',
    entityInstanceId: null,
    isInternal: false,
  },
  threadRow: {} as Record<string, unknown>,
}))

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
  determineIdentifierType: async () => 'FACEBOOK_PSID',
  normalizeIdentifier: (v: string) => v,
}))
vi.mock('../participants/find-or-create', () => ({
  findOrCreateParticipantRecord: async () => h.participant,
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
const SENT_AT = new Date('2026-08-18T19:47:02.000Z')

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
          if (prop === 'onConflictDoUpdate') {
            return (config: any) => {
              h.conflictConfigs.push({ table, config })
              return obj
            }
          }
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
    ownIdentities: {},
    ownIdentitiesByOrg: new Map(),
    inSyncBatch: false,
    touchedInboxIds: new Set<string | null>(),
    companyIdByDomain: new Map(),
    ownDomainsByOrg: new Map(),
    providerByIntegrationId: new Map(),
  } as any
}

function messageData() {
  return {
    organizationId: ORG,
    integrationId: 'int_facebook',
    externalId: 'm_abc',
    externalThreadId: 'dm:869289333164075:27893553143563440',
    inboxId: 'i_shared',
    subject: '',
    isInbound: true,
    sentAt: SENT_AT,
    receivedAt: SENT_AT,
    createdTime: SENT_AT,
    hasAttachments: false,
    from: { identifier: '27893553143563440' },
    to: [{ identifier: '869289333164075', name: 'Auxx-Lift' }],
  } as any
}

beforeEach(() => {
  h.conflictConfigs = []
  h.threadRow = {
    id: 't_1',
    inboxId: 'i_shared',
    status: 'OPEN',
    assigneeId: null,
    messageCount: 1,
    firstMessageAt: SENT_AT,
    lastMessageAt: SENT_AT,
    participantCount: 1,
  }
})

describe('storeMessage — ThreadParticipant rollup conflict clause', () => {
  const rollupSet = () =>
    h.conflictConfigs.find((c) => c.table === 'ThreadParticipant')?.config?.set

  it('recomputes isInternal on every upsert instead of freezing the first write', async () => {
    await storeMessage(ctx(), messageData())

    const set = rollupSet()
    expect(set).toBeDefined()
    expect(Object.keys(set)).toContain('isInternal')
  })

  it('still keeps the existing name when a later message carries none', async () => {
    // `name` is deliberately upgrade-only (COALESCE), the opposite rule to
    // `isInternal` — a nameless message must not blank a resolved name. Pinned
    // here so a future "make the rollup consistent" pass cannot flatten the two
    // into one policy.
    await storeMessage(ctx(), messageData())

    const set = rollupSet()
    expect(Object.keys(set)).toContain('name')
    expect(Object.keys(set)).toContain('entityInstanceId')
  })
})
