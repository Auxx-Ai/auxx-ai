// packages/lib/src/utils/rate-limiter/pacer.ts
// The shared pacer: one Redis cursor per {@link Quota} that every process reserves
// slots from, so N workers on one API key stay under the configured rate COMBINED.
//
// Two ideas carry the whole design:
//
//  1. **Pace, don't reject.** A caller reserves the next free slot and sleeps until
//     it, instead of being refused and recovering through exponential-backoff retry.
//     That removes the need for a priority queue, a `queue: true` flag on every call,
//     and a circuit breaker on the common path.
//  2. **`Retry-After` rides the same cursor.** A 429 seen by ANY process pushes the
//     shared cursor forward, so every other process's next reservation lands past it
//     automatically. Proactive pacing and cross-process reactive backoff, one key,
//     no extra round trip on the hot path.
//
// Both operations are single Lua scripts: one round trip, fully atomic. A read-
// modify-write (GET, compute in JS, SET) cannot provide this — two processes read the
// same cursor and both admit — which is precisely the guarantee `RedisRateLimiter`
// fails to deliver despite being "Redis-backed".
//
// `now` is passed in by the caller rather than read via `redis.call('TIME')` so the
// scripts stay deterministic and replica-safe. Clock skew between app processes is the
// trade; on one container platform it is far below one interval.

import { createHash } from 'node:crypto'
import { getRedisClient, type RedisClient } from '@auxx/redis'
import { RateLimitError } from '../../errors'
import { createScopedLogger } from '../../logger'
import { type Quota, quotaCursorKey } from './quota'

const logger = createScopedLogger('rate-limiter-pacer')

/**
 * The cursor TTL must exceed the maximum look-ahead (`burstMs`) with margin — if it
 * expires mid-flight the cursor evaporates and the limiter silently resets to
 * unthrottled.
 */
const CURSOR_TTL_MARGIN_MS = 60_000

/** Cap on the in-process fallback map, so an unbounded key space can't leak. */
const MAX_LOCAL_CURSORS = 5_000

/**
 * Reserve one cost-weighted slot on the shared cursor.
 *
 * `KEYS[1]` = cursor key. `ARGV` = now, intervalMs, burstMs, cost, ttlMs.
 * Returns `{admitted, waitMs}`.
 *
 * The burst check runs BEFORE the write, so a refused reservation costs nothing. A
 * bare `INCRBY` can only check after incrementing, which permanently shifts the cursor
 * forward every time a caller gives up — and `DECRBY` to compensate reintroduces the
 * race. Re-anchoring an idle cursor (`cursor < now`) is likewise free and exact here,
 * where outside a script it is a two-command check-then-set that two processes can
 * interleave into a backdated slot.
 *
 * The cursor is written through `string.format('%d', …)` because Lua's default number
 * formatting is `%.14g` — a millisecond epoch plus a fraction exceeds 14 significant
 * digits and would round into scientific notation, silently corrupting the cursor.
 */
const RESERVE_SCRIPT = `
local now      = tonumber(ARGV[1])
local interval = tonumber(ARGV[2]) * tonumber(ARGV[4])
local burst    = tonumber(ARGV[3])
local ttl      = tonumber(ARGV[5])
local cursor   = tonumber(redis.call('GET', KEYS[1])) or 0

if cursor < now then cursor = now end

local wait = cursor - now
if wait > burst then
  return {0, wait}
end

redis.call('SET', KEYS[1], string.format('%d', math.floor(cursor + interval)), 'PX', ttl)
return {1, wait}
`.trim()

/**
 * Fold an observed `Retry-After` into the shared cursor as a **max**, never an add.
 *
 * `KEYS[1]` = cursor key. `ARGV` = now, retryAfterMs, ttlMs. Returns 1 when it moved
 * the cursor.
 *
 * Adding is a correctness bug, not a wart: a blind `INCRBY(key, 2000)` on a cursor
 * already 5s ahead yields 7s instead of the correct 5s, and repeated 429s compound
 * that into a stall.
 */
const RETRY_AFTER_SCRIPT = `
local cursor = tonumber(redis.call('GET', KEYS[1])) or 0
local target = tonumber(ARGV[1]) + tonumber(ARGV[2])

if target > cursor then
  redis.call('SET', KEYS[1], string.format('%d', math.floor(target)), 'PX', tonumber(ARGV[3]))
  return 1
end
return 0
`.trim()

/** Memoized `sha1(script)` — the digest is deterministic, this just avoids rehashing. */
const scriptShas = new Map<string, string>()

/** In-process cursors, used when Redis is unavailable (§ Redis-down behavior). */
const localCursors = new Map<string, number>()

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function isNoScriptError(error: unknown): boolean {
  return String((error as Error)?.message ?? '').includes('NOSCRIPT')
}

/**
 * Run a script by digest, re-sending the body once on `NOSCRIPT`. The body is ~400
 * bytes; shipping it on every request is pure waste, and `EVAL` re-caches it server
 * side under the same digest, so the fallback is self-healing.
 */
async function runScript(
  redis: RedisClient,
  script: string,
  key: string,
  argv: (string | number)[]
): Promise<unknown> {
  let sha = scriptShas.get(script)
  if (!sha) {
    sha = createHash('sha1').update(script).digest('hex')
    scriptShas.set(script, sha)
  }

  try {
    return await redis.evalsha(sha, 1, key, ...argv)
  } catch (error) {
    if (!isNoScriptError(error)) throw error
    return await redis.eval(script, 1, key, ...argv)
  }
}

