// packages/redis/src/core/__tests__/redis-client-factory.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RedisClient } from '../../types'

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../providers/provider-detector', () => ({
  getRedisProvider: vi.fn(() => 'hosted'),
  validateProviderConfiguration: vi.fn(() => true),
  getProviderCapabilities: vi.fn(() => ({ provider: 'hosted' })),
  getConnectionOptions: vi.fn(() => ({ host: 'localhost', port: 6379 })),
}))

vi.mock('../../providers/upstash-provider', () => ({
  createUpstashClient: vi.fn(() => makeFakeClient()),
}))

vi.mock('../../providers/ioredis-provider', () => ({
  createIORedisClient: vi.fn(() => makeFakeClient()),
}))

import { createIORedisClient } from '../../providers/ioredis-provider'
import { RedisClientFactory } from '../redis-client-factory'

/** Controls whether the next fake client's connect() resolves immediately. */
let connectGate: {
  promise: Promise<void>
  resolve: () => void
  reject: (e: Error) => void
} | null = null

/** Every fake client built during a test, in construction order. */
const built: FakeClient[] = []

interface FakeClient extends RedisClient {
  alive: boolean
}

function makeFakeClient(): FakeClient {
  const client = {
    alive: true,
    connect: vi.fn(async () => {
      if (connectGate) await connectGate.promise
    }),
    ping: vi.fn(async () => 'PONG'),
    quit: vi.fn(async () => 'OK'),
    disconnect: vi.fn(() => {
      client.alive = false
    }),
    isAlive: vi.fn(() => client.alive),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as FakeClient

  built.push(client)
  return client
}

function deferred() {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * The factory's caches live on globalThis (so separate Next.js module scopes
 * share one pool), which means they survive between tests. Clear them rather
 * than reloading the module so each test starts from a cold cache.
 */
function clearFactoryCaches() {
  const g = globalThis as unknown as {
    _auxxRedisInstances?: Map<string, RedisClient>
    _auxxRedisPending?: Map<string, Promise<RedisClient>>
  }
  g._auxxRedisInstances?.clear()
  g._auxxRedisPending?.clear()
}

beforeEach(() => {
  vi.clearAllMocks()
  clearFactoryCaches()
  built.length = 0
  connectGate = null
})

afterEach(() => {
  clearFactoryCaches()
})

describe('RedisClientFactory.createClient', () => {
  it('coalesces concurrent calls for the same instance into a single client', async () => {
    // Hold connect() open so all four callers arrive while the first creation
    // is still in flight — the exact shape of initCaches() constructing four
    // cache services in one tick.
    connectGate = deferred()

    const calls = [
      RedisClientFactory.createClient(undefined, 'main'),
      RedisClientFactory.createClient(undefined, 'main'),
      RedisClientFactory.createClient(undefined, 'main'),
      RedisClientFactory.createClient(undefined, 'main'),
    ]

    connectGate.resolve()
    const clients = await Promise.all(calls)

    expect(createIORedisClient).toHaveBeenCalledTimes(1)
    expect(new Set(clients).size).toBe(1)
    expect(built).toHaveLength(1)
  })

  it('reuses the cached client once the first creation has settled', async () => {
    const first = await RedisClientFactory.createClient(undefined, 'main')
    const second = await RedisClientFactory.createClient(undefined, 'main')

    expect(second).toBe(first)
    expect(createIORedisClient).toHaveBeenCalledTimes(1)
  })

  it('keeps separate clients per instance id', async () => {
    const main = await RedisClientFactory.createClient(undefined, 'main')
    const publishing = await RedisClientFactory.createClient(undefined, 'publishing')

    expect(main).not.toBe(publishing)
    expect(createIORedisClient).toHaveBeenCalledTimes(2)
  })

  it('does not let one instance id block another from being created', async () => {
    connectGate = deferred()

    const main = RedisClientFactory.createClient(undefined, 'main')
    const publishing = RedisClientFactory.createClient(undefined, 'publishing')

    connectGate.resolve()
    const [a, b] = await Promise.all([main, publishing])

    expect(a).not.toBe(b)
    expect(built).toHaveLength(2)
  })

  it('replaces a cached client that is no longer alive', async () => {
    const first = (await RedisClientFactory.createClient(undefined, 'main')) as FakeClient
    first.alive = false

    const second = await RedisClientFactory.createClient(undefined, 'main')

    expect(second).not.toBe(first)
    expect(createIORedisClient).toHaveBeenCalledTimes(2)
  })

  it('rejects every concurrent caller when the shared creation fails', async () => {
    connectGate = deferred()

    const calls = [
      RedisClientFactory.createClient(undefined, 'main'),
      RedisClientFactory.createClient(undefined, 'main'),
      RedisClientFactory.createClient(undefined, 'main'),
    ]

    connectGate.reject(new Error('ECONNREFUSED'))
    const results = await Promise.allSettled(calls)

    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    // One failed attempt, not one per caller.
    expect(createIORedisClient).toHaveBeenCalledTimes(1)
  })

  it('retries after a failure instead of caching the rejection', async () => {
    connectGate = deferred()
    const failing = RedisClientFactory.createClient(undefined, 'main')
    connectGate.reject(new Error('ECONNREFUSED'))
    await expect(failing).rejects.toThrow(/ECONNREFUSED/)

    // A rejected creation must not stay in the in-flight map, or every later
    // caller would inherit the same failure until process restart.
    connectGate = null
    const recovered = await RedisClientFactory.createClient(undefined, 'main')

    expect(recovered).toBeDefined()
    expect(createIORedisClient).toHaveBeenCalledTimes(2)
  })

  it('caches the connected client on globalThis so other module scopes share it', async () => {
    const client = await RedisClientFactory.createClient(undefined, 'main')

    const g = globalThis as unknown as { _auxxRedisInstances?: Map<string, RedisClient> }
    expect(g._auxxRedisInstances?.get('auto-main')).toBe(client)
  })

  it('clears the in-flight entry once a creation settles', async () => {
    await RedisClientFactory.createClient(undefined, 'main')

    const g = globalThis as unknown as { _auxxRedisPending?: Map<string, Promise<RedisClient>> }
    expect(g._auxxRedisPending?.size).toBe(0)
  })
})

describe('RedisClientFactory.getLiveClient', () => {
  it('returns undefined when nothing is cached, without connecting', () => {
    expect(RedisClientFactory.getLiveClient('main')).toBeUndefined()
    expect(createIORedisClient).not.toHaveBeenCalled()
  })

  it('returns the cached client while it is alive', async () => {
    const client = await RedisClientFactory.createClient(undefined, 'main')
    expect(RedisClientFactory.getLiveClient('main')).toBe(client)
  })

  it('returns undefined for a cached client that has died', async () => {
    const client = (await RedisClientFactory.createClient(undefined, 'main')) as FakeClient
    client.alive = false

    expect(RedisClientFactory.getLiveClient('main')).toBeUndefined()
  })
})

describe('RedisClientFactory.closeClient', () => {
  it('quits and evicts the client so the next call reconnects', async () => {
    const client = await RedisClientFactory.createClient(undefined, 'main')

    await RedisClientFactory.closeClient('main')

    expect(client.quit).toHaveBeenCalledTimes(1)
    const next = await RedisClientFactory.createClient(undefined, 'main')
    expect(next).not.toBe(client)
  })
})
