// packages/lib/src/usage/flush-usage-events-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import type { JobContext } from '../jobs/types/job-context'
import { USAGE_EVENT_BUFFER_KEY } from './enqueue-usage-event'
import type { RecordUsageEventJobData } from './types'

const logger = createScopedLogger('flush-usage-events-job')

/** Max events per INSERT statement */
const BATCH_SIZE = 500

/**
 * Scheduled BullMQ job: drains the Redis usage-event buffer into Postgres as
 * batch inserts (was one job + one INSERT per metered event).
 *
 * Failure handling: a failed batch is pushed back onto the buffer and the job
 * throws (BullMQ retries). If the INSERT actually committed before the error,
 * the `eventId` unique index + ON CONFLICT DO NOTHING makes the replay a no-op.
 * Order across events is irrelevant — every reader is a SUM over quantities.
 */
export async function flushUsageEventsJob(_ctx: JobContext): Promise<void> {
  const redis = await getRedisClient(false)
  if (!redis) return

  let flushed = 0
  while (true) {
    const popped = await redis.lpop(USAGE_EVENT_BUFFER_KEY, BATCH_SIZE)
    if (!popped || popped.length === 0) break
    const raw = Array.isArray(popped) ? popped : [popped]

    const events: RecordUsageEventJobData[] = []
    for (const item of raw) {
      try {
        events.push(JSON.parse(item) as RecordUsageEventJobData)
      } catch {
        logger.warn('Dropping malformed buffered usage event', { item })
      }
    }
    if (events.length === 0) continue

    try {
      await db
        .insert(schema.UsageEvent)
        .values(
          events.map((e) => ({
            eventId: e.eventId ?? null,
            organizationId: e.orgId,
            userId: e.userId ?? null,
            metric: e.metric,
            quantity: e.quantity,
            metadata: e.metadata ?? null,
            periodKey: e.periodKey,
            // Preserve the original event time (createdAt would default to flush time)
            ...(Number.isFinite(e.timestamp) ? { createdAt: new Date(e.timestamp) } : {}),
          }))
        )
        .onConflictDoNothing({ target: schema.UsageEvent.eventId })
      flushed += events.length
    } catch (error) {
      // Return the batch to the buffer for the next attempt before failing the job
      await redis.rpush(USAGE_EVENT_BUFFER_KEY, ...raw)
      throw error
    }
  }

  if (flushed > 0) {
    logger.debug('Flushed usage events to Postgres', { flushed })
  }
}
