// packages/lib/src/jobs/agent/mention-trigger-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { createSession } from '@auxx/services'
import type { RecordId } from '@auxx/types/resource'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { enqueueAgentJob } from '../../ai/agent-framework/enqueue-agent-job'
import { buildTriggerSeedMessage } from '../../ai/agent-framework/trigger-seed-message'

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
 * Fires when an agent is referenced in a comment. The mentioner (`mentionerUserId`)
 * becomes the run-as user — user-scope tools resolve via their credentials —
 * while the agent itself still owns the session row (`userId` below).
 */
export async function executeAgentMentionTrigger(job: Job<AgentMentionTriggerJobData>) {
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

  if (!trigger || !trigger.enabled || trigger.kind !== 'mention') {
    logger.warn('Stale agent mention trigger — skipping', {
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
    logger.warn('Agent missing for mention trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-missing' as const }
  }
  if (!agent.userId) {
    logger.warn('Agent has not completed setup — skipping mention trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-not-ready' as const }
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
  })

  logger.info('Enqueued autonomous mention-trigger run', {
    agentTriggerId,
    agentId,
    commentId,
    sessionId: session.id,
  })

  return { success: true as const, sessionId: session.id }
}
