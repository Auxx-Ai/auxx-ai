// packages/lib/src/cache/__tests__/counter-cache.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** In-memory Redis hash fake covering exactly what counter-cache uses. */
const store = new Map<string, Record<string, string>>()

const fakeRedis = {
  hgetall: vi.fn(async (key: string) => store.get(key) ?? {}),
  exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
  hdel: vi.fn(async (key: string, ...fields: string[]) => {
    const hash = store.get(key)
    if (!hash) return 0
    let removed = 0
    for (const field of fields) {
      if (field in hash) {
        delete hash[field]
        removed++
      }
    }
    return removed
  }),
  pipeline: vi.fn(() => {
    const ops: Array<() => void> = []
    const pipe: any = {
      del: (key: string) => {
        ops.push(() => store.delete(key))
        return pipe
      },
      hset: (key: string, fields: Record<string, string | number>) => {
        ops.push(() => {
          const hash = store.get(key) ?? {}
          for (const [field, value] of Object.entries(fields)) hash[field] = String(value)
          store.set(key, hash)
        })
        return pipe
      },
      hincrby: (key: string, field: string, amount: number) => {
        ops.push(() => {
          const hash = store.get(key) ?? {}
          hash[field] = String(Number(hash[field] ?? 0) + amount)
          store.set(key, hash)
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

import { counterHash } from '../counter-cache'

describe('counterHash', () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
  })

  it('readAll returns null on a missing hash', async () => {
    const hash = counterHash('c:miss', 60)
    expect(await hash.readAll()).toBeNull()
  })

  it('seed overwrites and readAll returns numbers', async () => {
    const hash = counterHash('c:seed', 60)
    store.set('c:seed', { stale: '99' })
    await hash.seed({ inbox: 3, 'si:a': 5, _reconciledAt: 1234 })

    expect(await hash.readAll()).toEqual({ inbox: 3, 'si:a': 5, _reconciledAt: 1234 })
  })

  it('applyDeltas is a no-op when the hash does not exist', async () => {
    const hash = counterHash('c:absent', 60)
    await hash.applyDeltas({ inbox: 1 })

    // Must NOT materialize a phantom hash with base 0.
    expect(store.has('c:absent')).toBe(false)
  })

  it('applyDeltas increments and decrements atomically per field', async () => {
    const hash = counterHash('c:deltas', 60)
    await hash.seed({ inbox: 2, 'si:a': 1 })
    await hash.applyDeltas({ inbox: -1, 'si:a': 3, 'si:b': 2, drafts: 0 })

    expect(await hash.readAll()).toEqual({ inbox: 1, 'si:a': 4, 'si:b': 2 })
  })

  it('applyDeltas with only zero deltas skips Redis entirely', async () => {
    const hash = counterHash('c:zero', 60)
    await hash.seed({ inbox: 2 })
    fakeRedis.exists.mockClear()
    await hash.applyDeltas({ inbox: 0 })

    expect(fakeRedis.exists).not.toHaveBeenCalled()
    expect(await hash.readAll()).toEqual({ inbox: 2 })
  })

  it('removeFields deletes individual fields (staleness marker)', async () => {
    const hash = counterHash('c:stale', 60)
    await hash.seed({ inbox: 2, _reconciledAt: 1234 })
    await hash.removeFields('_reconciledAt')

    expect(await hash.readAll()).toEqual({ inbox: 2 })
  })
})
