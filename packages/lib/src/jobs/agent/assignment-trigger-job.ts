// packages/lib/src/jobs/agent/assignment-trigger-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { createSession } from '@auxx/services'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { enqueueAgentJob } from '../../ai/agent-framework/enqueue-agent-job'
import { buildTriggerSeedMessage } from '../../ai/agent-framework/trigger-seed-message'

const logger = createScopedLogger('agent-assignment-trigger-job')

export interface AgentAssignmentTriggerJobData {
  agentTriggerId: string
  agentId: string
  organizationId: string
  /** Canonical RecordId of the assigned ticket/thread (e.g. `ticket:abc`). */
  threadRecordId: string | null
  /** User that performed the assignment — becomes runAsUser for user-scope tools. */
  assignerUserId: string | null
  firedAt: string
}

/**
 * Fires when an agent is assigned to a ticket via `ticket:assignee:added`.
 * The agent owns the session; the assigner is recorded in trigger context.
 */
export async function executeAgentAssignmentTrigger(job: Job<AgentAssignmentTriggerJobData>) {
  const { agentTriggerId, agentId, organizationId, threadRecordId, assignerUserId, firedAt } =
    job.data

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

  if (!trigger || !trigger.enabled || trigger.kind !== 'assignment') {
    logger.warn('Stale agent assignment trigger — skipping', {
      agentTriggerId,
      reason: !trigger ? 'missing' : !trigger.enabled ? 'disabled' : 'wrong-kind',
    })
    return { skipped: true as const, reason: 'invalid-trigger' as const }
  }

  const [agent] = await db
    .select({ id: schema.Agent.id, userId: schema.Agent.userId, modelId: schema.Agent.modelId })
    .from(schema.Agent)
    .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
    .limit(1)

  if (!agent) {
    logger.warn('Agent missing for assignment trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-missing' as const }
  }
  if (!agent.userId) {
    logger.warn('Agent has not completed setup — skipping assignment trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-not-ready' as const }
  }

  const sessionResult = await createSession({
    organizationId,
    userId: agent.userId,
    type: 'kopilot',
    agentId,
    agentTriggerId,
    triggerContext: {
      kind: 'assignment',
      threadRecordId,
      assignerUserId,
      firedAt,
    },
    domainState: {
      assignment: { threadRecordId, assignerUserId },
    },
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

  logger.info('Enqueued autonomous assignment-trigger run', {
    agentTriggerId,
    agentId,
    threadRecordId,
    sessionId: session.id,
  })

  return { success: true as const, sessionId: session.id }
}
