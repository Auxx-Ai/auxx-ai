// packages/lib/src/utils/rate-limiter/__tests__/pacer.test.ts
//
// The fake Redis below re-implements the two Lua scripts in JS. That verifies our
// CLIENT layer — arg marshalling, EVALSHA/NOSCRIPT/EVAL, the max-not-add semantics,
// the burst refusal, the in-process fallback — but it does NOT execute real Lua, so it
// cannot prove the scripts themselves parse on a live server. Exercising the bodies
// needs an integration run against a real Redis.

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Partial mock: `@auxx/logger/run-log` pulls sink helpers off this barrel at load
// time, so a full replacement breaks whichever test file loads it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

/** Cursor store shared by the fake client across a test. */
const store = new Map<string, number>()
/** Digests the fake server has "cached", so EVALSHA can miss the way Redis does. */
const cachedShas = new Set<string>()

const calls = { evalsha: 0, eval: 0 }

class NoScriptError extends Error {
  constructor() {
    super('NOSCRIPT No matching script. Please use EVAL.')
  }
}

/** Interpret whichever of the two scripts was sent. */
function runBody(script: string, key: string, argv: number[]): unknown {
  if (script.includes('burst')) {
    const [now, intervalMs, burst, cost, _ttl] = argv as [number, number, number, number, number]
    const interval = intervalMs * cost
    let cursor = store.get(key) ?? 0
    if (cursor < now) cursor = now
    const wait = cursor - now
    if (wait > burst) return [0, wait]
    store.set(key, Math.floor(cursor + interval))
    return [1, wait]
  }
  // Retry-After push.
  const [now, retryAfterMs] = argv as [number, number, number]
  const cursor = store.get(key) ?? 0
  const target = now + retryAfterMs
  if (target > cursor) {
    store.set(key, Math.floor(target))
    return 1
  }
  return 0
}

/** Mirrors the pacer's digest so EVALSHA and EVAL agree on script identity. */
function shaOf(script: string): string {
  return createHash('sha1').update(script).digest('hex')
}

const scriptForSha = new Map<string, string>()

const redis = {
  evalsha: vi.fn(async (sha: string, _numKeys: number, key: string, ...argv: number[]) => {
    calls.evalsha++
    if (!cachedShas.has(sha)) throw new NoScriptError()
    return runBody(scriptForSha.get(sha)!, key, argv)
  }),
  eval: vi.fn(async (script: string, _numKeys: number, key: string, ...argv: number[]) => {
    calls.eval++
    const sha = shaOf(script)
    cachedShas.add(sha)
    scriptForSha.set(sha, script)
    return runBody(script, key, argv)
  }),
}

let redisAvailable = true
// Partial mock — a full replacement of `@auxx/redis` drops `createCredentialLockProvider`
// et al. and dies at collection time as soon as anything in the graph reaches for them.
vi.mock('@auxx/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/redis')>()),
  getRedisClient: async () => (redisAvailable ? redis : null),
}))

import { RateLimitError } from '../../../errors'
import { acquireSlot, reportRetryAfter, resetPacerState } from '../pacer'
import { connectionQuota, type Quota, quotaCursorKey } from '../quota'

/** 1000 rps ⇒ a 1ms interval, so ordering assertions don't cost wall-clock. */
function fastQuota(scopeId: string, overrides: Partial<Quota> = {}): Quota {
  return { ...connectionQuota(scopeId, { rps: 1000, burstMs: 5_000 }), ...overrides }
}

beforeEach(() => {
  store.clear()
  cachedShas.clear()
  scriptForSha.clear()
  calls.evalsha = 0
  calls.eval = 0
  redisAvailable = true
  resetPacerState()
  vi.clearAllMocks()
})

