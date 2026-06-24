// packages/lib/src/jobs/data-connector/app-trigger-sync-dispatch-job.ts
// The THIRD consumer of the app-trigger fan-out (sync bridge §5.2). Sibling to
// `dispatchAppTrigger` (workflows) and `dispatchAppTriggerToAgents` (agents): one
// verified app-webhook delivery → every webhook-sync DataConnector stream bound to
// this `(connection, triggerId)` whose `filter` matches the payload. THIN by design
// — it only dedups + matches + fans out; each matched (connector, stream) gets its
// OWN child job (`app-trigger-sync-stream`) that does the steer-fetch-sink and owns
// the failure policy. Fetching inline would deadlock dedup-under-retry: the dedup
// key is already claimed when BullMQ retries, so the retry self-suppresses and the
// fetch never re-runs. Splitting keeps dedup on the cheap match and gives each child
// clean, isolated retries.

import { database as db, schema } from '@auxx/database'
import { getRedisClient } from '@auxx/redis'
import type { Job } from 'bullmq'
import { and, eq, inArray } from 'drizzle-orm'
import { matchesFilter } from '../../agents/agent-trigger-queries'
import { createScopedLogger } from '../../logger'
import { getQueue, Queues } from '../queues'

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

/** Child job name on `appTriggerQueue` (registered alongside this dispatch job). */
export const APP_TRIGGER_SYNC_STREAM_JOB = 'app-trigger-sync-stream'

/**
 * BullMQ job handler: fan one app-webhook delivery out to webhook-sync data
 * connectors. Matches by `credentialId` (the connection) so no `appId` denorm is
 * needed; the per-stream `webhookTrigger.triggerId` + `matchesFilter` does the rest
 * (Shopify multiplexes 22 topics through one triggerId, discriminated on
 * `triggerData.topic`). Fan-to-all — two connectors/streams binding the same trigger
 * is legitimate fan-out, not a conflict.
 */
export async function dispatchAppTriggerToConnectors(job: Job<ConnectorAppTriggerDispatchJobData>) {
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
        return { childJobsEnqueued: 0 }
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
    return { childJobsEnqueued: 0 }
  }

  const connectors = await db.query.DataConnector.findMany({
    where: and(
      eq(schema.DataConnector.organizationId, organizationId),
      eq(schema.DataConnector.credentialId, connectionId),
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
    if (!stream.streamKey || !wt || wt.triggerId !== triggerId) continue
    if (!matchesFilter(wt.filter, triggerData)) continue

    await queue.add(APP_TRIGGER_SYNC_STREAM_JOB, {
      connectorId: stream.dataConnectorId,
      streamKey: stream.streamKey,
      organizationId,
      appInstallationId,
      triggerId,
      triggerData,
      eventId,
    })
    enqueued++
  }

  // Fan-out degree > 1 means duplicate upstream fetches of the same resource — correct
  // but wasteful (sync bridge §9 Q1). Surface it so the pressure is visible.
  if (enqueued > 1) {
    logger.info('Connector app-trigger fan-out degree > 1', { triggerId, eventId, enqueued })
  } else {
    logger.debug('Dispatched connector app trigger', { triggerId, eventId, enqueued })
  }
  return { childJobsEnqueued: enqueued }
}
