// packages/lib/src/jobs/data-connector/app-trigger-sync-dispatch-job.ts
// The THIRD consumer of the app-trigger fan-out (sync bridge §5.2). Sibling to
// `dispatchAppTrigger` (workflows) and `dispatchAppTriggerToAgents` (agents): one
// verified app-webhook delivery → a full run-based sync of every webhook-sync
// DataConnector bound to this `(connection, triggerId)` with ≥1 stream whose `filter`
// matches the payload. THIN by design — it only dedups + matches + steers a sync via
// `enqueueConnectorSync({ trigger: 'webhook' })` (same path as "Sync now"), so the
// delivery produces a `DataConnectorRun` history row, refreshes `lastSyncedAt`, and
// runs orphan reconciliation. `enqueueConnectorSync`'s per-connector `jobId` coalesces
// a burst of deliveries into one run.

import { database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { matchesFilter } from '../../agents/agent-trigger-queries'
import { enqueueConnectorSync } from '../../data-connectors/data-connector-queue'
import { createScopedLogger } from '../../logger'
import type { JobContext } from '../types'

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
 * A relevant delivery (≥1 of a connector's streams matches the payload) STEERS a full
 * run-based sync via `enqueueConnectorSync({ trigger: 'webhook' })` — same path as
 * "Sync now", so the delivery yields a `DataConnectorRun` history row, refreshes
 * `lastSyncedAt`, and runs orphan reconciliation. `enqueueConnectorSync`'s per-connector
 * `jobId` coalesces a burst of deliveries into one run. Fan-to-all across connectors.
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
        return { connectorsSynced: 0 }
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
    return { connectorsSynced: 0 }
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
    if (!matchesFilter(wt.filter, triggerData)) continue
    relevant.add(stream.dataConnectorId)
  }

  for (const connectorId of relevant) {
    await enqueueConnectorSync({ connectorId, organizationId, trigger: 'webhook' })
  }

  logger.debug('Dispatched connector app trigger', {
    triggerId,
    eventId,
    connectorsSynced: relevant.size,
  })
  return { connectorsSynced: relevant.size }
}
