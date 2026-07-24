// packages/lib/src/jobs/agent/event-trigger-job.ts

import { createScopedLogger } from '@auxx/logger'
import { createSession } from '@auxx/services'
import { enqueueAgentJob } from '../../ai/agent-framework/enqueue-agent-job'
import { buildTriggerSeedMessage } from '../../ai/agent-framework/trigger-seed-message'
import { getCachedAgentById } from '../../cache'
import type { JobContext } from '../types'

const logger = createScopedLogger('agent-event-trigger-job')

export interface AgentEventTriggerJobData {
  agentTriggerId: string
  agentId: string
  organizationId: string
  eventType: string
  recordId: string | null
  resourceData: Record<string, unknown>
  firedAt: string
}

/**
 * Worker handler for autonomous event triggers on `AgentTrigger`. Sibling
 * to the workflow event-trigger path — same scheduled-trigger queue,
 * dispatched by `job.name = 'executeAgentEventTrigger'`.
 */
export async function executeAgentEventTrigger(ctx: JobContext<AgentEventTriggerJobData>) {
  const job = ctx.job
  const { agentTriggerId, agentId, organizationId, eventType, recordId, resourceData, firedAt } =
    job.data

  const agent = await getCachedAgentById(organizationId, agentId)
  if (!agent || agent.archivedAt) {
    logger.warn('Agent missing or archived for event trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-missing' as const }
  }
  if (!agent.userId) {
    logger.warn('Agent has not completed setup — skipping event trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-not-ready' as const }
  }

  const trigger = agent.triggers.find((t) => t.id === agentTriggerId)
  if (!trigger || !trigger.enabled || trigger.kind !== 'event') {
    logger.warn('Stale agent event trigger — skipping', {
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
      kind: 'event',
      eventType,
      recordId,
      firedAt,
    },
    domainState: { triggerResource: resourceData },
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
    // No `invokerUserId` — deliberately NOT the editor whose change fired this
    // event. Record rules are side effects; scoping them per-editor would make
    // trigger behavior nondeterministic. Agent profile alone (capability layer
    // v2 §0.5).
  })

  logger.info('Enqueued autonomous event-trigger run', {
    agentTriggerId,
    agentId,
    eventType,
    sessionId: session.id,
  })

  return { success: true as const, sessionId: session.id }
}
