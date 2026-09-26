// packages/lib/src/cache/__tests__/org-cache-derived-keys.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()

const fakeRedis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
    if (args.includes('NX') && store.has(key)) return null
    store.set(key, value)
    return 'OK'
  }),
  del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  incr: vi.fn(async (key: string) => {
    const next = Number(store.get(key) ?? 0) + 1
    store.set(key, String(next))
    return next
  }),
  expire: vi.fn(async () => 1),
  scan: vi.fn(async () => ['0', [] as string[]]),
  pipeline: vi.fn(() => {
    const ops: Array<() => void> = []
    const pipe: any = {
      set: (key: string, value: string) => {
        ops.push(() => store.set(key, value))
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

vi.mock('@auxx/redis', () => ({ getRedisClient: vi.fn(async () => fakeRedis) }))
vi.mock('@auxx/database', () => ({ database: {} }))

import { OrganizationCacheService } from '../org-cache-service'

describe('org cache — derived keys', () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
  })

  it('recomputes resourceNav after resources whenever resources is invalidated', async () => {
    const cache = new OrganizationCacheService()
    let version = 1
    const order: string[] = []
    cache.register('resources', {
      compute: async () => {
        order.push('resources')
        return [{ id: `v${version}` }] as never
      },
    })
    cache.register('resourceNav', {
      compute: async (orgId) => {
        order.push('resourceNav')
        const resources = (await cache.get(orgId, 'resources')) as unknown as { id: string }[]
        return resources.map((r) => ({ id: r.id })) as never
      },
    })

    expect(await cache.get('org1', 'resourceNav')).toEqual([{ id: 'v1' }])
    version = 2
    order.length = 0
    await cache.invalidateAndRecompute('org1', ['resources'])

    expect(order).toEqual(['resources', 'resourceNav'])
    expect(await cache.get('org1', 'resourceNav')).toEqual([{ id: 'v2' }])
  })
})
