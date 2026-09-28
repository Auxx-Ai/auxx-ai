// packages/lib/src/usage/__tests__/records-count.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  redis: undefined as unknown,
  store: new Map<string, string>(),
  dbCount: 0,
  dbCalls: 0,
}))

vi.mock('@auxx/redis', () => ({ getRedisClient: vi.fn(async () => h.redis) }))
vi.mock('../records-metered', () => ({ readMeteredDefIds: vi.fn(async () => ['def_contact']) }))

import {
  invalidateMeteredRecordCount,
  noteMeteredRecordsCreated,
  readMeteredRecordCount,
} from '../records-count'

const KEY = 'usage:records:count:org_1'

/** In-memory Redis that runs the conditional-increment script's semantics. */
function fakeRedis() {
  return {
    get: vi.fn(async (k: string) => h.store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      h.store.set(k, v)
      return 'OK'
    }),
    del: vi.fn(async (k: string) => (h.store.delete(k) ? 1 : 0)),
    eval: vi.fn(async (script: string, _n: number, key: string, qty: string) => {
      expect(script).toContain('EXISTS')
      if (!h.store.has(key)) return null
      const next = Number(h.store.get(key)) + Number(qty)
      h.store.set(key, String(next))
      return next
    }),
  }
}

const db = {
  select: () => ({
    from: () => ({
      where: async () => {
        h.dbCalls++
        return [{ value: h.dbCount }]
      },
    }),
  }),
} as never

beforeEach(() => {
  h.store = new Map()
  h.redis = fakeRedis()
  h.dbCount = 0
  h.dbCalls = 0
})

describe('readMeteredRecordCount', () => {
  it('serves a cached count without touching Postgres', async () => {
    h.store.set(KEY, '42')
    await expect(readMeteredRecordCount(db, 'org_1')).resolves.toBe(42)
    expect(h.dbCalls).toBe(0)
  })

  it('recounts on a miss and seeds the key with a TTL', async () => {
    h.dbCount = 7
    await expect(readMeteredRecordCount(db, 'org_1')).resolves.toBe(7)
    expect((h.redis as ReturnType<typeof fakeRedis>).set).toHaveBeenCalledWith(
      KEY,
      '7',
      'EX',
      expect.any(Number)
    )
  })

  it('recounts every read without Redis', async () => {
    h.redis = undefined
    h.dbCount = 3
    await expect(readMeteredRecordCount(db, 'org_1')).resolves.toBe(3)
    await expect(readMeteredRecordCount(db, 'org_1')).resolves.toBe(3)
    expect(h.dbCalls).toBe(2)
  })
})

describe('noteMeteredRecordsCreated', () => {
  it('bumps an existing cached count', async () => {
    h.store.set(KEY, '10')
    await noteMeteredRecordsCreated('org_1', 3)
    expect(h.store.get(KEY)).toBe('13')
  })

  it('does nothing on a missing key, so the next read recounts', async () => {
    await noteMeteredRecordsCreated('org_1', 3)
    expect(h.store.has(KEY)).toBe(false)
  })

  it('is a no-op without Redis', async () => {
    h.redis = undefined
    await expect(noteMeteredRecordsCreated('org_1', 3)).resolves.toBeUndefined()
  })
})

describe('invalidateMeteredRecordCount', () => {
  it('drops the key so the next read recounts from Postgres', async () => {
    h.store.set(KEY, '10')
    h.dbCount = 12
    await invalidateMeteredRecordCount('org_1')
    await expect(readMeteredRecordCount(db, 'org_1')).resolves.toBe(12)
    expect(h.dbCalls).toBe(1)
  })
})
