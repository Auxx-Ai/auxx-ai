// packages/lib/src/cache/counter-cache.ts

import { getRedisClient } from '@auxx/redis'

/**
 * A Redis-hash-backed counter set. Unlike the JSON cache services, fields are
 * mutated with atomic HINCRBY deltas — no read-modify-write races. Callers own
 * the field naming; values are always numbers.
 */
export interface CounterHash {
  /** All fields in one roundtrip. `null` = cache miss (caller should seed). */
  readAll(): Promise<Record<string, number> | null>
  /** Full overwrite (DEL + HSET + EXPIRE) — used on miss and by reconciliation. */
  seed(fields: Record<string, number>): Promise<void>
  /**
   * Atomic increments via a single pipeline. No-op when the hash doesn't
   * exist — a missing hash must be seeded from source, not grown from zero.
   */
  applyDeltas(deltas: Record<string, number>): Promise<void>
  /** Delete individual fields (e.g. a staleness marker). */
  removeFields(...fields: string[]): Promise<void>
}

/** Create a handle for one counter hash at `key` with a fixed TTL. */
export function counterHash(key: string, ttlSeconds: number): CounterHash {
  return {
    async readAll() {
      const redis = await getRedisClient()
      const raw = await redis.hgetall(key)
      if (!raw || Object.keys(raw).length === 0) return null
      return Object.fromEntries(Object.entries(raw).map(([field, v]) => [field, Number(v) || 0]))
    },

    async seed(fields) {
      if (Object.keys(fields).length === 0) return
      const redis = await getRedisClient()
      const pipe = redis.pipeline()
      pipe.del(key)
      pipe.hset(key, fields)
      pipe.expire(key, ttlSeconds)
      await pipe.exec()
    },

    async applyDeltas(deltas) {
      const entries = Object.entries(deltas).filter(([, delta]) => delta !== 0)
      if (entries.length === 0) return
      const redis = await getRedisClient()
      // EXISTS guard: HINCRBY on a missing hash would materialize counters
      // with a base of 0 instead of the real value. The check-then-write race
      // (hash expires in between) is tolerated — reconciliation heals it.
      if ((await redis.exists(key)) !== 1) return
      const pipe = redis.pipeline()
      for (const [field, delta] of entries) {
        pipe.hincrby(key, field, delta)
      }
      await pipe.exec()
    },

    async removeFields(...fields) {
      if (fields.length === 0) return
      const redis = await getRedisClient()
      await redis.hdel(key, ...fields)
    },
  }
}
