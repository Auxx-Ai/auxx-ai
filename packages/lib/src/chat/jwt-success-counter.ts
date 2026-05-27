// packages/lib/src/chat/jwt-success-counter.ts

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'

const log = createScopedLogger('chat-jwt-success-counter')

/** Sliding 7-day window. Each successful verify refreshes the TTL. */
const COUNTER_TTL_SECONDS = 7 * 24 * 60 * 60

function counterKey(channelId: string): string {
  return `chat-jwt-success:${channelId}`
}

/**
 * Bump the per-channel "successfully verified JWT" counter after a positive
 * verification. The enforcement state-machine reads this counter to decide
 * whether the `in_progress → enforced` transition is allowed — a channel
 * that has not seen any valid JWT cannot enforce, or it would lock itself
 * out the moment we flip the gate.
 *
 * Sliding TTL: if a customer stops signing for a week, the counter expires
 * and the channel has to prove signing works again before re-enforcing.
 * Best-effort — Redis hiccups are logged but never thrown.
 */
export async function recordChatJwtSuccess(channelId: string): Promise<void> {
  try {
    const redis = await getRedisClient()
    if (!redis) return
    const key = counterKey(channelId)
    await redis.incr(key)
    await redis.expire(key, COUNTER_TTL_SECONDS)
  } catch (error) {
    log.warn('Failed to record chat JWT success', {
      channelId,
      error: (error as Error).message,
    })
  }
}

/**
 * Read the current count. Returns 0 when the key is missing or unreadable —
 * the caller is responsible for treating that as "no successful verify
 * inside the TTL", which gates the enforce action.
 */
export async function getChatJwtSuccessCount(channelId: string): Promise<number> {
  try {
    const redis = await getRedisClient()
    if (!redis) return 0
    const raw = await redis.get(counterKey(channelId))
    if (!raw) return 0
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : 0
  } catch (error) {
    log.warn('Failed to read chat JWT success count', {
      channelId,
      error: (error as Error).message,
    })
    return 0
  }
}
