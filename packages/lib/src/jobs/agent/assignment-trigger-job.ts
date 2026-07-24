// packages/lib/src/jobs/agent/assignment-trigger-job.ts

import { createScopedLogger } from '@auxx/logger'
import { createSession } from '@auxx/services'
import { enqueueAgentJob } from '../../ai/agent-framework/enqueue-agent-job'
import { buildTriggerSeedMessage } from '../../ai/agent-framework/trigger-seed-message'
import { getCachedAgentById } from '../../cache'
import type { JobContext } from '../types'

const logger = createScopedLogger('agent-assignment-trigger-job')

export interface AgentAssignmentTriggerJobData {
  agentTriggerId: string
  agentId: string
  organizationId: string
  /** Canonical RecordId of the assigned ticket/thread (e.g. `ticket:abc`). */
  threadRecordId: string | null
  /**
   * User that performed the assignment. The **intersection bound** on the run's
   * capabilities (capability layer v2 §0.5) — never a run-as user. Nullable:
   * a system-driven assignment carries none, and the run then uses the agent
   * profile alone.
   */
  assignerUserId: string | null
  firedAt: string
}

/**
 * Fires when an agent is assigned to a ticket via `ticket:assignee:added`.
 *
 * The agent owns the run in every recorded sense — session row, engine
 * identity, authorship. The assigner (`assignerUserId`) rides along as
 * `invokerUserId`, so the run's effective permissions are
 * `min(agentProfile, assigner)` and the agent can't read through an assignment
 * what the assigner couldn't read themselves (capability layer v2 §0.5).
 */
export async function executeAgentAssignmentTrigger(
  ctx: JobContext<AgentAssignmentTriggerJobData>
) {
  const job = ctx.job
  const { agentTriggerId, agentId, organizationId, threadRecordId, assignerUserId, firedAt } =
    job.data

  const agent = await getCachedAgentById(organizationId, agentId)
  if (!agent || agent.archivedAt) {
    logger.warn('Agent missing or archived for assignment trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-missing' as const }
  }
  if (!agent.userId) {
    logger.warn('Agent has not completed setup — skipping assignment trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-not-ready' as const }
  }

  const trigger = agent.triggers.find((t) => t.id === agentTriggerId)
  if (!trigger || !trigger.enabled || trigger.kind !== 'assignment') {
    logger.warn('Stale agent assignment trigger — skipping', {
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
    // Human-triggered run — clamp capabilities to the assigner's (§0.5). Null
    // (system assignment) leaves the agent profile alone.
    invokerUserId: assignerUserId,
  })

  logger.info('Enqueued autonomous assignment-trigger run', {
    agentTriggerId,
    agentId,
    threadRecordId,
    sessionId: session.id,
  })

  return { success: true as const, sessionId: session.id }
}
