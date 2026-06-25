// packages/lib/src/jobs/agent/webhook-endpoint-dispatch-job.ts
// Sibling to `dispatchAppTriggerToAgents` (app-trigger-dispatch-job.ts), for the
// provider-agnostic inbound webhook ingress. One verified delivery → all agent triggers
// whose `kind: 'webhook-endpoint'` matches `(endpointId, topic)`. Same `:agents` dedup suffix,
// same `matchesFilter`, same `executeAgentAppTrigger` executor — only the matcher differs.

import { getRedisClient } from '@auxx/redis'
import { matchesFilter } from '../../agents/agent-trigger-queries'
import { getCachedAgents } from '../../cache'
import { createScopedLogger } from '../../logger'
import { getQueue, Queues } from '../queues'
import type { JobContext } from '../types'

const logger = createScopedLogger('agent-webhook-endpoint-dispatch-job')

export type AgentWebhookEndpointDispatchJobData = {
  endpointId: string
  topic: string
  triggerData: Record<string, unknown>
  eventId: string
  organizationId: string
}

/**
 * BullMQ job handler: dispatch a webhook-endpoint delivery to all matching agent
 * triggers. Sibling to `dispatchWebhookEndpoint` (workflows); the `:agents` dedup
 * suffix keeps the agent fire independent of the workflow fire.
 */
export async function dispatchWebhookEndpointToAgents(
  ctx: JobContext<AgentWebhookEndpointDispatchJobData>
) {
  const job = ctx.job
  const { endpointId, topic, triggerData, eventId, organizationId } = job.data

  const dedupKey = `webhook-endpoint-dispatch-dedup:${endpointId}:${topic}:${eventId}:agents`
  try {
    const redis = await getRedisClient(false)
    if (redis) {
      const setResult = await redis.set(dedupKey, '1', 'EX', 300, 'NX')
      if (!setResult) {
        logger.warn('Duplicate agent webhook-endpoint event, skipping', { dedupKey, eventId })
        return { agentSessionsEnqueued: 0 }
      }
    }
  } catch (err) {
    logger.error('Redis dedup check failed for agent webhook endpoint', {
      dedupKey,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const agents = await getCachedAgents(organizationId)
  const matches: Array<{
    agentId: string
    triggerId: string
    config: Record<string, unknown> | null
  }> = []
  for (const agent of agents) {
    for (const trigger of agent.triggers) {
      if (trigger.kind !== 'webhook-endpoint' || !trigger.enabled) continue
      if (trigger.triggerWebhookEndpointId !== endpointId) continue
      if (trigger.triggerTopic !== topic) continue
      matches.push({ agentId: agent.id, triggerId: trigger.id, config: trigger.config })
    }
  }

  if (matches.length === 0) {
    logger.debug('No matching agent triggers for webhook endpoint', { endpointId, topic })
    return { agentSessionsEnqueued: 0 }
  }

  const queue = getQueue(Queues.scheduledTriggerQueue)
  let enqueued = 0
  for (const match of matches) {
    const filter = (match.config as { filter?: Record<string, unknown> } | null)?.filter
    if (!matchesFilter(filter, triggerData)) continue

    await queue.add('executeAgentAppTrigger', {
      agentTriggerId: match.triggerId,
      agentId: match.agentId,
      organizationId,
      webhookEndpointId: endpointId,
      topic,
      triggerData,
      eventId,
      firedAt: new Date().toISOString(),
    })
    enqueued++
  }

  logger.info('Dispatched agent webhook endpoint', {
    endpointId,
    topic,
    matched: matches.length,
    enqueued,
  })
  return { agentSessionsEnqueued: enqueued }
}
