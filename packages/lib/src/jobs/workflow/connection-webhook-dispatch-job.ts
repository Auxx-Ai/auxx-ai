// packages/lib/src/jobs/workflow/connection-webhook-dispatch-job.ts
// Sibling to `dispatchAppTrigger` (app-trigger-dispatch-job.ts), for the unified
// connection webhook ingress (Direction 2). One verified delivery → all workflows whose
// webhook-trigger matches `(connectionId, topic)`. Same queue, same executor, same
// dedup pattern — only the cache matcher (`byConnectionWebhook`) differs.

import { getRedisClient } from '@auxx/redis'
import type { Job } from 'bullmq'
import { getOrgCache } from '../../cache'
import { createScopedLogger } from '../../logger'
import { executeAppTriggeredWorkflow } from '../../workflow-engine/execution/trigger-app-workflow'

const logger = createScopedLogger('connection-webhook-dispatch-job')

export type ConnectionWebhookDispatchJobData = {
  connectionId: string
  topic: string
  triggerData: Record<string, unknown>
  eventId: string
  organizationId: string
}

/**
 * BullMQ job handler: dispatch a connection webhook delivery to all matching workflows.
 *
 * 1. Dedup check via Redis NX key (5-minute TTL), independent of the sink + agent fires.
 * 2. Query published + enabled `webhook-trigger` workflows matching `(connectionId, topic)`.
 * 3. Execute each with the delivery payload as trigger data.
 */
export async function dispatchConnectionWebhook(job: Job<ConnectionWebhookDispatchJobData>) {
  const { connectionId, topic, triggerData, eventId, organizationId } = job.data

  logger.info('Dispatching connection webhook', {
    connectionId,
    topic,
    eventId,
    organizationId,
    jobId: job.id,
  })

  const dedupKey = `connection-webhook-dedup:${connectionId}:${topic}:${eventId}`
  try {
    const redis = await getRedisClient(false)
    if (redis) {
      const setResult = await redis.set(dedupKey, '1', 'EX', 300, 'NX')
      if (!setResult) {
        logger.warn('Duplicate connection webhook event, skipping', { dedupKey, eventId })
        return { workflowRunIds: [] }
      }
    } else {
      logger.warn('Redis unavailable, skipping dedup check')
    }
  } catch (error) {
    logger.error('Redis dedup check failed, continuing without dedup', {
      dedupKey,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const matchingApps = await getOrgCache()
      .from(organizationId, 'workflowApps')
      .byConnectionWebhook({ connectionId, topic })

    if (matchingApps.length === 0) {
      logger.info('No matching workflows for connection webhook', {
        connectionId,
        topic,
        organizationId,
      })
      return { workflowRunIds: [] }
    }

    const workflowRunIds: string[] = []
    for (const app of matchingApps) {
      if (!app.workflowId) {
        logger.warn('Workflow has no published version, skipping', { workflowAppId: app.id })
        continue
      }
      const result = await executeAppTriggeredWorkflow({
        workflowAppId: app.id,
        organizationId,
        triggerData,
        connectionId,
        topic,
        eventId,
      })
      if (result.isOk()) {
        workflowRunIds.push(result.value.workflowRunId)
      } else {
        logger.error('Failed to execute connection-webhook workflow', {
          workflowAppId: app.id,
          error: result.error,
        })
      }
    }

    logger.info('Connection webhook dispatch complete', {
      triggeredWorkflows: workflowRunIds.length,
      totalMatching: matchingApps.length,
      connectionId,
      topic,
      eventId,
    })
    return { workflowRunIds }
  } catch (error) {
    logger.error('Connection webhook dispatch failed', {
      connectionId,
      topic,
      eventId,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
