// packages/lib/src/ai/agent-framework/sessions/find-or-create-thread-session.ts

import { type AiAgentSessionEntity, database, schema } from '@auxx/database'
import { createSession } from '@auxx/services'
import { and, eq, sql } from 'drizzle-orm'
import { createScopedLogger } from '../../../logger'

const logger = createScopedLogger('find-or-create-thread-session')

/**
 * The `triggerContext` shape stored on chat sessions. Mirrors the audit
 * answer to "why did this agent fire?" for chat — there is no `AgentTrigger`
 * row (chat binds via `ChatWidget.agentId`). See plans/chat/v5 phase-3.
 */
export interface ChatTriggerContext {
  kind: 'chat'
  threadId: string
  contactId: string | null
}

export interface FindOrCreateThreadSessionInput {
  organizationId: string
  /** The chat-kind agent answering the thread. */
  agentId: string
  /** The agent's backing User row — owns the session. */
  agentUserId: string
  /** The chat `Thread` this session is anchored to (1:1, long-lived). */
  threadId: string
  /** Verified contact, when the visitor has been promoted; else null. */
  contactId: string | null
  /** Per-agent model override in `provider:model` format; null = inherit. */
  modelId: string | null
}

/**
 * Find the long-lived `AiAgentSession` for a chat thread, or create it.
 *
 * Chat keeps **one session per `Thread`**, reused across every turn so the
 * agent has full conversation memory. The lookup keys on
 * `type='kopilot' ∧ agentId ∧ triggerContext->>'threadId'`; chat reuses the
 * kopilot domain config, with `triggerContext.kind === 'chat'` as the
 * distinguisher and `agentTriggerId = null`.
 *
 * Per-thread serialization rides the `chat-turn:{threadId}` BullMQ jobId
 * (only one turn per thread runs at a time), so a find-then-create here can't
 * realistically race. The find is still scoped tightly enough that a
 * pathological double-run would at worst create a second session, never
 * corrupt one.
 */
export async function findOrCreateThreadSession(
  input: FindOrCreateThreadSessionInput
): Promise<AiAgentSessionEntity> {
  const { organizationId, agentId, agentUserId, threadId, contactId, modelId } = input

  const [existing] = await database
    .select()
    .from(schema.AiAgentSession)
    .where(
      and(
        eq(schema.AiAgentSession.organizationId, organizationId),
        eq(schema.AiAgentSession.type, 'kopilot'),
        eq(schema.AiAgentSession.agentId, agentId),
        sql`${schema.AiAgentSession.triggerContext}->>'threadId' = ${threadId}`
      )
    )
    .limit(1)

  if (existing) return existing

  const triggerContext: ChatTriggerContext = { kind: 'chat', threadId, contactId }
  const created = await createSession({
    organizationId,
    userId: agentUserId,
    type: 'kopilot',
    modelId,
    agentId,
    agentTriggerId: null,
    triggerContext,
  })

  if (created.isErr()) {
    logger.error('Failed to create chat thread session', {
      organizationId,
      agentId,
      threadId,
      error: created.error.message,
    })
    throw new Error(`Failed to create chat session: ${created.error.message}`)
  }

  return created.value
}
