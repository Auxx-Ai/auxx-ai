// packages/lib/src/jobs/data-connector/webhook-endpoint-sync-dispatch-job.ts
// The connector-sink leg of the generic WebhookEndpoint fan-out (unified-trigger-picker
// §4.4). Sibling to `dispatchAppTriggerToConnectors` (the APP-trigger leg) and to the
// workflow/agent `dispatchWebhookEndpoint*` jobs: one verified endpoint delivery → a full
// run-based sync of every webhook-sync DataConnector bound to this `webhookEndpointId`
// with ≥1 stream whose `filter` matches the payload. THIN — dedup + match + steer a sync
// via `enqueueConnectorSync({ trigger: 'webhook' })` (same path as "Sync now"), so the
// delivery gets a `DataConnectorRun` history row + refreshed `lastSyncedAt` + reconciliation.
// Match key is `webhookEndpointId`, NOT `credentialId`: generic endpoints aren't
// connection-bound, so a connector opts in via its connector-level
// `config.webhookTrigger.webhookEndpointId` (v7 — one signal per connector); each of its
// streams' `requestConfig.webhookTrigger.filter` discriminates which topics are relevant.

import { database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { matchesFilter } from '../../agents/agent-trigger-queries'
import { enqueueConnectorSync } from '../../data-connectors/data-connector-queue'
import { createScopedLogger } from '../../logger'
import type { JobContext } from '../types'

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
        return { connectorsSynced: 0 }
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
  if (connectors.length === 0) return { connectorsSynced: 0 }

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

  // A connector is relevant when ≥1 of its enabled streams' `webhookTrigger.filter`
  // matches this payload (topic discrimination). One full sync per relevant connector —
  // the run covers all its streams, so we don't fan per-stream.
  const relevant = new Set<string>()
  for (const stream of streams) {
    const wt = stream.requestConfig?.webhookTrigger
    if (!stream.streamKey || !wt) continue
    if (!matchesFilter(wt.filter, matchData)) continue
    relevant.add(stream.dataConnectorId)
  }

  for (const connectorId of relevant) {
    await enqueueConnectorSync({ connectorId, organizationId, trigger: 'webhook' })
  }

  logger.debug('Dispatched connector webhook endpoint', {
    endpointId,
    eventId,
    connectorsSynced: relevant.size,
  })
  return { connectorsSynced: relevant.size }
}
