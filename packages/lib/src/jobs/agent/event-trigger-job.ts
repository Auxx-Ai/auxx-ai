// packages/lib/src/jobs/agent/event-trigger-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { createSession } from '@auxx/services'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { enqueueAgentJob } from '../../ai/agent-framework/enqueue-agent-job'

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
export async function executeAgentEventTrigger(job: Job<AgentEventTriggerJobData>) {
  const { agentTriggerId, agentId, organizationId, eventType, recordId, resourceData, firedAt } =
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

  if (!trigger || !trigger.enabled || trigger.kind !== 'event') {
    logger.warn('Stale agent event trigger — skipping', {
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
    logger.warn('Agent missing for event trigger', { agentTriggerId })
    return { skipped: true as const, reason: 'agent-missing' as const }
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
  const message = buildSeedMessage(trigger.instructions, eventType, recordId)

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

  logger.info('Enqueued autonomous event-trigger run', {
    agentTriggerId,
    agentId,
    eventType,
    sessionId: session.id,
  })

  return { success: true as const, sessionId: session.id }
}

function buildSeedMessage(
  instructions: Record<string, unknown> | null | undefined,
  eventType: string,
  recordId: string | null
): string {
  if (instructions) {
    if (typeof instructions === 'string' && instructions.length > 0) return instructions
    const text = extractTiptapText(instructions)
    if (text) return text
  }
  if (recordId) {
    return `Event \`${eventType}\` fired for record ${recordId}. The triggering resource is in domain state under \`triggerResource\`. Run the trigger instructions.`
  }
  return `Event \`${eventType}\` fired. The payload is in domain state under \`triggerResource\`. Run the trigger instructions.`
}

function extractTiptapText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const obj = node as Record<string, unknown>
  if (typeof obj.text === 'string') return obj.text
  const content = obj.content
  if (Array.isArray(content)) {
    return content.map(extractTiptapText).join(' ').trim()
  }
  return ''
}
