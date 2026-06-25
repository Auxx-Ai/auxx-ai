// packages/lib/src/jobs/workflow/webhook-endpoint-dispatch-job.ts
// Sibling to `dispatchAppTrigger` (app-trigger-dispatch-job.ts), for the provider-agnostic
// inbound webhook ingress. One verified delivery → all workflows whose webhook-endpoint
// trigger matches `(endpointId, topic)`. Same queue, same executor, same dedup pattern —
// only the cache matcher (`byWebhookEndpoint`) differs.

import { getRedisClient } from '@auxx/redis'
import { getOrgCache } from '../../cache'
import { createScopedLogger } from '../../logger'
import { executeAppTriggeredWorkflow } from '../../workflow-engine/execution/trigger-app-workflow'
import type { JobContext } from '../types'

const logger = createScopedLogger('webhook-endpoint-dispatch-job')

export type WebhookEndpointDispatchJobData = {
  endpointId: string
  topic: string
  triggerData: Record<string, unknown>
  eventId: string
  organizationId: string
}

/**
 * BullMQ job handler: dispatch a webhook-endpoint delivery to all matching workflows.
 *
 * 1. Dedup check via Redis NX key (5-minute TTL), independent of the agent fire.
 * 2. Query published + enabled `webhook-endpoint` workflows matching `(endpointId, topic)`.
 * 3. Execute each with the delivery payload as trigger data.
 */
export async function dispatchWebhookEndpoint(ctx: JobContext<WebhookEndpointDispatchJobData>) {
  const job = ctx.job
  const { endpointId, topic, triggerData, eventId, organizationId } = job.data

  logger.info('Dispatching webhook endpoint', {
    endpointId,
    topic,
    eventId,
    organizationId,
    jobId: job.id,
  })

  const dedupKey = `webhook-endpoint-dispatch-dedup:${endpointId}:${topic}:${eventId}`
  try {
    const redis = await getRedisClient(false)
    if (redis) {
      const setResult = await redis.set(dedupKey, '1', 'EX', 300, 'NX')
      if (!setResult) {
        logger.warn('Duplicate webhook endpoint event, skipping', { dedupKey, eventId })
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
      .byWebhookEndpoint({ endpointId, topic })

    if (matchingApps.length === 0) {
      logger.info('No matching workflows for webhook endpoint', {
        endpointId,
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
        webhookEndpointId: endpointId,
        topic,
        eventId,
      })
      if (result.isOk()) {
        workflowRunIds.push(result.value.workflowRunId)
      } else {
        logger.error('Failed to execute webhook-endpoint workflow', {
          workflowAppId: app.id,
          error: result.error,
        })
      }
    }

    logger.info('Webhook endpoint dispatch complete', {
      triggeredWorkflows: workflowRunIds.length,
      totalMatching: matchingApps.length,
      endpointId,
      topic,
      eventId,
    })
    return { workflowRunIds }
  } catch (error) {
    logger.error('Webhook endpoint dispatch failed', {
      endpointId,
      topic,
      eventId,
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
