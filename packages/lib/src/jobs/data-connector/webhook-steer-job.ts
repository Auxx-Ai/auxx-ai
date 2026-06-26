// packages/lib/src/jobs/data-connector/webhook-steer-job.ts
// The per-(connector, stream) child of the webhook dispatch jobs. Steers the connector's
// regular fetch with the webhook payload and sinks the result as a PARTIAL run
// (runWebhookSteeredRun). Owns the WHOLE failure policy so the thin dispatch jobs stay cheap:
//   • 429 → the fetch sets `maxRetries: 0`, so a throttle surfaces as
//     `ConnectorRateLimitError` immediately; we re-enqueue with `delay = retryAfterMs`
//     instead of burning a BullMQ attempt sleeping under the lock (H1).
//   • other 4xx/5xx → BullMQ's default bounded retries (5, exponential). On the final
//     attempt we capture context to the inspector dead-letter before `removeOnFail`
//     discards the job, then re-throw.
// Split out from the dispatch job (rather than fetching inline) because the dispatch holds a
// redis dedup key under retry — an inline fetch's BullMQ retry would self-suppress on the
// already-claimed key and never re-run. A separate child gets clean, isolated retries.
// Runs on `appTriggerQueue` (concurrency 10) — a higher lane than the 2-slot backfill queue —
// so webhook latency isn't stuck behind bulk syncs.

import { getRedisClient } from '@auxx/redis'
import type { Job } from 'bullmq'
import { createScopedLogger } from '../../logger'
import { getQueue, Queues } from '../queues'
import type { JobContext } from '../types'

const logger = createScopedLogger('data-connector-webhook-steer-job')

/** Job name on `appTriggerQueue` (registered in app-trigger-worker.ts). */
export const WEBHOOK_STEER_JOB = 'data-connector-webhook-steer'

/** Stop re-enqueuing a perpetually-throttled event after this many rate-limit deferrals. */
const MAX_RATE_LIMIT_REENQUEUES = 10

export type ConnectorWebhookSteerJobData = {
  connectorId: string
  streamKey: string
  organizationId: string
  triggerData: Record<string, unknown>
  eventId: string
  /** Present when the steering signal is an APP trigger (DLQ labels off these). */
  appInstallationId?: string
  triggerId?: string
  /** Present when the steering signal is a generic WebhookEndpoint instead. */
  webhookEndpointId?: string
  topic?: string
  /** How many times this event has been deferred for a throttle (re-enqueue guard). */
  rateLimitRetries?: number
}

export async function runConnectorWebhookSteer(
  ctx: JobContext<ConnectorWebhookSteerJobData> | Job<ConnectorWebhookSteerJobData>
) {
  // The worker passes a JobContext whose `.job` is the real BullMQ Job; tolerate a raw Job
  // too. Unwrap so the native fields this handler needs (`opts.attempts`, `attemptsMade`)
  // read off the real job — reading them off the context yields undefined.
  const job = 'throwIfCancelled' in ctx ? ctx.job : ctx
  const { connectorId, streamKey, organizationId, triggerData, eventId } = job.data

  // Lazy-import the heavy data-connectors barrel at call time (it pulls the sink / crud
  // spine) — keeps this job file light and side-effect-free for vitest.
  const { database: db } = await import('@auxx/database')
  const { runWebhookSteeredRun, ConnectorRateLimitError, PermanentSteerError } = await import(
    '../../data-connectors'
  )

  try {
    await runWebhookSteeredRun(db, {
      connectorId,
      organizationId,
      streamKey,
      triggerData,
      eventId,
    })
    return { ok: true }
  } catch (err) {
    if (err instanceof ConnectorRateLimitError) {
      return await deferForThrottle(job, err.retryAfterMs)
    }
    // Permanent (deterministic) failure — e.g. an unresolved `{token}` because the payload
    // path returned nothing. Retrying replays the identical delivery and fails the same way,
    // so dead-letter NOW and return (don't re-throw → no BullMQ retry). The run row was
    // already finalized `failed` by runWebhookSteeredRun.
    if (err instanceof PermanentSteerError) {
      await deadLetter(job, err)
      logger.warn('Connector webhook steer permanent failure — dead-lettered without retry', {
        connectorId,
        streamKey,
        eventId,
        error: err.message,
      })
      return { ok: false, permanent: true }
    }
    // Transient → last attempt dead-letters before `removeOnFail` discards the job, then
    // re-throws so BullMQ records the terminal failure (and retries earlier attempts).
    const maxAttempts = job.opts.attempts ?? 5
    if (job.attemptsMade >= maxAttempts - 1) {
      await deadLetter(job, err)
    }
    throw err
  }
}

/** Re-enqueue the event after the provider's Retry-After, capped to avoid a hot loop. */
async function deferForThrottle(job: Job<ConnectorWebhookSteerJobData>, retryAfterMs?: number) {
  const retries = (job.data.rateLimitRetries ?? 0) + 1
  if (retries > MAX_RATE_LIMIT_REENQUEUES) {
    await deadLetter(job, new Error('rate-limited beyond re-enqueue cap'))
    logger.warn('Connector webhook steer gave up after throttle cap', {
      connectorId: job.data.connectorId,
      streamKey: job.data.streamKey,
      eventId: job.data.eventId,
    })
    return { ok: false, throttledOut: true }
  }
  const delay = Math.max(retryAfterMs ?? 1_000, 1_000)
  await getQueue(Queues.appTriggerQueue).add(
    WEBHOOK_STEER_JOB,
    { ...job.data, rateLimitRetries: retries },
    { delay }
  )
  logger.info('Connector webhook steer throttled — re-enqueued', {
    connectorId: job.data.connectorId,
    streamKey: job.data.streamKey,
    eventId: job.data.eventId,
    delay,
    retries,
  })
  return { ok: true, deferred: true }
}

/**
 * Capture failure context to the inspector dead-letter list (mirrors the success inspector
 * list shape) before BullMQ discards the job on `removeOnFail`.
 */
async function deadLetter(job: Job<ConnectorWebhookSteerJobData>, err: unknown) {
  const {
    appInstallationId,
    triggerId,
    webhookEndpointId,
    topic,
    eventId,
    connectorId,
    streamKey,
    triggerData,
  } = job.data
  try {
    const redis = await getRedisClient(false)
    if (!redis) return
    // Sit the DLQ beside whichever inspector list fed the event: app triggers use
    // `app-trigger-test:<inst>:<triggerId>:dlq`, generic endpoints `webhook-endpoint:<id>:dlq`
    // (topic-agnostic, mirroring the events key — the topic is kept on the entry).
    const key = webhookEndpointId
      ? `webhook-endpoint:${webhookEndpointId}:dlq`
      : `app-trigger-test:${appInstallationId}:${triggerId}:dlq`
    const entry = {
      id: eventId,
      timestamp: new Date().toISOString(),
      source: 'connector-sync',
      connectorId,
      streamKey,
      eventId,
      topic,
      error: err instanceof Error ? err.message : String(err),
      triggerData,
    }
    await redis.lpush(key, JSON.stringify(entry))
    await redis.ltrim(key, 0, 49)
    await redis.expire(key, 86_400)
  } catch (redisErr) {
    logger.warn('Failed to write connector webhook steer dead-letter', {
      eventId,
      error: redisErr instanceof Error ? redisErr.message : String(redisErr),
    })
  }
}
