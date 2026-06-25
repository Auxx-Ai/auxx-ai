// packages/lib/src/jobs/data-connector/app-trigger-sync-stream-job.ts
// The per-(connector, stream) child of `dispatchAppTriggerToConnectors` (sync bridge
// §5.2). Steers the connector's regular fetch with the webhook payload and sinks the
// result. Owns the WHOLE failure policy so the thin dispatch job stays cheap:
//   • 429 → the fetch sets `maxRetries: 0`, so a throttle surfaces as
//     `ConnectorRateLimitError` immediately; we re-enqueue with `delay = retryAfterMs`
//     instead of burning a BullMQ attempt sleeping under the lock (H1 / §9 Q2).
//   • other 4xx/5xx → BullMQ's default bounded retries (5, exponential). On the final
//     attempt we capture context to the inspector dead-letter before `removeOnFail`
//     discards the job, then re-throw.
// Runs on `appTriggerQueue` (concurrency 10) — a higher lane than the 2-slot backfill
// queue — so webhook latency isn't stuck behind bulk syncs. The provider rate-limit
// budget still coordinates across lanes via the shared Redis throttle key.

import { getRedisClient } from '@auxx/redis'
import type { Job } from 'bullmq'
import { createScopedLogger } from '../../logger'
import { getQueue, Queues } from '../queues'
import { APP_TRIGGER_SYNC_STREAM_JOB } from './app-trigger-sync-dispatch-job'

const logger = createScopedLogger('data-connector-app-trigger-sync-stream-job')

/** Stop re-enqueuing a perpetually-throttled event after this many rate-limit deferrals. */
const MAX_RATE_LIMIT_REENQUEUES = 10

export type ConnectorAppTriggerStreamJobData = {
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

export async function runConnectorAppTriggerStream(job: Job<ConnectorAppTriggerStreamJobData>) {
  const { connectorId, streamKey, organizationId, triggerData, eventId } = job.data

  // Lazy-import the heavy data-connectors barrel at call time (it pulls the sink /
  // crud spine) — keeps this job file light and side-effect-free for vitest.
  const { database: db } = await import('@auxx/database')
  const { runWebhookEventSlice, ConnectorRateLimitError } = await import('../../data-connectors')

  try {
    await runWebhookEventSlice(db, {
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
    // Last attempt → dead-letter before `removeOnFail` discards the job, then re-throw
    // so BullMQ records the terminal failure.
    const maxAttempts = job.opts.attempts ?? 5
    if (job.attemptsMade >= maxAttempts - 1) {
      await deadLetter(job, err)
    }
    throw err
  }
}

/** Re-enqueue the event after the provider's Retry-After, capped to avoid a hot loop. */
async function deferForThrottle(job: Job<ConnectorAppTriggerStreamJobData>, retryAfterMs?: number) {
  const retries = (job.data.rateLimitRetries ?? 0) + 1
  if (retries > MAX_RATE_LIMIT_REENQUEUES) {
    await deadLetter(job, new Error('rate-limited beyond re-enqueue cap'))
    logger.warn('Connector app-trigger stream gave up after throttle cap', {
      connectorId: job.data.connectorId,
      streamKey: job.data.streamKey,
      eventId: job.data.eventId,
    })
    return { ok: false, throttledOut: true }
  }
  const delay = Math.max(retryAfterMs ?? 1_000, 1_000)
  await getQueue(Queues.appTriggerQueue).add(
    APP_TRIGGER_SYNC_STREAM_JOB,
    { ...job.data, rateLimitRetries: retries },
    { delay }
  )
  logger.info('Connector app-trigger stream throttled — re-enqueued', {
    connectorId: job.data.connectorId,
    streamKey: job.data.streamKey,
    eventId: job.data.eventId,
    delay,
    retries,
  })
  return { ok: true, deferred: true }
}

/**
 * Capture failure context to the inspector dead-letter list (mirrors the success
 * inspector list shape, §5.2 / §7.4) before BullMQ discards the job on `removeOnFail`.
 */
async function deadLetter(job: Job<ConnectorAppTriggerStreamJobData>, err: unknown) {
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
    logger.warn('Failed to write connector app-trigger dead-letter', {
      eventId,
      error: redisErr instanceof Error ? redisErr.message : String(redisErr),
    })
  }
}
