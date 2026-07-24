// packages/lib/src/jobs/agent/mention-trigger-job.ts

import { createScopedLogger } from '@auxx/logger'
import { createSession } from '@auxx/services'
import type { RecordId } from '@auxx/types/resource'
import { enqueueAgentJob } from '../../ai/agent-framework/enqueue-agent-job'
import { buildTriggerSeedMessage } from '../../ai/agent-framework/trigger-seed-message'
import { getCachedAgentById } from '../../cache'
import type { JobContext } from '../types'

const logger = createScopedLogger('agent-mention-trigger-job')

export interface AgentMentionTriggerJobData {
  agentTriggerId: string
  agentId: string
  organizationId: string
  commentId: string
  mentionerUserId: string
  parentRecordId: RecordId
  siblingReferences: RecordId[]
  firedAt: string
}

/**
 * Fires when an agent is referenced in a comment.
 *
 * The agent owns the run in every sense that is recorded: the session row, the
 * engine identity, and authorship are all `agent.userId`. The mentioner
 * (`mentionerUserId`) is the **intersection bound** on the run's capabilities —
 * it rides along as `invokerUserId` so the effective permissions are
 * `min(agentProfile, mentioner)`, and the agent can never read something through
 * a mention that the mentioner couldn't read themselves (capability layer v2
 * §0.5). It is not a run-as user and never changes who the run "is".
 */
export async function executeAgentMentionTrigger(ctx: JobContext<AgentMentionTriggerJobData>) {
  const job = ctx.job
  const {
    agentTriggerId,
    agentId,
    organizationId,
    commentId,
    mentionerUserId,
    parentRecordId,
    siblingReferences,
    firedAt,
  } = job.data

  const agent = await getCachedAgentById(organizationId, agentId)
  if (!agent || agent.archivedAt) {
    logger.warn('Agent missing or archived for mention trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-missing' as const }
  }
  if (!agent.userId) {
    logger.warn('Agent has not completed setup — skipping mention trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-not-ready' as const }
  }

  const trigger = agent.triggers.find((t) => t.id === agentTriggerId)
  if (!trigger || !trigger.enabled || trigger.kind !== 'mention') {
    logger.warn('Stale agent mention trigger — skipping', {
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
      kind: 'mention',
      commentId,
      mentionerUserId,
      parentRecordId,
      firedAt,
    },
    domainState: {
      mention: {
        commentId,
        mentionerUserId,
        parentRecordId,
        siblingReferences,
      },
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
    // Human-triggered run — clamp capabilities to the mentioner's (§0.5).
    invokerUserId: mentionerUserId,
  })

  logger.info('Enqueued autonomous mention-trigger run', {
    agentTriggerId,
    agentId,
    commentId,
    sessionId: session.id,
  })

  return { success: true as const, sessionId: session.id }
}
