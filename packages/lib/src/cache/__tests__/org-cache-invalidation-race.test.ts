// packages/lib/src/cache/__tests__/org-cache-invalidation-race.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * In-memory Redis fake covering exactly what OrganizationCacheService uses.
 * String keys only — the org cache stores data/hash/lock/gen as plain strings.
 */
const store = new Map<string, string>()

const fakeRedis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
    // `set(key, '1', 'EX', n, 'NX')` — the distributed lock. NX must not clobber.
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

const ORG = 'org_race'

/** Deferred promise so the test can hold a provider mid-compute. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('org cache — invalidation vs. in-flight recompute', () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
  })

  /**
   * The production failure, in order (org `mark-shopify`, 2026-08-24 17:34:48):
   *
   *  1. A page load misses `orgProfile`, enters `recompute()`, takes the lock and
   *     reads the row — BEFORE the onboarding UPDATE commits.
   *  2. The UPDATE commits and `onCacheEvent('org.updated')` deletes data + hash,
   *     then calls `recompute()`. The lock is held, so it polls `:data`.
   *  3. The stalled compute resolves and `writeBack`s its pre-commit snapshot —
   *     with a fresh full-length TTL.
   *  4. The invalidator's poll finds exactly that snapshot and adopts it.
   *
   * Net: the invalidation re-installs the value it was called to remove, and
   * `/app` reads `completedOnboarding: false` against a row that says `true` for
   * the next 24 hours. Step 3 has to land while step 2 is still polling, which is
   * what `setTimeout` below models — resolving the gate after the invalidation
   * has already returned exercises a different (and harmless) interleaving.
   */
  it('does not adopt or re-persist a pre-commit snapshot that lands mid-invalidation', async () => {
    const cache = new OrganizationCacheService({} as any)

    const gate = deferred<void>()
    let row = { completedOnboarding: false, handle: null as string | null }
    let calls = 0

    cache.register('orgProfile', {
      compute: async () => {
        calls++
        if (calls === 1) await gate.promise
        return { ...row } as any
      },
    } as any)

    // 1. Page load stalls inside the provider, holding the lock.
    const inFlight = cache.getOrRecompute(ORG, ['orgProfile'])
    await new Promise((r) => setImmediate(r))

    // 3. Let it finish while the invalidation below is mid-flight.
    const timer = setTimeout(() => gate.resolve(), 250)

    // 2. The UPDATE commits, then fires its invalidation.
    row = { completedOnboarding: true, handle: 'mark-shopify' }
    await cache.invalidateAndRecompute(ORG, ['orgProfile'])

    clearTimeout(timer)
    gate.resolve()
    await inFlight

    // The invalidation must have read the DB itself rather than adopting the
    // in-flight snapshot...
    expect(calls).toBe(2)

    // ...and the stale writeBack must not have been persisted behind it.
    const cached = JSON.parse(store.get('org:profile:v2:org_race:data') as string)
    expect(cached.completedOnboarding).toBe(true)
    expect(cached.handle).toBe('mark-shopify')
  })

  it('keeps serving the fresh value on the next read', async () => {
    const cache = new OrganizationCacheService({} as any)

    let row = { completedOnboarding: false }
    cache.register('orgProfile', { compute: async () => ({ ...row }) as any } as any)

    await cache.getOrRecompute(ORG, ['orgProfile'])
    row = { completedOnboarding: true }
    await cache.invalidateAndRecompute(ORG, ['orgProfile'])

    const { orgProfile } = await cache.getOrRecompute(ORG, ['orgProfile'])
    expect(orgProfile.completedOnboarding).toBe(true)
  })
})
