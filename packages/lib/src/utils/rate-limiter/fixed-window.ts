// packages/lib/src/utils/rate-limiter/fixed-window.ts

import { getRedisClient } from '@auxx/redis'

export interface FixedWindowResult {
  /** False when the key is over its limit for the current window. */
  allowed: boolean
  /** Hits recorded in the window including this one (0 when Redis is unavailable). */
  count: number
  /** Milliseconds until the window resets; only set when blocked. */
  remainingMs?: number
}

/**
 * Atomic fixed-window rate limit check (INCR + PEXPIRE). Counts the call and reports
 * whether the key is within `limit` for the current window. Fails open when Redis is
 * unavailable or errors — use for guardrail limits, not billing-critical enforcement.
 */
export async function checkFixedWindowLimit(opts: {
  key: string
  limit: number
  windowMs: number
}): Promise<FixedWindowResult> {
  const redis = await getRedisClient(false)
  if (!redis) return { allowed: true, count: 0 }

  try {
    const count = await redis.incr(opts.key)
    if (count === 1) await redis.pexpire(opts.key, opts.windowMs)
    if (count <= opts.limit) return { allowed: true, count }

    const remainingMs = await redis.pttl(opts.key)
    return { allowed: false, count, ...(remainingMs > 0 ? { remainingMs } : {}) }
  } catch {
    return { allowed: true, count: 0 }
  }
}
