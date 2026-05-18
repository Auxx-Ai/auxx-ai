// packages/lib/src/jobs/agent/scheduled-trigger-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { createSession } from '@auxx/services'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { AgentTriggerService } from '../../agents/agent-trigger-service'
import { enqueueAgentJob } from '../../ai/agent-framework/enqueue-agent-job'
import { buildTriggerSeedMessage } from '../../ai/agent-framework/trigger-seed-message'

const logger = createScopedLogger('agent-scheduled-trigger-job')

export interface AgentScheduledTriggerJobData {
  agentTriggerId: string
  agentId: string
  organizationId: string
}

/**
 * Worker handler for autonomous scheduled triggers on `AgentTrigger`.
 * Sibling to the workflow `executeScheduledTrigger` — same queue, dispatch
 * by `job.name = 'executeAgentScheduledTrigger'`.
 */
export async function executeAgentScheduledTrigger(job: Job<AgentScheduledTriggerJobData>) {
  const { agentTriggerId, agentId, organizationId } = job.data
  const service = new AgentTriggerService()

  // Auto-cleanup mirror of the workflow path: if the trigger row, agent, or
  // org is gone — or the trigger is disabled — remove the scheduler and bail.
  const [trigger] = await db
    .select()
    .from(schema.AgentTrigger)
    .where(
      and(
        eq(schema.AgentTrigger.id, agentTriggerId),
        eq(schema.AgentTrigger.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!trigger || !trigger.enabled || trigger.kind !== 'scheduled') {
    logger.warn('Stale agent scheduled trigger — removing scheduler', {
      agentTriggerId,
      reason: !trigger ? 'missing' : !trigger.enabled ? 'disabled' : 'wrong-kind',
    })
    await service.removeScheduledScheduler(agentTriggerId)
    return { skipped: true, reason: 'invalid-trigger' as const }
  }

  const [agent] = await db
    .select({ id: schema.Agent.id, userId: schema.Agent.userId, modelId: schema.Agent.modelId })
    .from(schema.Agent)
    .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
    .limit(1)

  if (!agent) {
    logger.warn('Agent missing for scheduled trigger — removing scheduler', { agentTriggerId })
    await service.removeScheduledScheduler(agentTriggerId)
    return { skipped: true, reason: 'agent-missing' as const }
  }
  if (!agent.userId) {
    logger.warn('Agent has not completed setup — skipping scheduled trigger', { agentTriggerId })
    return { skipped: true, reason: 'agent-not-ready' as const }
  }

  const firedAt = new Date().toISOString()
  const triggerContext = {
    kind: 'scheduled' as const,
    firedAt,
    schedulerId: job.opts.repeatJobKey ?? null,
  }

  const sessionResult = await createSession({
    organizationId,
    userId: agent.userId,
    type: 'kopilot',
    agentId,
    agentTriggerId,
    triggerContext,
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
  })

  logger.info('Enqueued autonomous scheduled-trigger run', {
    agentTriggerId,
    agentId,
    sessionId: session.id,
  })

  return { success: true, sessionId: session.id }
}
