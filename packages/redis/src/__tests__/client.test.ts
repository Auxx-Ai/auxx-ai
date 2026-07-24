// packages/redis/src/__tests__/client.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RedisClient } from '../types'

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@auxx/credentials', () => ({
  configService: { get: vi.fn(() => undefined) },
}))

vi.mock('../core/redis-client-factory', () => ({
  RedisClientFactory: {
    createClient: vi.fn(),
    getLiveClient: vi.fn(() => undefined),
    closeClient: vi.fn(async () => {}),
    closeAllClients: vi.fn(async () => {}),
  },
}))

import {
  closeRedisConnection,
  disconnectRedis,
  getPublishingClient,
  getRedisClient,
  getSubscriptionClient,
} from '../client'
import { RedisClientFactory } from '../core/redis-client-factory'

const fakeClient = { isAlive: () => true } as unknown as RedisClient

/** The failure cooldown lives on globalThis; reset it so tests don't leak. */
function clearCooldown() {
  ;(globalThis as unknown as { _auxxRedisLastFailureAt?: number })._auxxRedisLastFailureAt = 0
}

beforeEach(() => {
  vi.clearAllMocks()
  clearCooldown()
  vi.mocked(RedisClientFactory.createClient).mockResolvedValue(fakeClient)
  vi.mocked(RedisClientFactory.getLiveClient).mockReturnValue(undefined)
})

describe('client accessors', () => {
  it('routes each accessor to its own factory instance id', async () => {
    await getRedisClient()
    await getPublishingClient()
    await getSubscriptionClient()

    const ids = vi.mocked(RedisClientFactory.createClient).mock.calls.map(([, id]) => id)
    expect(ids).toEqual(['main', 'publishing', 'subscription'])
  })

  it('keeps no cache of its own — every call delegates to the factory', async () => {
    await getRedisClient()
    await getRedisClient()
    await getRedisClient()

    // A second cache layer here would shadow the factory's and go stale
    // independently, which is what caused duplicate connections.
    expect(RedisClientFactory.createClient).toHaveBeenCalledTimes(3)
  })
})

describe('getRedisClient failure handling', () => {
  it('throws when required and the factory cannot connect', async () => {
    vi.mocked(RedisClientFactory.createClient).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(getRedisClient(true)).rejects.toThrow(/ECONNREFUSED/)
  })

  it('returns undefined when optional and the factory cannot connect', async () => {
    vi.mocked(RedisClientFactory.createClient).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(getRedisClient(false)).resolves.toBeUndefined()
  })

  it('fast-fails during the cooldown instead of retrying the connect', async () => {
    vi.mocked(RedisClientFactory.createClient).mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(getRedisClient(false)).resolves.toBeUndefined()
    expect(RedisClientFactory.createClient).toHaveBeenCalledTimes(1)

    // Second call inside the 30s window must not pay another connect timeout.
    await expect(getRedisClient(false)).resolves.toBeUndefined()
    expect(RedisClientFactory.createClient).toHaveBeenCalledTimes(1)
  })

  it('skips the cooldown when a live client already exists', async () => {
    vi.mocked(RedisClientFactory.createClient).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(getRedisClient(false)).resolves.toBeUndefined()

    // A live client means the outage is over — the cooldown must not block it.
    vi.mocked(RedisClientFactory.getLiveClient).mockReturnValue(fakeClient)
    await expect(getRedisClient(false)).resolves.toBe(fakeClient)
  })

  it('clears the cooldown after a successful connect', async () => {
    vi.mocked(RedisClientFactory.createClient).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(getRedisClient(false)).resolves.toBeUndefined()

    clearCooldown()
    await expect(getRedisClient(false)).resolves.toBe(fakeClient)

    const stored = (globalThis as unknown as { _auxxRedisLastFailureAt?: number })
      ._auxxRedisLastFailureAt
    expect(stored).toBe(0)
  })

  it('returns null rather than throwing for optional pub/sub clients', async () => {
    vi.mocked(RedisClientFactory.createClient).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(getPublishingClient(false)).resolves.toBeNull()
    await expect(getSubscriptionClient(false)).resolves.toBeNull()
  })
})

describe('disconnect helpers', () => {
  it('disconnectRedis closes every factory-cached client', async () => {
    await disconnectRedis()
    expect(RedisClientFactory.closeAllClients).toHaveBeenCalledTimes(1)
  })

  it('closeRedisConnection closes only the main client', async () => {
    await closeRedisConnection()
    expect(RedisClientFactory.closeClient).toHaveBeenCalledWith('main')
  })
})
