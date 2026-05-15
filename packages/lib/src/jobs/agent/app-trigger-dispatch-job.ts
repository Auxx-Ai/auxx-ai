// packages/lib/src/jobs/agent/app-trigger-dispatch-job.ts

import { getRedisClient } from '@auxx/redis'
import type { Job } from 'bullmq'
import { getAgentTriggersByApp, matchesFilter } from '../../agents/agent-trigger-queries'
import { createScopedLogger } from '../../logger'
import { getQueue, Queues } from '../queues'

const logger = createScopedLogger('agent-app-trigger-dispatch-job')

export type AgentAppTriggerDispatchJobData = {
  appInstallationId: string
  appId: string
  triggerId: string
  connectionId?: string
  triggerData: Record<string, unknown>
  eventId: string
  organizationId: string
}

/**
 * BullMQ job handler: dispatch an app trigger to all matching agent
 * triggers. Sibling to `dispatchAppTrigger` (workflows). Uses a per-target
 * dedup key (`:agents` suffix) so a duplicate event doesn't double-fire
 * agents — but workflow + agent fires on the same event are independent.
 */
export async function dispatchAppTriggerToAgents(job: Job<AgentAppTriggerDispatchJobData>) {
  const {
    appInstallationId,
    appId,
    triggerId,
    connectionId,
    triggerData,
    eventId,
    organizationId,
  } = job.data

  const dedupKey = `app-trigger-dedup:${appInstallationId}:${triggerId}:${eventId}:agents`

  try {
    const redis = await getRedisClient(false)
    if (redis) {
      const setResult = await redis.set(dedupKey, '1', 'EX', 300, 'NX')
      if (!setResult) {
        logger.warn('Duplicate agent app-trigger event, skipping', { dedupKey, eventId })
        return { agentSessionsEnqueued: 0 }
      }
    }
  } catch (err) {
    logger.error('Redis dedup check failed for agent app trigger', {
      dedupKey,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const triggers = await getAgentTriggersByApp({
    organizationId,
    appId,
    triggerId,
    installationId: appInstallationId,
    connectionId,
  })

  if (triggers.length === 0) {
    logger.debug('No matching agent triggers for app event', {
      appId,
      triggerId,
      installationId: appInstallationId,
    })
    return { agentSessionsEnqueued: 0 }
  }

  const queue = getQueue(Queues.scheduledTriggerQueue)
  let enqueued = 0
  for (const trigger of triggers) {
    const filter = (trigger.config as { filter?: Record<string, unknown> }).filter
    if (!matchesFilter(filter, triggerData)) continue

    await queue.add('executeAgentAppTrigger', {
      agentTriggerId: trigger.id,
      agentId: trigger.agentId,
      organizationId,
      appId,
      triggerId,
      installationId: appInstallationId,
      connectionId: connectionId ?? null,
      triggerData,
      eventId,
      firedAt: new Date().toISOString(),
    })
    enqueued++
  }

  logger.info('Dispatched agent app trigger', {
    appId,
    triggerId,
    installationId: appInstallationId,
    matched: triggers.length,
    enqueued,
  })

  return { agentSessionsEnqueued: enqueued }
}
