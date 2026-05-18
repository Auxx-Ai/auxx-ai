// packages/lib/src/jobs/agent/app-trigger-dispatch-job.ts

import { getRedisClient } from '@auxx/redis'
import type { Job } from 'bullmq'
import { matchesFilter } from '../../agents/agent-trigger-queries'
import { getCachedAgents } from '../../cache'
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

  // Loose connection match: a NULL `triggerConnectionId` matches any incoming
  // connectionId; otherwise it must equal exactly. Mirrors the SQL filter in
  // the old `getAgentTriggersByApp` helper.
  const agents = await getCachedAgents(organizationId)
  const matches: Array<{
    agentId: string
    triggerId: string
    config: Record<string, unknown> | null
  }> = []
  for (const agent of agents) {
    for (const trigger of agent.triggers) {
      if (trigger.kind !== 'app' || !trigger.enabled) continue
      if (trigger.triggerAppId !== appId) continue
      if (trigger.triggerAppTriggerId !== triggerId) continue
      if (trigger.triggerInstallationId !== appInstallationId) continue
      if (
        trigger.triggerConnectionId !== null &&
        trigger.triggerConnectionId !== (connectionId ?? null)
      ) {
        continue
      }
      matches.push({ agentId: agent.id, triggerId: trigger.id, config: trigger.config })
    }
  }

  if (matches.length === 0) {
    logger.debug('No matching agent triggers for app event', {
      appId,
      triggerId,
      installationId: appInstallationId,
    })
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
    matched: matches.length,
    enqueued,
  })

  return { agentSessionsEnqueued: enqueued }
}
