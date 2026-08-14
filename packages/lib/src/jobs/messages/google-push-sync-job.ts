// packages/lib/src/jobs/messages/google-push-sync-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { eq } from 'drizzle-orm'
import { type ChannelProviderType, MessageService } from '../../email/message-service'
import { getQueue, Queues } from '../queues'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:google-push-sync')

/** Job payload — the one Gmail history cursor lives on the integration, nothing else to pass. */
export interface GooglePushSyncJobData {
  integrationId: string
  organizationId: string
}

/**
 * A burst of Pub/Sub notifications for the same mailbox collapses into one history sync per
 * window: every notification arriving inside a given 15s slice resolves to the same
 * `googlePushSyncJobId`, so BullMQ's dedupe-by-jobId does the coalescing for free. Defined
 * locally (not shared with `OUTLOOK_PUSH_DEBOUNCE_WINDOW_MS`) to keep the two provider job
 * modules independent.
 */
export const GOOGLE_PUSH_DEBOUNCE_WINDOW_MS = 15_000

/**
 * Deterministic jobId for the debounce window containing `at` (defaults to now). Two
 * notifications landing in the same 15s window produce the same id; BullMQ then rejects the
 * second `add` as a duplicate instead of queuing a second history sync.
 */
export function googlePushSyncJobId(integrationId: string, at: number = Date.now()): string {
  return `google-push-${integrationId}-${Math.floor(at / GOOGLE_PUSH_DEBOUNCE_WINDOW_MS)}`
}

/**
 * Enqueue (or coalesce into) a Google push-sync job. Callers include the webhook route (on a
 * fresh Pub/Sub history notification) and the job body itself, which re-enqueues into the *next*
 * window when it loses the per-integration lock (see {@link googlePushSyncJob}).
 *
 * "Already exists" from BullMQ means another notification already coalesced into this window —
 * that is the intended outcome, not a failure, so it is swallowed rather than thrown.
 */
export async function enqueueGooglePushSync(
  data: GooglePushSyncJobData,
  opts?: { delay?: number }
): Promise<void> {
  const delay = opts?.delay
  const jobId = googlePushSyncJobId(data.integrationId, Date.now() + (delay ?? 0))
  const queue = getQueue(Queues.messageSyncQueue)

  try {
    await queue.add('googlePushSyncJob', data, {
      jobId,
      delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    })
  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      logger.debug('Google push sync already queued for this debounce window', {
        integrationId: data.integrationId,
        jobId,
      })
      return
    }
    throw error
  }
}

/**
 * Google push-sync job body — what a Pub/Sub Gmail notification enqueues instead of running the
 * history sync inline.
 *
 * Why enqueue instead of sync inline: Pub/Sub redelivers a push notification on a slow or failed
 * ack, and a full history sync + ingest can run well outside an ack-friendly window on a busy
 * mailbox — same 3xx/2xx ack-budget shape as Graph's push webhook (webhook-push-migration plan
 * §2.3/§6), so the route only validates, resolves the integration, and enqueues; this job does
 * the actual work off the request path.
 *
 * Why the per-integration lock: the debounce window (jobId coalescing) only prevents a *burst* of
 * notifications from enqueuing multiple jobs — it does not stop two already-enqueued jobs from
 * running concurrently once the message-sync worker's `concurrency: 5` picks them both up (e.g. a
 * redelivered notification landing while the previous window's job is still mid-sync).
 * `MessageService.syncMessages` has no guard of its own, and Gmail's history cursor
 * (`Integration.lastHistoryId`) has the same concurrent-advance race Outlook's `graphDeltaLink`
 * has — two concurrent syncs from the same stored cursor can race, with one run's advance
 * silently stepping over the other's unretried batch. The Redis lock is the only thing
 * serializing that cursor; when it's held, this job re-enqueues into the next debounce window
 * instead of racing.
 */
export const googlePushSyncJob = async (ctx: JobContext<GooglePushSyncJobData>): Promise<void> => {
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
    logger.info('Skipping google push sync — integration not eligible', {
      integrationId,
      missing: !row,
      deleted: !!row?.deletedAt,
      enabled: row?.enabled,
      requiresReauth: row?.requiresReauth,
    })
    return
  }

  const redis = await getRedisClient()
  const lockKey = `google-push-sync:${integrationId}`
  let acquired = false

  if (redis) {
    acquired = !!(await redis.set(lockKey, String(ctx.job.id ?? '1'), 'PX', 240_000, 'NX'))

    if (!acquired) {
      const now = Date.now()
      const nextWindowStart =
        (Math.floor(now / GOOGLE_PUSH_DEBOUNCE_WINDOW_MS) + 1) * GOOGLE_PUSH_DEBOUNCE_WINDOW_MS
      const delay = nextWindowStart - now + 1000
      logger.info('Google push sync lock held — re-enqueuing into next debounce window', {
        integrationId,
        delay,
      })
      await enqueueGooglePushSync({ integrationId, organizationId }, { delay })
      return
    }
  } else {
    // Redis down means the whole import pipeline (import cache, cross-job locks) is already
    // degraded — proceed unlocked rather than dropping the notification entirely.
    logger.warn('Redis unavailable — running google push sync unlocked', { integrationId })
  }

  try {
    // Sync errors are intentionally left to throw — BullMQ retries per this job's `attempts`.
    await new MessageService(organizationId).syncMessages(
      'google' as ChannelProviderType,
      integrationId
    )
  } finally {
    if (acquired && redis) {
      await redis.del(lockKey)
    }
  }
}
