// packages/lib/src/providers/social/__tests__/sync.test.ts
//
// Covers the four things the FB/IG backfill can get silently and expensively wrong:
//   1. The conversation CAP must terminate enumeration as a prefix — the page holds
//      500+ conversations back to 2021 and the old walk read all of them every run.
//   2. Incremental must STOP at the first conversation older than `since` instead of
//      paginating to the end of history.
//   3. `initialBackfillCompletedAt` must be stamped, or the received-time suppression
//      window never closes and live inbound stops firing triggers forever.
//   4. A channel with no `backfillCutoffAt` must fail CLOSED — the live dev channel is
//      exactly that channel, and failing open publishes five years of history into
//      workflow triggers and agent runs.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { socialThreadKey } from '../thread-key'

const mocks = vi.hoisted(() => {
  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
  const update = vi.fn().mockReturnValue({ set: updateSet })
  return {
    update,
    updateSet,
    updateWhere,
    listConversations: vi.fn(),
    listConversationMessages: vi.fn(),
  }
})

// Partial mock: the chainable proxy still backs every builder the module graph touches
// at import time; only `update` is pinned to a spy so the jsonb-merge writes are
// assertable.
vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import(
    '../../../test/database-mock'
  )
  const database = new Proxy(createChainableDatabaseMock(), {
    get: (target: any, prop: string) => (prop === 'update' ? mocks.update : target[prop]),
  })
  return {
    database,
    schema: createSchemaMock({
      Integration: { id: 'Integration.id', metadata: 'Integration.metadata' },
    }),
  }
})

vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// The Graph seam is the only network surface; stubbing it exercises every request shape
// the walker builds without leaving the process.
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listConversations: mocks.listConversations,
  listConversationMessages: mocks.listConversationMessages,
}))

const { resolveSocialBackfillCutoff, syncSocialMessages } = await import('../sync')

const PAGE_ID = '869289333164075'
const IGBID = '17841400000000000'

function target(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'facebook' as const,
    graphPlatform: 'messenger' as const,
    pageId: PAGE_ID,
    ourId: PAGE_ID,
    ourName: 'Auxx-Lift',
    pageAccessToken: 'page_token',
    integrationId: 'int_1',
    organizationId: 'org_1',
    ...overrides,
  }
}

function storage() {
  return {
    batchStoreMessages: vi.fn().mockResolvedValue(1),
    setBackfillCutoff: vi.fn(),
  }
}

/** A conversation node with one counterpart, `n` positions from the top. */
function conversation(
  id: string,
  updatedTime: string,
  counterpartId = `psid_${id}`,
  ourParticipantId = PAGE_ID
) {
  return {
    id,
    updated_time: updatedTime,
    participants: {
      data: [
        { id: ourParticipantId, name: 'Auxx-Lift' },
        { id: counterpartId, name: 'Jane' },
      ],
    },
  }
}

function messageNode(id: string, counterpartId: string, createdTime = '2026-08-18T09:00:00+0000') {
  return {
    id,
    created_time: createdTime,
    from: { id: counterpartId, name: 'Jane' },
    to: { data: [{ id: PAGE_ID }] },
    message: 'hello',
  }
}

/** Walks a drizzle `sql\`...\`` template's chunks for an interpolated value. */
function sqlContains(chunk: any, value: string): boolean {
  if (!chunk || typeof chunk !== 'object' || !Array.isArray(chunk.queryChunks)) return false
  return chunk.queryChunks.some((part: any) => {
    if (typeof part === 'string') return part.includes(value)
    if (part && typeof part === 'object' && Array.isArray(part.value)) {
      return part.value.some((v: unknown) => typeof v === 'string' && v.includes(value))
    }
    if (part && typeof part === 'object' && typeof part.value === 'string') {
      return part.value.includes(value)
    }
    return false
  })
}

function metadataWrites(): any[] {
  return mocks.updateSet.mock.calls.map((call) => call[0].metadata).filter(Boolean)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listConversationMessages.mockResolvedValue({ data: [] })
})

describe('resolveSocialBackfillCutoff — fail closed', () => {
  it('suppresses on a channel that has NO cutoff and has never completed a backfill', () => {
    // The live dev channel: connected before the stamp existed, and the stamp is
    // insert-only, so it will never acquire one. The old expression evaluated falsy
    // here and gave it no suppression at all.
    const cutoff = resolveSocialBackfillCutoff({})
    expect(cutoff).toBeInstanceOf(Date)
  })

  it('uses the stamped cutoff when there is one', () => {
    const cutoff = resolveSocialBackfillCutoff({ backfillCutoffAt: '2026-08-17T00:00:00.000Z' })
    expect(cutoff?.toISOString()).toBe('2026-08-17T00:00:00.000Z')
  })

  it('opens the gate only on an explicit initialBackfillCompletedAt', () => {
    expect(
      resolveSocialBackfillCutoff({
        backfillCutoffAt: '2026-08-17T00:00:00.000Z',
        initialBackfillCompletedAt: '2026-08-18T00:00:00.000Z',
      })
    ).toBe(null)
  })
})

