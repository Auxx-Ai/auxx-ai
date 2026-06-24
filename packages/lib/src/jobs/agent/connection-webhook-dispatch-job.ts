// packages/lib/src/jobs/agent/connection-webhook-dispatch-job.ts
// Sibling to `dispatchAppTriggerToAgents` (app-trigger-dispatch-job.ts), for the unified
// connection webhook ingress (Direction 2). One verified delivery → all agent triggers
// whose `kind: 'webhook'` matches `(connectionId, topic)`. Same `:agents` dedup suffix,
// same `matchesFilter`, same `executeAgentAppTrigger` executor — only the matcher differs.

import { getRedisClient } from '@auxx/redis'
import type { Job } from 'bullmq'
import { matchesFilter } from '../../agents/agent-trigger-queries'
import { getCachedAgents } from '../../cache'
import { createScopedLogger } from '../../logger'
import { getQueue, Queues } from '../queues'

const logger = createScopedLogger('agent-connection-webhook-dispatch-job')

export type AgentConnectionWebhookDispatchJobData = {
  connectionId: string
  topic: string
  triggerData: Record<string, unknown>
  eventId: string
  organizationId: string
}

/**
 * BullMQ job handler: dispatch a connection webhook delivery to all matching agent
 * triggers. Sibling to `dispatchConnectionWebhook` (workflows); the `:agents` dedup
 * suffix keeps the agent fire independent of the workflow + sink fires.
 */
export async function dispatchConnectionWebhookToAgents(
  job: Job<AgentConnectionWebhookDispatchJobData>
) {
  const { connectionId, topic, triggerData, eventId, organizationId } = job.data

  const dedupKey = `connection-webhook-dedup:${connectionId}:${topic}:${eventId}:agents`
  try {
    const redis = await getRedisClient(false)
    if (redis) {
      const setResult = await redis.set(dedupKey, '1', 'EX', 300, 'NX')
      if (!setResult) {
        logger.warn('Duplicate agent connection-webhook event, skipping', { dedupKey, eventId })
        return { agentSessionsEnqueued: 0 }
      }
    }
  } catch (err) {
    logger.error('Redis dedup check failed for agent connection webhook', {
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
      if (trigger.kind !== 'webhook' || !trigger.enabled) continue
      if (trigger.triggerConnectionId !== connectionId) continue
      if (trigger.triggerTopic !== topic) continue
      matches.push({ agentId: agent.id, triggerId: trigger.id, config: trigger.config })
    }
  }

  if (matches.length === 0) {
    logger.debug('No matching agent triggers for connection webhook', { connectionId, topic })
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
      connectionId,
      topic,
      triggerData,
      eventId,
      firedAt: new Date().toISOString(),
    })
    enqueued++
  }

  logger.info('Dispatched agent connection webhook', {
    connectionId,
    topic,
    matched: matches.length,
    enqueued,
  })
  return { agentSessionsEnqueued: enqueued }
}
