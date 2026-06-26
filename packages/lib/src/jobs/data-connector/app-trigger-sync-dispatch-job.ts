// packages/lib/src/jobs/data-connector/app-trigger-sync-dispatch-job.ts
// The THIRD consumer of the app-trigger fan-out (sync bridge §5.2). Sibling to
// `dispatchAppTrigger` (workflows) and `dispatchAppTriggerToAgents` (agents): one
// verified app-webhook delivery → a sync of every webhook-sync DataConnector bound to this
// `(connection, triggerId)` with ≥1 stream whose `filter` matches the payload. THIN by
// design — it dedups + matches + routes by mode (webhook-steered-partial-run-plan):
//   • steerable stream (`webhookTrigger.paths` set) → a targeted PARTIAL run via the steer
//     job (fetches only the changed record via `{path}`, marks the run `partial`).
//   • non-steerable cursor stream → the full run-based sync (`enqueueConnectorSync`).
// Either way the delivery yields a `DataConnectorRun` history row + refreshed `lastSyncedAt`.

import { database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { matchesFilter } from '../../agents/agent-trigger-queries'
import { enqueueConnectorSync } from '../../data-connectors/data-connector-queue'
import { createScopedLogger } from '../../logger'
import { getQueue, Queues } from '../queues'
import type { JobContext } from '../types'
import { type ConnectorWebhookSteerJobData, WEBHOOK_STEER_JOB } from './webhook-steer-job'

const logger = createScopedLogger('data-connector-app-trigger-dispatch-job')

/** Same payload shape the workflow/agent app-trigger dispatch jobs receive. */
export type ConnectorAppTriggerDispatchJobData = {
  appInstallationId: string
  appId: string
  triggerId: string
  connectionId?: string
  triggerData: Record<string, unknown>
  eventId: string
  organizationId: string
}

/**
 * BullMQ job handler: fan one app-webhook delivery out to webhook-sync data
 * connectors. Matches by `credentialId` (the connection) + the connector-level
 * `config.webhookTrigger.triggerId` (v7 — one signal per connector); the per-stream
 * `webhookTrigger.filter` + `matchesFilter` discriminates topics (Shopify multiplexes
 * 22 topics through one triggerId, on `triggerData.topic`).
 *
 * Each matched stream routes by mode: steerable (`{path}` set) → a per-stream steer job
 * (targeted PARTIAL run); non-steerable cursor stream → `enqueueConnectorSync` (full run).
 * Fan-to-all across connectors.
 */
export async function dispatchAppTriggerToConnectors(
  ctx: JobContext<ConnectorAppTriggerDispatchJobData>
) {
  const job = ctx.job
  const { appInstallationId, triggerId, connectionId, triggerData, eventId, organizationId } =
    job.data

  // The `:connectors` suffix keeps this dedup independent of the workflow/:agents keys.
  const dedupKey = `app-trigger-dedup:${appInstallationId}:${triggerId}:${eventId}:connectors`
  try {
    const redis = await getRedisClient(false)
    if (redis) {
      const setResult = await redis.set(dedupKey, '1', 'EX', 300, 'NX')
      if (!setResult) {
        logger.warn('Duplicate connector app-trigger event, skipping', { dedupKey, eventId })
        return { steerJobs: 0, connectorsFullSynced: 0 }
      }
    }
  } catch (err) {
    logger.error('Redis dedup check failed for connector app trigger', {
      dedupKey,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Webhook-sync connectors are keyed by the connection. No connection ⇒ nothing binds.
  if (!connectionId) {
    logger.debug('App trigger carried no connectionId — no connector match', { triggerId, eventId })
    return { steerJobs: 0, connectorsFullSynced: 0 }
  }

  // Signal is connector-level since v7 (`config.webhookTrigger.triggerId`) — match the
  // connection AND the bound trigger on the connector, then steer each of its streams
  // (the per-stream `webhookTrigger` carries only topic/token steering now).
  const candidates = await db.query.DataConnector.findMany({
    where: and(
      eq(schema.DataConnector.organizationId, organizationId),
      eq(schema.DataConnector.credentialId, connectionId),
      eq(schema.DataConnector.syncBehavior, 'webhook'),
      // A paused connector keeps its binding but stops ingesting — an active webhook
      // connector is `syncBehavior='webhook' ∧ status≠'paused'` (data-connector-scheduler).
      ne(schema.DataConnector.status, 'paused')
    ),
    columns: { id: true, config: true },
  })
  const connectors = candidates.filter((c) => c.config?.webhookTrigger?.triggerId === triggerId)
  if (connectors.length === 0) return { steerJobs: 0, connectorsFullSynced: 0 }

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

  // Match streams by `webhookTrigger.filter` (topic discrimination), then SPLIT by mode:
  //  • steerable (`{path}` set) → a targeted PARTIAL run that fetches only the changed
  //    record (the steer job, per-stream so retries stay isolated).
  //  • non-steerable (cursor stream, no `{path}`) → the full run-based sync (enqueueConnectorSync).
  // A connector with ANY non-steerable matched stream full-syncs; the full crawl is a superset
  // that covers its steerable streams too, so we skip their steer jobs (no double-ingest).
  const matched: { connectorId: string; streamKey: string; steerable: boolean }[] = []
  for (const stream of streams) {
    const wt = stream.requestConfig?.webhookTrigger
    if (!stream.streamKey || !wt) continue
    if (!matchesFilter(wt.filter, triggerData)) continue
    matched.push({
      connectorId: stream.dataConnectorId,
      streamKey: stream.streamKey,
      steerable: (wt.paths?.length ?? 0) > 0,
    })
  }

  const fullSyncConnectors = new Set(matched.filter((m) => !m.steerable).map((m) => m.connectorId))
  const queue = getQueue(Queues.appTriggerQueue)
  let steerJobs = 0
  for (const m of matched) {
    if (!m.steerable || fullSyncConnectors.has(m.connectorId)) continue
    // No `jobId` — each delivery is a distinct record, so steered runs must NOT coalesce
    // (the dispatch-level redis dedup already drops duplicate deliveries of one eventId).
    await queue.add(WEBHOOK_STEER_JOB, {
      connectorId: m.connectorId,
      streamKey: m.streamKey,
      organizationId,
      appInstallationId,
      triggerId,
      triggerData,
      eventId,
    } satisfies ConnectorWebhookSteerJobData)
    steerJobs++
  }
  for (const connectorId of fullSyncConnectors) {
    await enqueueConnectorSync({ connectorId, organizationId, trigger: 'webhook' })
  }

  logger.debug('Dispatched connector app trigger', {
    triggerId,
    eventId,
    steerJobs,
    connectorsFullSynced: fullSyncConnectors.size,
  })
  return { steerJobs, connectorsFullSynced: fullSyncConnectors.size }
}
