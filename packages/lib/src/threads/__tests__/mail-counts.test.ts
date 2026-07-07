// packages/lib/src/threads/__tests__/mail-counts.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** In-memory Redis fake covering the counter hash + epoch key. */
const hashes = new Map<string, Record<string, string>>()
const strings = new Map<string, string>()

const fakeRedis = {
  get: vi.fn(async (key: string) => strings.get(key) ?? null),
  incr: vi.fn(async (key: string) => {
    const next = Number(strings.get(key) ?? 0) + 1
    strings.set(key, String(next))
    return next
  }),
  hgetall: vi.fn(async (key: string) => hashes.get(key) ?? {}),
  exists: vi.fn(async (key: string) => (hashes.has(key) ? 1 : 0)),
  hdel: vi.fn(async (key: string, ...fields: string[]) => {
    const hash = hashes.get(key)
    if (!hash) return 0
    for (const field of fields) delete hash[field]
    return fields.length
  }),
  pipeline: vi.fn(() => {
    const ops: Array<() => void> = []
    const pipe: any = {
      del: (key: string) => {
        ops.push(() => hashes.delete(key))
        return pipe
      },
      hset: (key: string, fields: Record<string, string | number>) => {
        ops.push(() => {
          const hash = hashes.get(key) ?? {}
          for (const [field, value] of Object.entries(fields)) hash[field] = String(value)
          hashes.set(key, hash)
        })
        return pipe
      },
      hincrby: (key: string, field: string, amount: number) => {
        ops.push(() => {
          const hash = hashes.get(key) ?? {}
          hash[field] = String(Number(hash[field] ?? 0) + amount)
          hashes.set(key, hash)
        })
        return pipe
      },
      expire: () => pipe,
      exec: async () => {
        for (const op of ops) op()
        return []
      },
    }
    return pipe
  }),
}

vi.mock('@auxx/redis', () => ({
  getRedisClient: vi.fn(async () => fakeRedis),
}))

const queueAdd = vi.fn()
vi.mock('../../jobs/queues', () => ({
  getQueue: vi.fn(() => ({ add: queueAdd })),
  Queues: { maintenanceQueue: 'maintenance' },
}))
vi.mock('../../jobs/queues/types', () => ({
  Queues: { maintenanceQueue: 'maintenance' },
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: vi.fn(() => ({})),
  publishCountsChanged: vi.fn(async () => {}),
}))

const unreadMocks = {
  getPersonalInboxCount: vi.fn(async () => 4),
  getDraftsCount: vi.fn(async () => 2),
  getViewCounts: vi.fn(async () => ({ v1: 7 })),
  getAccessibleViewIds: vi.fn(async () => ['v1']),
  calculateUnreadCountForUserInbox: vi.fn(async (inboxId: string) => (inboxId === 'ibx1' ? 3 : 0)),
}
vi.mock('../unread-service', () => ({
  UnreadService: class {
    constructor() {
      // biome-ignore lint/correctness/noConstructorReturn: test stub
      return unreadMocks
    }
  },
}))

// Mock only what mail-counts pulls from the cache barrel — importing the real
// barrel drags in the agents module and its queue imports.
// The admin viewer keeps every inbox countable (§10.1 scoping is exercised in
// the visibility suite; here we assert the seeding mechanics).
vi.mock('../../cache', () => ({
  getOrgCache: vi.fn(() => ({
    get: vi.fn(async () => [{ id: 'ibx1' }, { id: 'ibx2' }]),
  })),
  getCachedMembers: vi.fn(async () => [{ userId: 'u1' }, { userId: 'u2' }]),
  getCachedUserMailVisibility: vi.fn(async () => ({
    userId: 'u1',
    role: 'ADMIN',
    isAdmin: true,
    inboxLens: {},
    personalInboxIds: {},
    threadGrants: {},
    contactGrants: {},
    entityGrants: {},
  })),
}))

import { applyMailCountDeltas, getMailCounts, markMailCountsStale } from '../mail-counts'

const KEY = 'mail:counts:org1:u1'