/** Coerce a `{admitted, waitMs}` reply from either provider's array encoding. */
function readReservation(reply: unknown): { admitted: boolean; waitMs: number } {
  const pair = Array.isArray(reply) ? reply : []
  return { admitted: Number(pair[0]) === 1, waitMs: Math.max(0, Number(pair[1]) || 0) }
}

/** Drop cursors that are already in the past once the map grows too large. */
function pruneLocalCursors(now: number): void {
  if (localCursors.size <= MAX_LOCAL_CURSORS) return
  for (const [key, cursor] of localCursors) {
    if (cursor <= now) localCursors.delete(key)
  }
}

/** The in-process mirror of {@link RESERVE_SCRIPT}. Same arithmetic, one process. */
function reserveLocally(
  key: string,
  now: number,
  intervalMs: number,
  burstMs: number
): { admitted: boolean; waitMs: number } {
  let cursor = localCursors.get(key) ?? 0
  if (cursor < now) cursor = now

  const waitMs = cursor - now
  if (waitMs > burstMs) return { admitted: false, waitMs }

  localCursors.set(key, cursor + intervalMs)
  pruneLocalCursors(now)
  return { admitted: true, waitMs }
}

/** Redis when it's up, `null` otherwise — never throws. */
async function tryGetRedis(): Promise<RedisClient | null> {
  try {
    return (await getRedisClient(false)) ?? null
  } catch {
    return null
  }
}

/**
 * Reserve the next slot on `quota`'s shared cursor and sleep until it is due.
 *
 * @param quota - The metered budget to draw from.
 * @param opts.cost - Quota units this call consumes (Gmail's `messages.send` is 100,
 *   not 1). Multiplies the reservation width; defaults to 1.
 * @param opts.signal - Aborts the sleep, so a cancelled slice never parks.
 * @returns Milliseconds actually slept — fold this into a run ledger's rate-limit wait.
 * @throws {RateLimitError} When the next free slot is past `quota.burstMs`. The
 *   reservation is NOT consumed in that case, so the cursor is unmoved and a later
 *   caller sees the same budget.
 *
 * Degrades to an in-process cursor when Redis is unavailable — i.e. per-process
 * pacing, which is still correct for a single worker. Explicit, not silently
 * best-effort.
 */
export async function acquireSlot(
  quota: Quota,
  opts: { cost?: number; signal?: AbortSignal } = {}
): Promise<number> {
  const key = quotaCursorKey(quota)
  const cost = Math.max(1, Math.round(opts.cost ?? 1))
  const intervalMs = Math.max(1, Math.ceil(1000 / quota.rps))
  const ttlMs = quota.burstMs + CURSOR_TTL_MARGIN_MS
  const now = Date.now()

  let outcome: { admitted: boolean; waitMs: number } | undefined
  const redis = await tryGetRedis()
  if (redis) {
    try {
      outcome = readReservation(
        await runScript(redis, RESERVE_SCRIPT, key, [now, intervalMs, quota.burstMs, cost, ttlMs])
      )
    } catch (error) {
      logger.warn('Slot reservation failed in Redis; pacing in-process for this call', {
        key,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  outcome ??= reserveLocally(key, now, intervalMs * cost, quota.burstMs)

  if (!outcome.admitted) {
    throw new RateLimitError(
      `Rate limit budget exhausted for ${key}: the next slot is ${outcome.waitMs}ms out, ` +
        `past the ${quota.burstMs}ms burst ceiling`,
      Math.ceil(outcome.waitMs / 1000)
    )
  }

  if (outcome.waitMs > 0) await sleep(outcome.waitMs, opts.signal)
  return outcome.waitMs
}

/**
 * Publish an observed `Retry-After` to every process sharing `quota`.
 *
 * Call this the moment a 429 (or a provider-specific throttle signal) is seen, BEFORE
 * sleeping — the next {@link acquireSlot} on this quota, in this process or any other,
 * then lands past the retry point on its own. Never-throws: a failed report degrades
 * to process-local backoff, it must not turn a retryable 429 into a hard failure.
 *
 * @param quota - The budget the throttle applies to.
 * @param retryAfterMs - How far out the upstream says the next attempt may be.
 */
export async function reportRetryAfter(quota: Quota, retryAfterMs: number): Promise<void> {
  if (!(retryAfterMs > 0)) return

  const key = quotaCursorKey(quota)
  const now = Date.now()
  // The TTL has to outlive the push itself, not just the burst window.
  const ttlMs = Math.max(quota.burstMs, retryAfterMs) + CURSOR_TTL_MARGIN_MS

  const redis = await tryGetRedis()
  if (redis) {
    try {
      await runScript(redis, RETRY_AFTER_SCRIPT, key, [now, Math.ceil(retryAfterMs), ttlMs])
      return
    } catch (error) {
      logger.warn('Retry-After report failed in Redis; backing off in-process only', {
        key,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const target = now + retryAfterMs
  if (target > (localCursors.get(key) ?? 0)) localCursors.set(key, target)
}

/** Test seam — drops the in-process cursors and the memoized script digests. */
export function resetPacerState(): void {
  localCursors.clear()
  scriptShas.clear()
}
