// packages/lib/src/cache/__tests__/base-cache-service.test.ts
//
// Memory-mirror pruning tests. Redis is mocked as unavailable so the service
// runs in degraded (memory-only) mode — the map is the sole store.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/redis', () => ({
  getRedisClient: vi.fn(async () => {
    throw new Error('redis unavailable (test)')
  }),
}))

import { BaseCacheService } from '../base-cache-service'

function memoryMapOf(service: BaseCacheService): Map<string, unknown> {
  return (service as unknown as { memoryCache: Map<string, unknown> }).memoryCache
}

describe('BaseCacheService memory pruning', () => {
  it('bounds the in-memory mirror and keeps the newest entries', async () => {
    const service = new BaseCacheService('prune-a', 60)
    for (let i = 0; i < 1200; i++) {
      await service.set(`k${i}`, i)
    }
    expect(memoryMapOf(service).size).toBeLessThanOrEqual(1000)
    expect(await service.get('k1199')).toBe(1199)
    expect(await service.get('k0')).toBeNull()
  })

  it('sheds expired entries before evicting live ones', async () => {
    const service = new BaseCacheService('prune-b', 60)
    for (let i = 0; i < 600; i++) {
      await service.set(`expired${i}`, i, { ttl: -1 })
    }
    for (let i = 0; i < 600; i++) {
      await service.set(`live${i}`, i)
    }
    // Crossing the threshold swept the expired half — every live entry survives.
    for (const probe of ['live0', 'live300', 'live599']) {
      expect(await service.get(probe)).toBe(Number(probe.replace('live', '')))
    }
    expect(memoryMapOf(service).size).toBeLessThanOrEqual(1000)
  })

  it('never prunes below the threshold', async () => {
    const service = new BaseCacheService('prune-c', 60)
    for (let i = 0; i < 900; i++) {
      await service.set(`k${i}`, i)
    }
    expect(memoryMapOf(service).size).toBe(900)
    expect(await service.get('k0')).toBe(0)
  })
})