describe('mail-counts', () => {
  beforeEach(() => {
    hashes.clear()
    strings.clear()
    vi.clearAllMocks()
  })

  it('serves fresh cached counts without enqueueing a reconcile', async () => {
    hashes.set(KEY, {
      inbox: '2',
      drafts: '1',
      'si:ibx1': '5',
      'view:v1': '3',
      _reconciledAt: String(Date.now()),
      _epoch: '0',
    })

    const counts = await getMailCounts('org1', 'u1')

    expect(counts).toEqual({
      inbox: 2,
      drafts: 1,
      sharedInboxes: { ibx1: 5 },
      views: { v1: 3 },
    })
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('clamps negative drift to zero at read time', async () => {
    hashes.set(KEY, {
      inbox: '-2',
      drafts: '1',
      'si:ibx1': '-1',
      _reconciledAt: String(Date.now()),
      _epoch: '0',
    })

    const counts = await getMailCounts('org1', 'u1')

    expect(counts.inbox).toBe(0)
    expect(counts.sharedInboxes.ibx1).toBe(0)
  })

  it('serves stale counts immediately but enqueues a deduped reconcile', async () => {
    hashes.set(KEY, {
      inbox: '2',
      _reconciledAt: String(Date.now() - 10 * 60_000), // older than interval
      _epoch: '0',
    })

    const counts = await getMailCounts('org1', 'u1')

    expect(counts.inbox).toBe(2)
    // Enqueue is fire-and-forget — flush the microtask chain before asserting.
    await vi.waitFor(() =>
      expect(queueAdd).toHaveBeenCalledWith(
        'mailCountsReconcile',
        { organizationId: 'org1', userId: 'u1' },
        expect.objectContaining({ jobId: 'mail-counts-reconcile:org1:u1' })
      )
    )
  })

  it('treats an org epoch bump as stale', async () => {
    strings.set('mail:counts:epoch:org1', '3')
    hashes.set(KEY, {
      inbox: '2',
      _reconciledAt: String(Date.now()),
      _epoch: '2',
    })

    await getMailCounts('org1', 'u1')

    await vi.waitFor(() => expect(queueAdd).toHaveBeenCalled())
  })

  it('computes and seeds on cache miss', async () => {
    const counts = await getMailCounts('org1', 'u1')

    expect(counts).toEqual({
      inbox: 4,
      drafts: 2,
      sharedInboxes: { ibx1: 3, ibx2: 0 },
      views: { v1: 7 },
    })
    const seeded = hashes.get(KEY)
    expect(seeded?.inbox).toBe('4')
    expect(seeded?.['si:ibx1']).toBe('3')
    expect(seeded?.['view:v1']).toBe('7')
    expect(seeded?._reconciledAt).toBeDefined()
  })

  it('applyMailCountDeltas merges per-user deltas into one pipeline', async () => {
    hashes.set(KEY, { inbox: '1', 'si:ibx1': '1' })

    await applyMailCountDeltas('org1', [
      { userId: 'u1', deltas: { 'si:ibx1': 1 } },
      { userId: 'u1', deltas: { 'si:ibx1': 1, inbox: 1 } },
      { userId: 'u2', deltas: { inbox: 1 } }, // no hash for u2 → no-op
    ])

    expect(hashes.get(KEY)).toMatchObject({ inbox: '2', 'si:ibx1': '3' })
    expect(hashes.has('mail:counts:org1:u2')).toBe(false)
  })

  it('applyMailCountDeltas enqueues the acting-user fast reconcile', async () => {
    hashes.set(KEY, { inbox: '1' })

    await applyMailCountDeltas('org1', [{ userId: 'u1', deltas: { inbox: 1 } }], {
      fastReconcileUserId: 'u1',
    })

    expect(queueAdd).toHaveBeenCalledWith(
      'mailCountsReconcile',
      { organizationId: 'org1', userId: 'u1' },
      expect.objectContaining({ delay: expect.any(Number) })
    )
  })

  it('markMailCountsStale drops the marker and enqueues a recount per user', async () => {
    hashes.set(KEY, { inbox: '1', _reconciledAt: String(Date.now()) })

    await markMailCountsStale('org1', ['u1'])

    expect(hashes.get(KEY)?._reconciledAt).toBeUndefined()
    expect(queueAdd).toHaveBeenCalledTimes(1)
  })
})
