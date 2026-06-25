// packages/lib/src/jobs/data-connector/webhook-endpoint-sync-dispatch-job.ts
// The connector-sink leg of the generic WebhookEndpoint fan-out (unified-trigger-picker
// §4.4). Sibling to `dispatchAppTriggerToConnectors` (the APP-trigger leg) and to the
// workflow/agent `dispatchWebhookEndpoint*` jobs: one verified endpoint delivery → every
// webhook-sync DataConnector stream bound to this `webhookEndpointId` whose `filter`
// matches the payload. THIN — dedup + match + fan out; each matched (connector, stream)
// gets the SAME child job (`app-trigger-sync-stream`) that owns the steer-fetch-sink and
// failure policy (the slice is source-agnostic — it only needs the connector, stream,
// triggerData + eventId). Match key is `webhookEndpointId`, NOT `credentialId`: generic
// endpoints aren't connection-bound, so a stream opts in via
// `requestConfig.webhookTrigger.webhookEndpointId`. The connector still resolves its own
// `credentialId` for fetch auth inside `runWebhookEventSlice`.

import { database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import type { Job } from 'bullmq'
import { and, eq, inArray } from 'drizzle-orm'
import { matchesFilter } from '../../agents/agent-trigger-queries'
import { createScopedLogger } from '../../logger'
import { getQueue, Queues } from '../queues'
import { APP_TRIGGER_SYNC_STREAM_JOB } from './app-trigger-sync-dispatch-job'

const logger = createScopedLogger('data-connector-webhook-endpoint-dispatch-job')

/** Same payload the workflow/agent webhook-endpoint dispatch jobs receive. */
export type ConnectorWebhookEndpointDispatchJobData = {
  endpointId: string
  topic: string
  triggerData: Record<string, unknown>
  eventId: string
  organizationId: string
}

/**
 * BullMQ job handler: fan one verified WebhookEndpoint delivery out to webhook-sync data
 * connectors. Matches streams whose `webhookTrigger.webhookEndpointId === endpointId` and
 * whose `filter` matches the payload (topic discrimination via `matchesFilter`, same as
 * the app leg). Fan-to-all — two streams binding the same endpoint is legitimate fan-out.
 */
export async function dispatchWebhookEndpointToConnectors(
  job: Job<ConnectorWebhookEndpointDispatchJobData>
) {
  const { endpointId, topic, triggerData, eventId, organizationId } = job.data

  // `:connectors` suffix keeps this dedup independent of the workflow/:agents keys.
  const dedupKey = `webhook-endpoint-dispatch-dedup:${endpointId}:${topic}:${eventId}:connectors`
  try {
    const redis = await getRedisClient(false)
    if (redis) {
      const setResult = await redis.set(dedupKey, '1', 'EX', 300, 'NX')
      if (!setResult) {
        logger.warn('Duplicate connector webhook-endpoint event, skipping', { dedupKey, eventId })
        return { childJobsEnqueued: 0 }
      }
    }
  } catch (err) {
    logger.error('Redis dedup check failed for connector webhook endpoint', {
      dedupKey,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const connectors = await db.query.DataConnector.findMany({
    where: and(
      eq(schema.DataConnector.organizationId, organizationId),
      eq(schema.DataConnector.syncBehavior, 'webhook')
    ),
    columns: { id: true },
  })
  if (connectors.length === 0) return { childJobsEnqueued: 0 }

  const streams = await db.query.DataConnectorStream.findMany({
    where: and(
      inArray(
        schema.DataConnectorStream.dataConnectorId,
        connectors.map((c) => c.id)
      ),
      eq(schema.DataConnectorStream.enabled, true)
    ),
    columns: { dataConnectorId: true, streamKey: true, requestConfig: true },
  })

  const queue = getQueue(Queues.appTriggerQueue)
  let enqueued = 0
  for (const stream of streams) {
    const wt = stream.requestConfig?.webhookTrigger
    if (!stream.streamKey || !wt || wt.webhookEndpointId !== endpointId) continue
    if (!matchesFilter(wt.filter, triggerData)) continue

    await queue.add(APP_TRIGGER_SYNC_STREAM_JOB, {
      connectorId: stream.dataConnectorId,
      streamKey: stream.streamKey,
      organizationId,
      webhookEndpointId: endpointId,
      topic,
      triggerData,
      eventId,
    })
    enqueued++
  }

  if (enqueued > 1) {
    logger.info('Connector webhook-endpoint fan-out degree > 1', { endpointId, eventId, enqueued })
  } else {
    logger.debug('Dispatched connector webhook endpoint', { endpointId, eventId, enqueued })
  }
  return { childJobsEnqueued: enqueued }
}
