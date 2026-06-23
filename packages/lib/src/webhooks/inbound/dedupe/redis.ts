// packages/lib/src/webhooks/inbound/dedupe/redis.ts
// Receiver-level idempotency: Redis SET NX + TTL. Returns true when the event was
// already seen (a duplicate delivery to drop). Redis down → false (process it; better
// a dup than a miss, and downstream sinks dedupe too).

import { getRedisClient } from '@auxx/redis'

/** SET NX a `${namespace}:${eventKey}` marker. Returns true if it already existed. */
export async function dedupeWebhookEvent(
  namespace: string,
  eventKey: string,
  ttlSec = 600
): Promise<boolean> {
  try {
    const redis = await getRedisClient(false)
    if (!redis) return false
    const key = `${namespace}:${eventKey}`
    const set = await redis.set(key, '1', 'EX', ttlSec, 'NX')
    return !set
  } catch {
    return false
  }
}
