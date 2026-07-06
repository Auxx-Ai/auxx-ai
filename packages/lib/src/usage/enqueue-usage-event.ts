// packages/lib/src/usage/enqueue-usage-event.ts

import { getRedisClient } from '@auxx/redis'
import { generateId } from '@auxx/utils'
import type { RecordUsageEventJobData } from './types'

/**
 * Redis list holding buffered usage events as JSON strings.
 * `flushUsageEventsJob` drains it into Postgres on a schedule.
 */
export const USAGE_EVENT_BUFFER_KEY = 'usage:events:buffer'

/**
 * Buffer a usage event in Redis for periodic batch insertion into Postgres.
 *
 * Redis is already the authoritative counter (UsageCounter INCRBY); the Postgres
 * row is a durable audit trail read only when a Redis counter needs rebuilding,
 * so a flush delay of a minute is harmless. Each event gets an idempotency
 * `eventId` here so a retried flush batch can't double-count.
 */
export async function enqueueUsageEvent(data: RecordUsageEventJobData): Promise<void> {
  const redis = await getRedisClient()
  if (!redis) throw new Error('Redis unavailable, usage event dropped')

  await redis.rpush(
    USAGE_EVENT_BUFFER_KEY,
    JSON.stringify({ ...data, eventId: data.eventId ?? generateId() })
  )
}
