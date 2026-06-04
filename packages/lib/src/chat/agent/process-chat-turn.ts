// packages/lib/src/chat/agent/process-chat-turn.ts

import { database, schema } from '@auxx/database'
import { saveSessionMessages, updateSessionDomainState } from '@auxx/services'
import { and, desc, eq, gt } from 'drizzle-orm'
import {
  AgentEngine,
  buildCatchupMessages,
  findOrCreateThreadSession,
  type SessionMessage,
} from '../../ai/agent-framework'
import { getCachedAgentById } from '../../cache'
import type { JobContext } from '../../jobs/types'
import { createScopedLogger } from '../../logger'
import { sendAgentChatMessage } from '../outbound'
import { buildChatEngineConfig } from './build-chat-engine-config'
import { buildChatSubjectFromPassport } from './build-chat-subject'
import type { ChatTurnJobPayload } from './enqueue-chat-turn'

const logger = createScopedLogger('process-chat-turn')

/**
 * Worker handler for one visitor chat turn (plans/chat/v5 phase-3b §3). Mirrors
 * `processAgentMessage`, swapping in the per-thread chat session + a Pusher
 * reply sink. Runs on the dedicated `chat-agent` queue.
 */
export async function processChatTurn(ctx: JobContext<ChatTurnJobPayload>): Promise<void> {
  const { data, signal } = ctx
  const {
    organizationId,
    agentId,
    threadId,
    participantId,
    contactId,
    identityVerified,
    claimed,
    inboundMessageId,
  } = data

  logger.info('Processing chat turn', { organizationId, agentId, threadId, inboundMessageId })

  // Resolve the agent + its backing User. A chat-kind agent bound to a widget
  // has completed setup (userId set); guard defensively so a mis-bound draft
  // can't crash the worker.
  const agent = await getCachedAgentById(organizationId, agentId)
  if (!agent || !agent.userId) {
    logger.warn('Chat turn skipped — agent missing or has no backing user', {
      organizationId,
      agentId,
    })
    return
  }
  const agentUserId = agent.userId

  // Load the triggering inbound message.
  const [inbound] = await database
    .select({ textPlain: schema.Message.textPlain, createdAt: schema.Message.createdAt })
    .from(schema.Message)
    .where(
      and(
        eq(schema.Message.id, inboundMessageId),
        eq(schema.Message.organizationId, organizationId)
      )
    )
    .limit(1)
  const inboundText = (inbound?.textPlain ?? '').trim()
  if (!inboundText) {
    logger.warn('Chat turn skipped — inbound message empty or not found', { inboundMessageId })
    return
  }

  // Reply-idempotency (retry after partial success): if the agent already
  // posted a reply newer than the inbound, this turn ran before — don't
  // double-post. See phase-3b §6.
  const [priorReply] = await database
    .select({ id: schema.Message.id })
    .from(schema.Message)
    .where(
      and(
        eq(schema.Message.threadId, threadId),
        eq(schema.Message.organizationId, organizationId),
        eq(schema.Message.isInbound, false),
        eq(schema.Message.createdById, agentUserId),
        gt(schema.Message.createdAt, inbound.createdAt)
      )
    )
    .orderBy(desc(schema.Message.createdAt))
    .limit(1)
  if (priorReply) {
    logger.info('Chat turn skipped — agent already replied (retry)', { threadId, inboundMessageId })
    return
  }

  const session = await findOrCreateThreadSession({
    organizationId,
    agentId,
    agentUserId,
    threadId,
    contactId,
    modelId: agent.modelId,
  })

  // Replay any thread messages the session hasn't recorded (takeover, multiple
  // visitor messages folded by jobId-dedup, etc.). The triggering inbound is
  // excluded — the engine appends it via `submitMessage`.
  const existingMessages = (session.messages ?? []) as SessionMessage[]
  const catchup = await buildCatchupMessages({
    organizationId,
    threadId,
    existingMessages,
    agentUserId,
    excludeMessageId: inboundMessageId,
  })

  // Build the turn's subject from the verified-passport inputs threaded onto
  // the job. `buildChatSubjectFromPassport` is the sole producer of the
  // `contact` anchor + `identityVerified` (plans/chat/v8 phase-1 trust invariant).
  const subject = buildChatSubjectFromPassport({
    threadId,
    participantId,
    contactId,
    identityVerified,
    claimed,
  })

  const config = await buildChatEngineConfig({
    organizationId,
    agentId,
    agentUserId,
    sessionId: session.id,
    subject,
    signal,
  })

  const engine = new AgentEngine(config, {
    messages: [...existingMessages, ...catchup],
    domainState: (session.domainState ?? {}) as Record<string, unknown>,
  })

  // Drain the turn, accumulating the final assistant text (last responder
  // message wins). Delivery is a single Pusher push on completion — no
  // per-delta streaming for v5.
  let finalText = ''
  for await (const event of engine.submitMessage(inboundText, {})) {
    if (signal?.aborted) {
      engine.interrupt()
      break
    }
    if (event.type === 'assistant-message-finished') {
      const text = event.parts
        .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('')
      if (text.trim()) finalText = text
    }
  }

  const finalState = engine.getState()
  const messages = finalState.messages as SessionMessage[]

  // Stamp the inbound user message (added by `submitMessage`) with its source
  // Message id so the NEXT turn's catchup-replay dedups it. Walk from the end
  // to the first un-stamped user turn.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && !m.metadata?.messageId) {
      m.metadata = { ...m.metadata, messageId: inboundMessageId }
      break
    }
  }

  const reply = finalText.trim()
  if (reply) {
    const sent = await sendAgentChatMessage(
      { db: database, organizationId },
      { threadId, agentUserId, content: reply }
    )
    if (sent.value) {
      // Stamp the engine's final assistant message with the reply Message id so
      // next turn's catchup doesn't re-add it from the Message table.
      const replyId = sent.value.id
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === 'assistant' && !m.metadata?.messageId) {
          m.metadata = { ...m.metadata, messageId: replyId }
          break
        }
      }
    } else {
      logger.error('Failed to persist agent chat reply', {
        threadId,
        error: sent.error?.message,
      })
    }
  } else {
    logger.warn('Chat turn produced no text reply', { threadId, inboundMessageId })
  }

  // Persist the grown session.
  await saveSessionMessages({
    sessionId: session.id,
    organizationId,
    messages: messages as unknown as Record<string, unknown>[],
  })
  await updateSessionDomainState({
    sessionId: session.id,
    organizationId,
    domainState: finalState.domainState as Record<string, unknown>,
  })

  logger.info('Chat turn processed', { threadId, replied: reply.length > 0 })
}
