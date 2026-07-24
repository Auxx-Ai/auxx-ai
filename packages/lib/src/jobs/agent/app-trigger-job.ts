// packages/lib/src/jobs/agent/app-trigger-job.ts

import { createScopedLogger } from '@auxx/logger'
import { createSession } from '@auxx/services'
import { enqueueAgentJob } from '../../ai/agent-framework/enqueue-agent-job'
import { buildTriggerSeedMessage } from '../../ai/agent-framework/trigger-seed-message'
import { getCachedAgentById } from '../../cache'
import type { JobContext } from '../types'

const logger = createScopedLogger('agent-app-trigger-job')

export interface AgentAppTriggerJobData {
  agentTriggerId: string
  agentId: string
  organizationId: string
  /** App-trigger provenance (omitted for a webhook-endpoint trigger). */
  appId?: string
  triggerId?: string
  installationId?: string
  connectionId?: string | null
  /** Webhook-endpoint provenance (omitted for an app-trigger). */
  webhookEndpointId?: string
  topic?: string
  triggerData: Record<string, unknown>
  eventId: string
  firedAt: string
}

/**
 * Worker handler for autonomous app- and webhook-endpoint-driven triggers on
 * `AgentTrigger`. Sibling to the workflow `executeAppTriggeredWorkflow` path — runs
 * on the same scheduled-trigger queue as the other agent workers. Handles both
 * `kind: 'app'` (appId/triggerId/installationId) and `kind: 'webhook-endpoint'`
 * (webhookEndpointId/topic); the session triggerContext carries whichever is present.
 */
export async function executeAgentAppTrigger(ctx: JobContext<AgentAppTriggerJobData>) {
  const job = ctx.job
  const {
    agentTriggerId,
    agentId,
    organizationId,
    appId,
    triggerId,
    installationId,
    connectionId,
    webhookEndpointId,
    topic,
    triggerData,
    eventId,
    firedAt,
  } = job.data

  const agent = await getCachedAgentById(organizationId, agentId)
  if (!agent || agent.archivedAt) {
    logger.warn('Agent missing or archived for app trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-missing' as const }
  }
  if (!agent.userId) {
    logger.warn('Agent has not completed setup — skipping app trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-not-ready' as const }
  }

  const trigger = agent.triggers.find((t) => t.id === agentTriggerId)
  if (
    !trigger ||
    !trigger.enabled ||
    (trigger.kind !== 'app' && trigger.kind !== 'webhook-endpoint')
  ) {
    logger.warn('Stale agent app trigger — skipping', {
      agentTriggerId,
      reason: !trigger ? 'missing' : !trigger.enabled ? 'disabled' : 'wrong-kind',
    })
    return { skipped: true as const, reason: 'invalid-trigger' as const }
  }

  const sessionResult = await createSession({
    organizationId,
    userId: agent.userId,
    type: 'kopilot',
    agentId,
    agentTriggerId,
    triggerContext: {
      kind: trigger.kind,
      appId,
      triggerId,
      installationId,
      connectionId,
      webhookEndpointId,
      topic,
      eventId,
      firedAt,
    },
    domainState: { triggerResource: triggerData, appConnectionId: connectionId ?? null },
    modelId: agent.modelId,
  })

  if (sessionResult.isErr()) {
    throw new Error(`Failed to create session: ${sessionResult.error.message}`)
  }

  const session = sessionResult.value
  const message = buildTriggerSeedMessage()

  await enqueueAgentJob({
    sessionId: session.id,
    organizationId,
    userId: agent.userId,
    message,
    type: 'message',
    domain: 'kopilot',
    agentId,
    agentTriggerId,
    approvalMode: 'auto',
    modelId: agent.modelId ?? undefined,
    // No `invokerUserId`: an app/webhook payload has no human in the loop, so
    // the run uses the agent's own capability profile alone (capability layer
    // v2 §0.5). This is also the executor for webhook-endpoint dispatch.
  })

  logger.info('Enqueued autonomous app-trigger run', {
    agentTriggerId,
    agentId,
    appId,
    triggerId,
    sessionId: session.id,
  })

  return { success: true as const, sessionId: session.id }
}
