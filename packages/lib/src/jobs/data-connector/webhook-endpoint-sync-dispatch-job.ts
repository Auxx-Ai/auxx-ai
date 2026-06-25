// packages/lib/src/jobs/data-connector/webhook-endpoint-sync-dispatch-job.ts
// The connector-sink leg of the generic WebhookEndpoint fan-out (unified-trigger-picker
// §4.4). Sibling to `dispatchAppTriggerToConnectors` (the APP-trigger leg) and to the
// workflow/agent `dispatchWebhookEndpoint*` jobs: one verified endpoint delivery → every
// webhook-sync DataConnector stream bound to this `webhookEndpointId` whose `filter`
// matches the payload. THIN — dedup + match + fan out; each matched (connector, stream)
// gets the SAME child job (`app-trigger-sync-stream`) that owns the steer-fetch-sink and
// failure policy (the slice is source-agnostic — it only needs the connector, stream,
// triggerData + eventId). Match key is `webhookEndpointId`, NOT `credentialId`: generic
// endpoints aren't connection-bound, so a connector opts in via its connector-level
// `config.webhookTrigger.webhookEndpointId` (v7 — one signal per connector); each of its
// streams' `requestConfig.webhookTrigger` then carries only per-stream topic/token steering.
// The connector still resolves its own `credentialId` for fetch auth inside `runWebhookEventSlice`.

import { database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { matchesFilter } from '../../agents/agent-trigger-queries'
import { createScopedLogger } from '../../logger'
import { getQueue, Queues } from '../queues'
import type { JobContext } from '../types'
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
 * connectors. Matches connectors whose `config.webhookTrigger.webhookEndpointId === endpointId`
 * (connector-level signal, v7), then each of their streams whose per-stream `filter` matches the
 * payload (topic discrimination via `matchesFilter`, same as the app leg). Fan-to-all — two
 * streams binding the same endpoint is legitimate fan-out.
 */
export async function dispatchWebhookEndpointToConnectors(
  ctx: JobContext<ConnectorWebhookEndpointDispatchJobData>
) {
  const job = ctx.job
  const { endpointId, topic, triggerData, eventId, organizationId } = job.data

  // Generic endpoints carry the discriminator topic in a SEPARATE field (extracted from a
  // header / JSON path at ingress), whereas app triggers bake it into `triggerData.topic`
  // (Shopify). The per-stream `filter`/`deleteWhen.topicEquals` both read `triggerData.topic`
  // (see StreamWebhookTrigger), so fold the endpoint topic in here to make the two paths
  // consistent — without it, any topic-scoped connector stream silently never matches. Only
  // when there's a topic and the payload is a plain object (non-JSON bodies fall through).
  const matchData =
    topic && triggerData && typeof triggerData === 'object' && !Array.isArray(triggerData)
      ? { ...triggerData, topic }
      : triggerData

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

  // Signal is connector-level since v7 (`config.webhookTrigger`) — match the connector,
  // then steer each of its streams (the per-stream `webhookTrigger` carries only steering).
  const candidates = await db.query.DataConnector.findMany({
    where: and(
      eq(schema.DataConnector.organizationId, organizationId),
      eq(schema.DataConnector.syncBehavior, 'webhook'),
      // A paused connector keeps its binding but stops ingesting — an active webhook
      // connector is `syncBehavior='webhook' ∧ status≠'paused'` (data-connector-scheduler).
      ne(schema.DataConnector.status, 'paused')
    ),
    columns: { id: true, config: true },
  })
  const connectors = candidates.filter(
    (c) => c.config?.webhookTrigger?.webhookEndpointId === endpointId
  )
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
    if (!stream.streamKey || !wt) continue
    if (!matchesFilter(wt.filter, matchData)) continue

    await queue.add(APP_TRIGGER_SYNC_STREAM_JOB, {
      connectorId: stream.dataConnectorId,
      streamKey: stream.streamKey,
      organizationId,
      webhookEndpointId: endpointId,
      topic,
      // Carry the topic-enriched payload so the slice's `resolveWebhookSteer` sees
      // `triggerData.topic` for `deleteWhen.topicEquals` (steer reads the same field).
      triggerData: matchData,
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