describe('syncSocialMessages — initial backfill', () => {
  it('takes the newest-first prefix and stops at the cap', async () => {
    mocks.listConversations.mockResolvedValue({
      data: [
        conversation('t_1', '2026-07-01T00:00:00+0000'),
        conversation('t_2', '2025-08-01T00:00:00+0000'),
        conversation('t_3', '2021-05-01T00:00:00+0000'),
      ],
      paging: { next: 'https://graph.facebook.com/next-page' },
    })

    const result = await syncSocialMessages({
      target: target(),
      metadata: { backfillConversationLimit: 2, backfillCutoffAt: '2026-08-17T00:00:00.000Z' },
      storage: storage(),
    })

    expect(result.conversations).toBe(2)
    expect(result.reachedCap).toBe(true)
    // The cap is a prefix, so the walk never asks for the second page — that is the
    // whole point of bounding by count on a newest-first list.
    expect(mocks.listConversations).toHaveBeenCalledTimes(1)
    expect(mocks.listConversationMessages.mock.calls.map((c) => c[0].conversationId)).toEqual([
      't_1',
      't_2',
    ])
  })

  it('follows paging.next until the cap is reached', async () => {
    mocks.listConversations
      .mockResolvedValueOnce({
        data: [conversation('t_1', '2026-07-01T00:00:00+0000')],
        paging: { next: 'https://graph.facebook.com/page-2' },
      })
      .mockResolvedValueOnce({
        data: [conversation('t_2', '2025-08-01T00:00:00+0000')],
        paging: { next: null },
      })

    const result = await syncSocialMessages({
      target: target(),
      metadata: { backfillCutoffAt: '2026-08-17T00:00:00.000Z' },
      storage: storage(),
    })

    expect(result.conversations).toBe(2)
    expect(result.reachedCap).toBe(false)
    expect(mocks.listConversations.mock.calls[1]![0].nextUrl).toBe(
      'https://graph.facebook.com/page-2'
    )
  })

  it('stamps initialBackfillCompletedAt and lifts the ingest cutoff', async () => {
    mocks.listConversations.mockResolvedValue({
      data: [conversation('t_1', '2026-07-01T00:00:00+0000')],
      paging: { next: null },
    })
    const store = storage()
    const metadata = { backfillCutoffAt: '2026-08-17T00:00:00.000Z' }

    await syncSocialMessages({ target: target(), metadata, storage: store })

    expect(metadataWrites().some((m) => sqlContains(m, 'initialBackfillCompletedAt'))).toBe(true)
    expect(metadataWrites().some((m) => sqlContains(m, 'backfill'))).toBe(true)
    expect(store.setBackfillCutoff).toHaveBeenCalledWith(null)
    expect(metadata).toHaveProperty('initialBackfillCompletedAt')
    // lastSyncedAt is stamped on the success path only.
    expect(mocks.updateSet.mock.calls.some((call) => call[0].lastSyncedAt instanceof Date)).toBe(
      true
    )
  })

  it('arms a cutoff BEFORE storing anything when the channel has none', async () => {
    mocks.listConversations.mockResolvedValue({
      data: [conversation('t_1', '2026-07-01T00:00:00+0000')],
      paging: { next: null },
    })
    mocks.listConversationMessages.mockResolvedValue({
      data: [messageNode('m_1', 'psid_t_1', '2021-05-01T00:00:00+0000')],
    })
    const store = storage()
    const metadata: Record<string, unknown> = {}

    await syncSocialMessages({ target: target(), metadata, storage: store })

    expect(metadata.backfillCutoffAt).toEqual(expect.any(String))
    const armed = store.setBackfillCutoff.mock.calls[0]![0]
    expect(armed).toBeInstanceOf(Date)
    // Armed before the first store, lifted after the last one.
    expect(store.setBackfillCutoff.mock.invocationCallOrder[0]!).toBeLessThan(
      store.batchStoreMessages.mock.invocationCallOrder[0]!
    )
    expect(store.setBackfillCutoff).toHaveBeenLastCalledWith(null)
    // Second guard: the backfill leg also declares itself an initial sync, which
    // suppresses `message:received` for the batch regardless of the cutoff.
    expect(store.batchStoreMessages).toHaveBeenCalledWith(expect.any(Array), undefined, true)
  })

  it('resumes after the recorded cursor instead of re-walking the prefix', async () => {
    mocks.listConversations.mockResolvedValue({
      data: [
        conversation('t_1', '2026-07-01T00:00:00+0000'),
        conversation('t_2', '2026-06-01T00:00:00+0000'),
        conversation('t_3', '2026-05-01T00:00:00+0000'),
        conversation('t_4', '2026-04-01T00:00:00+0000'),
      ],
      paging: { next: null },
    })

    const result = await syncSocialMessages({
      target: target(),
      metadata: {
        backfillCutoffAt: '2026-08-17T00:00:00.000Z',
        backfill: {
          startedAt: '2026-08-18T08:00:00.000Z',
          completedConversations: 2,
          lastConversationId: 't_2',
        },
      },
      storage: storage(),
    })

    expect(mocks.listConversationMessages.mock.calls.map((c) => c[0].conversationId)).toEqual([
      't_3',
      't_4',
    ])
    expect(result.conversations).toBe(2)
  })

  it('falls back to the completed count when the cursor conversation has vanished', async () => {
    mocks.listConversations.mockResolvedValue({
      data: [
        conversation('t_9', '2026-07-02T00:00:00+0000'),
        conversation('t_1', '2026-07-01T00:00:00+0000'),
        conversation('t_3', '2026-05-01T00:00:00+0000'),
      ],
      paging: { next: null },
    })

    await syncSocialMessages({
      target: target(),
      metadata: {
        backfillCutoffAt: '2026-08-17T00:00:00.000Z',
        backfill: {
          startedAt: '2026-08-18T08:00:00.000Z',
          completedConversations: 2,
          lastConversationId: 't_gone',
        },
      },
      storage: storage(),
    })

    expect(mocks.listConversationMessages.mock.calls.map((c) => c[0].conversationId)).toEqual([
      't_3',
    ])
  })

  it('does not stamp lastSyncedAt when the run fails', async () => {
    mocks.listConversations.mockRejectedValue(new Error('Graph request failed (500)'))

    await expect(
      syncSocialMessages({ target: target(), metadata: {}, storage: storage() })
    ).rejects.toThrow('Graph request failed')

    expect(mocks.updateSet.mock.calls.some((call) => call[0].lastSyncedAt instanceof Date)).toBe(
      false
    )
  })

  it('stores under the same thread key the webhook writes — IG on the IGBID', async () => {
    mocks.listConversations.mockResolvedValue({
      data: [conversation('t_1', '2026-07-01T00:00:00+0000', 'igsid_1', IGBID)],
      paging: { next: null },
    })
    mocks.listConversationMessages.mockResolvedValue({
      data: [{ ...messageNode('m_1', 'igsid_1'), to: { data: [{ id: IGBID }] } }],
    })
    const store = storage()

    await syncSocialMessages({
      target: target({ platform: 'instagram', graphPlatform: 'instagram', ourId: IGBID }),
      metadata: { backfillCutoffAt: '2026-08-17T00:00:00.000Z' },
      storage: store,
    })

    const [stored] = store.batchStoreMessages.mock.calls[0]!
    expect(stored[0].externalThreadId).toBe(socialThreadKey(IGBID, 'igsid_1'))
    // The conversations edge is still addressed on the linked Page, IG or not.
    expect(mocks.listConversations.mock.calls[0]![0].pageId).toBe(PAGE_ID)
    expect(mocks.listConversations.mock.calls[0]![0].platform).toBe('instagram')
  })

  it('keeps an IG message the page sent, even when Graph names the linked Page as sender', async () => {
    // The two-id problem, end to end. `from.id` is the Page rather than the IGBID —
    // unverified but not ruled out — and before the alias every message we sent was
    // dropped as a third party, so an IG backfill kept only the customer's half.
    mocks.listConversations.mockResolvedValue({
      data: [conversation('t_1', '2026-07-01T00:00:00+0000', 'igsid_1', IGBID)],
      paging: { next: null },
    })
    mocks.listConversationMessages.mockResolvedValue({
      data: [
        {
          id: 'm_out',
          created_time: '2026-08-18T09:00:00+0000',
          from: { id: PAGE_ID, username: 'auxxlift' },
          to: { data: [{ id: 'igsid_1' }] },
          message: 'we are on it',
        },
      ],
    })
    const store = storage()

    await syncSocialMessages({
      target: target({ platform: 'instagram', graphPlatform: 'instagram', ourId: IGBID }),
      metadata: { backfillCutoffAt: '2026-08-17T00:00:00.000Z' },
      storage: store,
    })

    const [stored] = store.batchStoreMessages.mock.calls[0]!
    expect(stored).toHaveLength(1)
    expect(stored[0].isInbound).toBe(false)
    expect(stored[0].from.identifier).toBe(IGBID)
    expect(stored[0].externalThreadId).toBe(socialThreadKey(IGBID, 'igsid_1'))
  })

  it('passes no alias on Messenger, where the two ids are the same id', async () => {
    // Messenger's page id IS its thread-key identity. Widening the "this is us"
    // set there would be a way to mistake a customer for the page, so it stays off.
    mocks.listConversations.mockResolvedValue({
      data: [conversation('t_1', '2026-07-01T00:00:00+0000', 'psid_1')],
      paging: { next: null },
    })
    mocks.listConversationMessages.mockResolvedValue({
      data: [messageNode('m_1', 'psid_1')],
    })
    const store = storage()

    await syncSocialMessages({
      target: target(),
      metadata: { backfillCutoffAt: '2026-08-17T00:00:00.000Z' },
      storage: store,
    })

    const [stored] = store.batchStoreMessages.mock.calls[0]!
    expect(stored[0].isInbound).toBe(true)
    expect(stored[0].externalThreadId).toBe(socialThreadKey(PAGE_ID, 'psid_1'))
  })
})

