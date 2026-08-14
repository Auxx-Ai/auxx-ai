// packages/lib/src/jobs/messages/outlook-push-sync-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { eq } from 'drizzle-orm'
import { type ChannelProviderType, MessageService } from '../../email/message-service'
import { getQueue, Queues } from '../queues'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:outlook-push-sync')

/** Job payload — the one Graph delta cursor lives on the integration, nothing else to pass. */
export interface OutlookPushSyncJobData {
  integrationId: string
  organizationId: string
}

/**
 * A burst of Graph notifications for the same mailbox collapses into one delta walk per
 * window: every notification arriving inside a given 15s slice resolves to the same
 * `outlookPushSyncJobId`, so BullMQ's dedupe-by-jobId does the coalescing for free.
 */
export const OUTLOOK_PUSH_DEBOUNCE_WINDOW_MS = 15_000

/**
 * Deterministic jobId for the debounce window containing `at` (defaults to now). Two
 * notifications landing in the same 15s window produce the same id; BullMQ then rejects the
 * second `add` as a duplicate instead of queuing a second delta walk.
 */
export function outlookPushSyncJobId(integrationId: string, at: number = Date.now()): string {
  return `outlook-push-${integrationId}-${Math.floor(at / OUTLOOK_PUSH_DEBOUNCE_WINDOW_MS)}`
}

/**
 * Enqueue (or coalesce into) an Outlook push-sync job. Callers include the webhook route (on
 * `created`/`updated` notifications) and the job body itself, which re-enqueues into the *next*
 * window when it loses the per-integration lock (see {@link outlookPushSyncJob}).
 *
 * "Already exists" from BullMQ means another notification already coalesced into this window —
 * that is the intended outcome, not a failure, so it is swallowed rather than thrown.
 */
export async function enqueueOutlookPushSync(
  data: OutlookPushSyncJobData,
  opts?: { delay?: number }
): Promise<void> {
  const delay = opts?.delay
  const jobId = outlookPushSyncJobId(data.integrationId, Date.now() + (delay ?? 0))
  const queue = getQueue(Queues.messageSyncQueue)

  try {
    await queue.add('outlookPushSyncJob', data, {
      jobId,
      delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    })
  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      logger.debug('Outlook push sync already queued for this debounce window', {
        integrationId: data.integrationId,
        jobId,
      })
      return
    }
    throw error
  }
}

/**
 * Outlook push-sync job body — what a Graph change notification enqueues instead of running the
 * delta walk inline.
 *
 * Why enqueue instead of sync inline: Graph requires a 2xx within 3 seconds of delivering a
 * notification or it marks the endpoint slow/drop and starts dropping mail (plan §2.3). A full
 * delta walk + ingest is far outside that budget on any non-trivial mailbox, so the webhook route
 * only validates and enqueues; this job does the actual work off the request path.
 *
 * Why the per-integration lock: the debounce window (jobId coalescing) only prevents a *burst* of
 * notifications from enqueuing multiple jobs — it does not stop two already-enqueued jobs from
 * running concurrently once the message-sync worker's `concurrency: 5` picks them both up (e.g. a
 * notification landing while the previous window's job is still mid-walk). `syncMessages` has no
 * guard of its own, and `outlook-provider.ts` deliberately *holds* the stored delta cursor on a
 * retriable ingest failure so the same batch is retried next time — two concurrent walks from
 * that same stored cursor can race, with the clean run advancing the cursor past the failed
 * run's unretried batch. The Redis lock is the only thing serializing the cursor; when it's
 * held, this job re-enqueues into the next debounce window instead of racing.
 */
export const outlookPushSyncJob = async (
  ctx: JobContext<OutlookPushSyncJobData>
): Promise<void> => {
  const { integrationId, organizationId } = ctx.job.data

  const [row] = await db
    .select({
      id: schema.Integration.id,
      deletedAt: schema.Integration.deletedAt,
      enabled: schema.Integration.enabled,
      requiresReauth: schema.Credential.requiresReauth,
    })
    .from(schema.Integration)
    .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
    .where(eq(schema.Integration.id, integrationId))
    .limit(1)

  // Notifications keep arriving for a broken or removed channel — bail before paying for a full
  // provider init that would only fail anyway.
  if (!row || row.deletedAt || !row.enabled || row.requiresReauth) {
    logger.info('Skipping outlook push sync — integration not eligible', {
      integrationId,
      missing: !row,
      deleted: !!row?.deletedAt,
      enabled: row?.enabled,
      requiresReauth: row?.requiresReauth,
    })
    return
  }

  const redis = await getRedisClient()
  const lockKey = `outlook-push-sync:${integrationId}`
  let acquired = false

  if (redis) {
    acquired = !!(await redis.set(lockKey, String(ctx.job.id ?? '1'), 'PX', 240_000, 'NX'))

    if (!acquired) {
      const now = Date.now()
      const nextWindowStart =
        (Math.floor(now / OUTLOOK_PUSH_DEBOUNCE_WINDOW_MS) + 1) * OUTLOOK_PUSH_DEBOUNCE_WINDOW_MS
      const delay = nextWindowStart - now + 1000
      logger.info('Outlook push sync lock held — re-enqueuing into next debounce window', {
        integrationId,
        delay,
      })
      await enqueueOutlookPushSync({ integrationId, organizationId }, { delay })
      return
    }
  } else {
    // Redis down means the whole import pipeline (import cache, cross-job locks) is already
    // degraded — proceed unlocked rather than dropping the notification entirely.
    logger.warn('Redis unavailable — running outlook push sync unlocked', { integrationId })
  }

  try {
    // Sync errors are intentionally left to throw — BullMQ retries per this job's `attempts`,
    // and the subscription health job (Phase 4) is the backstop beyond that.
    await new MessageService(organizationId).syncMessages(
      'outlook' as ChannelProviderType,
      integrationId
    )
  } finally {
    if (acquired && redis) {
      await redis.del(lockKey)
    }
  }
}
