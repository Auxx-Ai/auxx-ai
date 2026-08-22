// packages/lib/src/files/__tests__/support/redis.ts

/**
 * A `Map`-backed Redis double for `upload/session.ts`.
 *
 * The whole reason `redis` became a parameter: the session lifecycle used to be
 * testable only through `vi.mock('@auxx/redis')` at hoist scope. Here it is a
 * plain object handed in as an argument, so a session test mocks nothing.
 *
 * ## It enforces the parts of the real contract the bugs depend on
 *
 * - `SETEX` rejects a non-positive expiry, exactly as ioredis does
 *   (`ERR invalid expire time in 'setex' command`) — that error *is* the Tier-1
 *   §1.6 failure, so a double that accepted it would pass while production 500s.
 * - Keys really expire: `get` stops answering once the clock passes the expiry.
 * - Expiry is driven by the **injected clock**, not `Date.now()`, so a test steps
 *   across a TTL boundary with `clock.advance(...)` instead of `vi.useFakeTimers()`.
 *
 * ## `eval` is emulated, not interpreted
 *
 * There is no Lua runtime here. `eval` dispatches on the marker comment in the
 * script's header and runs a JavaScript twin of it. That is a real limitation and
 * worth stating plainly: it proves the *caller's* retry/floor logic, not the Lua
 * itself. Dispatching on the marker rather than accepting any script is what
 * keeps that honest — a second script added to `session.ts` fails loudly here
 * instead of silently inheriting compare-and-set semantics.
 */

import type { UploadSessionRedis } from '../../upload/session'

/** Marker in the header of the compare-and-set script `upload/session.ts` runs. */
const CAS_SET_MARKER = '-- auxx:upload-session:cas-set'

interface Entry {
  value: string
  /** Absolute expiry in milliseconds, on the injected clock. */
  expiresAtMs: number
}

/** One recorded command, in call order. */
export interface RedisCommand {
  op: 'get' | 'setex' | 'del' | 'pttl' | 'eval'
  key: string
}

export interface MakeRedisOptions {
  /** The clock keys expire against. Defaults to a fixed instant that never moves. */
  now?: () => Date
}

export interface FakeRedis {
  /** Pass this where a function wants its Redis. */
  redis: UploadSessionRedis
  /** Every command issued, in order. */
  commands: RedisCommand[]
  /** The `op` strings, for a one-line `toEqual`. */
  ops(): string[]
  /** Live keys only. */
  keys(): string[]
  /** Remaining lifetime in milliseconds; `-2` when the key is gone, mirroring `PTTL`. */
  pttlOf(key: string): number
  /** The stored value, or `null`. Bypasses nothing — expiry still applies. */
  raw(key: string): string | null
  /** Seed a key directly, for tests that need a state the API cannot produce. */
  seed(key: string, value: string, ttlMs: number): void
  /** Drop every key and every recorded command. */
  reset(): void
}

/** Build a Redis double whose keys expire against `options.now`. */
export function makeRedis(options: MakeRedisOptions = {}): FakeRedis {
  const store = new Map<string, Entry>()
  const commands: RedisCommand[] = []
  const nowMs = () => (options.now ? options.now().getTime() : 0)

  const live = (key: string): Entry | undefined => {
    const entry = store.get(key)
    if (!entry) return undefined
    if (entry.expiresAtMs <= nowMs()) {
      store.delete(key)
      return undefined
    }
    return entry
  }

  const record = (op: RedisCommand['op'], key: string) => {
    commands.push({ op, key })
  }

  const redis: UploadSessionRedis = {
    get: async (key) => {
      record('get', key)
      return live(key)?.value ?? null
    },

    setex: async (key, seconds, value) => {
      record('setex', key)
      // ioredis rejects a non-positive expiry. Keeping that here is the point.
      if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new Error("ERR invalid expire time in 'setex' command")
      }
      store.set(key, { value, expiresAtMs: nowMs() + seconds * 1000 })
      return 'OK'
    },

    del: async (key) => {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) record('del', k)
      return keys.filter((k) => store.delete(k)).length
    },

    pttl: async (key) => {
      record('pttl', key)
      const entry = live(key)
      return entry ? entry.expiresAtMs - nowMs() : -2
    },

    eval: async (script, numKeys, ...args) => {
      if (!script.includes(CAS_SET_MARKER)) {
        throw new Error(
          `makeRedis().eval received an unrecognised script; add a twin for it in support/redis.ts:\n${script}`
        )
      }
      if (numKeys !== 1) {
        throw new Error(`makeRedis().eval expected one key for the CAS script, got ${numKeys}`)
      }

      const [key, expected, next, ttlMs] = args as [string, string, string, string]
      record('eval', key)

      const entry = live(key)
      if (!entry) return -1
      if (entry.value !== expected) return 0

      const ttl = Number(ttlMs)
      if (!Number.isFinite(ttl) || ttl <= 0) {
        throw new Error("ERR invalid expire time in 'set' command")
      }
      store.set(key, { value: next, expiresAtMs: nowMs() + ttl })
      return 1
    },
  }

  return {
    redis,
    commands,
    ops: () => commands.map((c) => c.op),
    keys: () => [...store.keys()].filter((key) => live(key) !== undefined),
    pttlOf: (key) => {
      const entry = live(key)
      return entry ? entry.expiresAtMs - nowMs() : -2
    },
    raw: (key) => live(key)?.value ?? null,
    seed: (key, value, ttlMs) => {
      store.set(key, { value, expiresAtMs: nowMs() + ttlMs })
    },
    reset: () => {
      store.clear()
      commands.length = 0
    },
  }
}