describe('syncSocialMessages — incremental', () => {
  const completed = {
    backfillCutoffAt: '2026-08-17T00:00:00.000Z',
    initialBackfillCompletedAt: '2026-08-18T00:00:00.000Z',
    backfill: {
      startedAt: '2026-08-18T08:00:00.000Z',
      completedConversations: 3,
      completedAt: '2026-08-18T08:10:00.000Z',
    },
  }

  it('stops at the first conversation older than `since` — one request on a quiet page', async () => {
    mocks.listConversations.mockResolvedValue({
      data: [
        conversation('t_new', '2026-08-18T10:00:00+0000'),
        conversation('t_old', '2025-08-01T00:00:00+0000'),
        conversation('t_older', '2021-05-01T00:00:00+0000'),
      ],
      paging: { next: 'https://graph.facebook.com/page-2' },
    })

    const result = await syncSocialMessages({
      target: target(),
      metadata: { ...completed },
      storage: storage(),
      since: new Date('2026-08-18T00:00:00.000Z'),
    })

    expect(result.mode).toBe('incremental')
    expect(result.conversations).toBe(1)
    // The whole point: it does NOT walk 20 pages back to 2021 to discard them.
    expect(mocks.listConversations).toHaveBeenCalledTimes(1)
    expect(mocks.listConversationMessages.mock.calls.map((c) => c[0].conversationId)).toEqual([
      't_new',
    ])
  })

  it('never re-runs the backfill once completedAt is stamped', async () => {
    mocks.listConversations.mockResolvedValue({ data: [], paging: { next: null } })
    const store = storage()

    await syncSocialMessages({
      target: target(),
      metadata: { ...completed },
      storage: store,
      since: new Date('2026-08-18T00:00:00.000Z'),
    })

    expect(metadataWrites().some((m) => sqlContains(m, 'initialBackfillCompletedAt'))).toBe(false)
    expect(store.setBackfillCutoff).not.toHaveBeenCalled()
  })

  it('drops messages older than the floor, with slack for the Meta/us clock difference', async () => {
    mocks.listConversations.mockResolvedValue({
      data: [conversation('t_new', '2026-08-18T10:00:00+0000')],
      paging: { next: null },
    })
    mocks.listConversationMessages.mockResolvedValue({
      data: [
        messageNode('m_fresh', 'psid_t_new', '2026-08-18T10:00:00+0000'),
        // Two minutes before `since` — inside the slack, so it survives rather than
        // being lost forever to a clock difference we do not control.
        messageNode('m_edge', 'psid_t_new', '2026-08-17T23:58:00+0000'),
        messageNode('m_ancient', 'psid_t_new', '2021-05-01T00:00:00+0000'),
      ],
    })
    const store = storage()

    await syncSocialMessages({
      target: target(),
      metadata: { ...completed },
      storage: store,
      since: new Date('2026-08-18T00:00:00.000Z'),
    })

    const [stored, , isInitialSync] = store.batchStoreMessages.mock.calls[0]!
    expect(stored.map((m: any) => m.externalId)).toEqual(['m_fresh', 'm_edge'])
    expect(isInitialSync).toBe(false)
  })
})
