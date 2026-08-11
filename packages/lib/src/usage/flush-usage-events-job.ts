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
 * One buffered event as a `UsageEvent` row.
 *
 * ⚠️ `userId: e.userId || null`, not `?? null`. `UsageEvent.userId` is a FK to
 * `User.id`, so an empty string is a user id that does not exist and the row is
 * rejected — `??` passes `''` straight through, which is how the whole buffer
 * came to be poisoned.
 */
function toRow(e: RecordUsageEventJobData) {
  return {
    eventId: e.eventId ?? null,
    organizationId: e.orgId,
    userId: e.userId || null,
    metric: e.metric,
    quantity: e.quantity,
    metadata: e.metadata ?? null,
    periodKey: e.periodKey,
    // Preserve the original event time (createdAt would default to flush time)
    ...(Number.isFinite(e.timestamp) ? { createdAt: new Date(e.timestamp) } : {}),
  }
}

/**
 * Scheduled BullMQ job: drains the Redis usage-event buffer into Postgres as
 * batch inserts (was one job + one INSERT per metered event).
 *
 * Failure handling: a failed batch is retried ROW BY ROW, and only the rows that
 * still fail are dropped (loudly). If the INSERT actually committed before the
 * error, the `eventId` unique index + ON CONFLICT DO NOTHING makes the replay a
 * no-op. Order across events is irrelevant — every reader is a SUM over
 * quantities.
 *
 * ⚠️ **Why the batch is not pushed back any more.** It used to be: a failed
 * batch went back on the buffer and the job threw. One permanently-bad row
 * therefore recycled forever and every other org's events queued behind it never
 * reached Postgres — metering stopped instance-wide and could not self-heal. That
 * is exactly what happened when mail classification emitted `userId: ''` against
 * a FK to `User.id`. A poison row must cost its own row, never the pipeline.
 */
export async function flushUsageEventsJob(_ctx: JobContext): Promise<void> {
  const redis = await getRedisClient(false)
  if (!redis) return

  let flushed = 0
  let dropped = 0
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

    const rows = events.map(toRow)

    try {
      await db.insert(schema.UsageEvent).values(rows).onConflictDoNothing({
        target: schema.UsageEvent.eventId,
      })
      flushed += events.length
    } catch (error) {
      // One bad row fails the whole multi-row INSERT, and there is no way to tell
      // which from the error. Retry individually so the good ones land.
      logger.warn('Usage-event batch insert failed, falling back to per-row', {
        size: rows.length,
        error: error instanceof Error ? error.message : String(error),
      })
      for (const row of rows) {
        try {
          await db.insert(schema.UsageEvent).values(row).onConflictDoNothing({
            target: schema.UsageEvent.eventId,
          })
          flushed++
        } catch (rowError) {
          // DROPPED, not re-buffered. A row that cannot be inserted now will not
          // become insertable later, and re-buffering it blocks every event
          // behind it forever. Losing one metering row is strictly better than
          // losing all of them, but it is still data loss — hence `error`.
          dropped++
          logger.error('Dropping an unwritable usage event', {
            organizationId: row.organizationId,
            metric: row.metric,
            userId: row.userId,
            error: rowError instanceof Error ? rowError.message : String(rowError),
          })
        }
      }
    }
  }

  if (flushed > 0) {
    logger.debug('Flushed usage events to Postgres', { flushed })
  }
  // Its own line, at `warn`: a drop is billable usage that will never be counted,
  // and it must be visible without reading per-row errors.
  if (dropped > 0) {
    logger.warn('Usage events dropped as unwritable', { dropped, flushed })
  }
}