describe('acquireSlot', () => {
  it('never hands the same slot to two concurrent callers', async () => {
    const quota = fastQuota('same-key')

    const waits = await Promise.all(Array.from({ length: 8 }, () => acquireSlot(quota)))

    // Each caller reserved a distinct, monotonically later slot — the property a
    // read-modify-write limiter cannot provide.
    expect(new Set(waits).size).toBe(waits.length)
    expect([...waits].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('keeps distinct quotas on separate budgets', async () => {
    const a = fastQuota('key-a')
    const b = fastQuota('key-b')

    await Promise.all([acquireSlot(a), acquireSlot(a), acquireSlot(a)])
    const firstOnB = await acquireSlot(b)

    // B's cursor is untouched by A's three reservations.
    expect(firstOnB).toBe(0)
    expect(store.size).toBe(2)
  })

  it('re-anchors an idle cursor instead of firing a burst of backdated slots', async () => {
    const quota = fastQuota('idle')
    const key = quotaCursorKey(quota)
    // A cursor left far in the past by a long-finished run.
    store.set(key, Date.now() - 60_000)

    const waited = await acquireSlot(quota)

    expect(waited).toBe(0)
    // Re-anchored to ~now, not now-60s + interval.
    expect(store.get(key)!).toBeGreaterThan(Date.now() - 1_000)
  })

  it('does not consume budget when the reservation is past the burst ceiling', async () => {
    const quota = fastQuota('burst', { burstMs: 100 })
    const key = quotaCursorKey(quota)
    const cursor = Date.now() + 5_000
    store.set(key, cursor)

    await expect(acquireSlot(quota)).rejects.toBeInstanceOf(RateLimitError)

    // The refusal cost nothing: the cursor is exactly where it was. A post-increment
    // burst check would have leaked an interval here on every rejected call.
    expect(store.get(key)).toBe(cursor)
  })

  it('falls back to EVAL on NOSCRIPT and re-caches the digest', async () => {
    const quota = fastQuota('noscript')

    await acquireSlot(quota)
    expect(calls.evalsha).toBe(1) // missed
    expect(calls.eval).toBe(1) // re-sent the body

    await acquireSlot(quota)
    expect(calls.evalsha).toBe(2) // hit this time
    expect(calls.eval).toBe(1) // no second body send
  })

  it('paces in-process when Redis is unavailable', async () => {
    redisAvailable = false
    const quota = fastQuota('offline')

    const waits = await Promise.all([acquireSlot(quota), acquireSlot(quota), acquireSlot(quota)])

    expect(waits).toEqual([0, 1, 2])
    expect(store.size).toBe(0) // nothing reached Redis
  })

  it('weights the reservation by cost', async () => {
    const quota = fastQuota('cost')

    await acquireSlot(quota, { cost: 100 })
    const second = await acquireSlot(quota)

    // 100 units at a 1ms interval pushes the cursor 100ms out.
    expect(second).toBeGreaterThanOrEqual(95)
    expect(second).toBeLessThanOrEqual(100)
  })
})

describe('reportRetryAfter', () => {
  it("delays a different caller's next reservation", async () => {
    const quota = fastQuota('shared-429')

    // Process A takes a 429 and publishes it.
    await reportRetryAfter(quota, 150)

    // Process B (same quota, no shared memory) reserves next.
    const waited = await acquireSlot(quota)

    expect(waited).toBeGreaterThan(100)
    expect(waited).toBeLessThanOrEqual(150)
  })

  it('takes the max, never the sum — a smaller Retry-After cannot shorten the cursor', async () => {
    const quota = fastQuota('max-not-add')
    const key = quotaCursorKey(quota)

    await reportRetryAfter(quota, 200)
    const afterLong = store.get(key)!

    await reportRetryAfter(quota, 20)
    const afterShort = store.get(key)!

    expect(afterShort).toBe(afterLong)
  })

  it('does not compound repeated reports into a stall', async () => {
    const quota = fastQuota('compound')
    const key = quotaCursorKey(quota)

    await reportRetryAfter(quota, 200)
    await reportRetryAfter(quota, 200)
    await reportRetryAfter(quota, 200)

    // An additive push would sit ~600ms out; a max sits ~200ms out.
    expect(store.get(key)! - Date.now()).toBeLessThanOrEqual(200)
  })

  it('ignores a non-positive Retry-After', async () => {
    const quota = fastQuota('zero')
    await reportRetryAfter(quota, 0)
    expect(store.size).toBe(0)
  })

  it('backs off in-process when Redis is unavailable', async () => {
    redisAvailable = false
    const quota = fastQuota('offline-429')

    await reportRetryAfter(quota, 120)
    const waited = await acquireSlot(quota)

    expect(waited).toBeGreaterThan(80)
    expect(waited).toBeLessThanOrEqual(120)
  })
})
