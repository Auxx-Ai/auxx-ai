// packages/lib/src/utils/rate-limiter/__tests__/fixed-window.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, number>()
const redis = {
  incr: vi.fn(async (key: string) => {
    const next = (store.get(key) ?? 0) + 1
    store.set(key, next)
    return next
  }),
  pexpire: vi.fn(async () => 1),
  pttl: vi.fn(async () => 42_000),
}

let redisAvailable = true
vi.mock('@auxx/redis', () => ({
  getRedisClient: async () => (redisAvailable ? redis : undefined),
}))

import { checkFixedWindowLimit } from '../fixed-window'

beforeEach(() => {
  store.clear()
  redisAvailable = true
  vi.clearAllMocks()
})

describe('checkFixedWindowLimit', () => {
  it('allows up to the limit, sets expiry only on the first hit', async () => {
    for (let i = 1; i <= 3; i++) {
      const result = await checkFixedWindowLimit({ key: 'k', limit: 3, windowMs: 60_000 })
      expect(result).toEqual({ allowed: true, count: i })
    }
    expect(redis.pexpire).toHaveBeenCalledTimes(1)
    expect(redis.pexpire).toHaveBeenCalledWith('k', 60_000)
  })

  it('blocks over the limit and reports remainingMs', async () => {
    for (let i = 0; i < 3; i++) {
      await checkFixedWindowLimit({ key: 'k', limit: 3, windowMs: 60_000 })
    }
    const blocked = await checkFixedWindowLimit({ key: 'k', limit: 3, windowMs: 60_000 })
    expect(blocked).toEqual({ allowed: false, count: 4, remainingMs: 42_000 })
  })

  it('fails open when Redis is unavailable', async () => {
    redisAvailable = false
    const result = await checkFixedWindowLimit({ key: 'k', limit: 1, windowMs: 60_000 })
    expect(result).toEqual({ allowed: true, count: 0 })
  })

  it('fails open when Redis throws', async () => {
    redis.incr.mockRejectedValueOnce(new Error('boom'))
    const result = await checkFixedWindowLimit({ key: 'k', limit: 1, windowMs: 60_000 })
    expect(result).toEqual({ allowed: true, count: 0 })
  })
})
