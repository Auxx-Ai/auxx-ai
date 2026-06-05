// packages/lib/src/chat/agent/process-chat-turn.ts

import { database, schema } from '@auxx/database'
import { saveSessionMessages, updateSessionDomainState } from '@auxx/services'
import { and, desc, eq, gt } from 'drizzle-orm'
import {
  type ConversationMessage,
  runProcedureTurn,
  sessionMessagesToConversation,
} from '../../agents/procedures'
import {
  AgentEngine,
  type AgentEvent,
  buildCatchupMessages,
  findOrCreateThreadSession,
  type SessionMessage,
} from '../../ai/agent-framework'
import { KopilotContextStore, readContextSlice } from '../../ai/agent-framework/context'
import type { ToolContext } from '../../ai/agent-framework/tool-context'
import { getCachedAgentById } from '../../cache'
import type { JobContext } from '../../jobs/types'
import { createScopedLogger } from '../../logger'
import { sendAgentChatMessage } from '../outbound'
import { buildChatEngineConfig } from './build-chat-engine-config'
import { buildChatSubjectFromPassport } from './build-chat-subject'
import type { ChatTurnJobPayload } from './enqueue-chat-turn'
import { flipHandoffState } from './handoff'

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
    hasProcedures: agent.procedures.length > 0,
  })

  const engine = new AgentEngine(config, {
    messages: [...existingMessages, ...catchup],
    domainState: (session.domainState ?? {}) as Record<string, unknown>,
  })

  // Drain one engine pass, accumulating the final assistant text (last responder
  // message wins). Delivery is a single Pusher push on completion — no per-delta
  // streaming for v5.
  const drain = async (gen: AsyncGenerator<AgentEvent>): Promise<string> => {
    let text = ''
    for await (const event of gen) {
      if (signal?.aborted) {
        engine.interrupt()
        break
      }
      if (event.type === 'assistant-message-finished') {
        const t = event.parts
          .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
          .map((p) => p.text)
          .join('')
        if (t.trim()) text = t
      }
    }
    return text
  }

  // v9 procedures: when the agent has published procedures, sandwich the engine
  // drain between selection + the stepper (`runProcedureTurn`). Zero-procedure
  // agents run the unchanged single drain (provable no-op for today's agents).
  let finalText: string
  if (agent.procedures.length > 0) {
    const conversation: ConversationMessage[] = [
      ...sessionMessagesToConversation([...existingMessages, ...catchup]),
      { role: 'user', content: inboundText },
    ]
    const buildCtx = (): ToolContext => {
      const base = {
        db: database,
        organizationId,
        userId: agentUserId,
        sessionId: session.id,
        signal,
        subject,
        appAccounts: config.appAccounts,
      }
      return {
        ...base,
        context: new KopilotContextStore({
          ctx: base as ToolContext,
          initial: readContextSlice(engine.getState().domainState as Record<string, unknown>),
        }),
      }
    }
    finalText = await runProcedureTurn({
      engine,
      inboundText,
      procedures: agent.procedures,
      subject,
      conversation,
      classifyDeps: {
        db: database,
        organizationId,
        userId: agentUserId,
        // Low-stakes routing/classification runs on the cheap utility tier, not
        // the customer-facing reply model. See `ai/providers/utility-model.ts`.
        model:
          config.domainConfig.utilityModel ??
          config.domainConfig.defaultModel ??
          'claude-haiku-4-5',
        provider:
          config.domainConfig.utilityProvider ?? config.domainConfig.defaultProvider ?? 'anthropic',
      },
      buildCtx,
      drain,
      // Procedure escalation: a routing `handoff` step or the `handoff_to_human`
      // control tool flips this thread to the human queue (same sink as the
      // `chat_handoff` persona tool). Best-effort — a flip failure must not drop
      // the customer's closing reply.
      onHandoff: async () => {
        try {
          await flipHandoffState({ threadId, organizationId })
        } catch (err) {
          logger.error('Procedure handoff failed to flip thread', {
            threadId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    })
  } else {
    finalText = await drain(engine.submitMessage(inboundText, {}))
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
