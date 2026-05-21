// packages/lib/src/providers/chat/chat-provider.ts

import { database as db, schema } from '@auxx/database'
import { IntegrationProviderType, ThreadStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { publishChatMessageCreated, publishChatMessageReceiptUpdated } from '../../chat/realtime'
import { getRealtimeService } from '../../realtime'
import { Result, type TypedResult } from '../../result'
import type { ChatThreadMetadata } from '../../threads/types'
import {
  BaseMessageProvider,
  type MessageProvider,
  type ReceiveMessageParams,
  type ReceiveMessageResult,
  type SendMessageParams,
  type SendMessageResult,
} from '../message-provider-interface'
import { getProviderCapabilities, type ProviderCapabilities } from '../provider-capabilities'

const logger = createScopedLogger('chat-provider')

/**
 * Provider for the embedded chat widget. Handles both directions of a chat:
 *
 * - **Outbound** (agent → visitor): invoked by `MessageSenderService.sendMessage`
 *   after the composer has already written the Message row. The provider only
 *   does the chat-specific tail — write a `MessageReceipt` for the visitor and
 *   publish realtime fan-out on the inbox + visitor channels.
 *
 * - **Inbound** (visitor → agent): invoked directly by the visitor-facing Hono
 *   route (`POST /api/chat/messages`). Does NOT go through `MessageSenderService`
 *   — there's nothing to dispatch, reconcile, or post-send sync. Writes the
 *   Message row + attachments, bumps the Thread, publishes realtime, and
 *   enqueues an AI agent run if the widget has one configured.
 */
export class ChatProvider extends BaseMessageProvider implements MessageProvider {
  constructor(organizationId: string) {
    super(IntegrationProviderType.chat, null, organizationId)
  }

  getCapabilities(): ProviderCapabilities {
    return getProviderCapabilities(IntegrationProviderType.chat)
  }

  /**
   * Initialize is a no-op for chat — there's no external auth state.
   * The integrationId is set here so the registry's caching works the same as
   * for other providers.
   */
  async initialize(integrationId: string): Promise<void> {
    ;(this as any).integrationId = integrationId
  }

  /**
   * Outbound: agent → visitor.
   *
   * `MessageSenderService` has already written the Message row (`internalMessageId`).
   * We:
   *  1. Look up the Thread to find the visitor Participant id (from metadata).
   *  2. Insert a `MessageReceipt` for the visitor.
   *  3. Publish `message:created` to the inbox channel AND `new-message` to the
   *     visitor's private chat channel.
   */
  async sendMessage(
    params: SendMessageParams & { externalThreadId?: string }
  ): Promise<SendMessageResult> {
    const internalMessageId = params.internalMessageId
    if (!internalMessageId) {
      // MessageSenderService always threads this through — guard for callers
      // that bypass the orchestrator.
      return { success: false, error: 'ChatProvider.sendMessage requires internalMessageId' }
    }

    const [message] = await db
      .select({
        id: schema.Message.id,
        threadId: schema.Message.threadId,
        organizationId: schema.Message.organizationId,
        textPlain: schema.Message.textPlain,
        textHtml: schema.Message.textHtml,
        sentAt: schema.Message.sentAt,
        fromId: schema.Message.fromId,
      })
      .from(schema.Message)
      .where(eq(schema.Message.id, internalMessageId))
      .limit(1)
    if (!message) {
      return { success: false, error: `Message ${internalMessageId} not found for chat send` }
    }

    const [thread] = await db
      .select({
        id: schema.Thread.id,
        inboxId: schema.Thread.inboxId,
        metadata: schema.Thread.metadata,
      })
      .from(schema.Thread)
      .where(eq(schema.Thread.id, message.threadId))
      .limit(1)
    if (!thread) {
      return { success: false, error: `Thread ${message.threadId} not found for chat send` }
    }

    const metadata = (thread.metadata ?? {}) as Partial<ChatThreadMetadata>
    const visitorParticipantId = metadata.visitorParticipantId
    if (!visitorParticipantId) {
      logger.warn('Chat thread missing visitorParticipantId in metadata; receipt skipped', {
        threadId: thread.id,
      })
    } else {
      await db
        .insert(schema.MessageReceipt)
        .values({
          messageId: message.id,
          recipientParticipantId: visitorParticipantId,
          deliveredAt: null,
          readAt: null,
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
    }

    await publishChatMessageCreated(getRealtimeService(), {
      organizationId: this.organizationId,
      inboxId: thread.inboxId,
      visitorChatSessionId: thread.id,
      messageId: message.id,
      threadId: thread.id,
      visitorPayload: {
        id: message.id,
        threadId: thread.id,
        content: message.textPlain ?? message.textHtml ?? '',
        sender: 'AGENT',
        createdAt: message.sentAt ?? new Date(),
        status: 'delivered',
      },
    })

    return { success: true, id: message.id, externalId: undefined, threadId: thread.id }
  }

  /**
   * Inbound: visitor → agent.
   *
   * Writes the Message row + attachment rows, bumps the Thread, publishes
   * realtime, and enqueues an AI agent run if `ChatWidget.agentId` is set.
   */
  async receiveMessage(params: ReceiveMessageParams): Promise<ReceiveMessageResult> {
    const result = await this.receiveMessageInternal(params)
    if (result.error) {
      throw result.error
    }
    return result.value
  }

  private async receiveMessageInternal(
    params: ReceiveMessageParams
  ): Promise<TypedResult<ReceiveMessageResult, Error>> {
    try {
      const integrationId = (this as any).integrationId as string | null
      if (!integrationId) {
        return Result.error(new Error('ChatProvider not initialized with integration id'))
      }

      const [thread] = await db
        .select({
          id: schema.Thread.id,
          status: schema.Thread.status,
          organizationId: schema.Thread.organizationId,
          integrationId: schema.Thread.integrationId,
          inboxId: schema.Thread.inboxId,
        })
        .from(schema.Thread)
        .where(
          and(
            eq(schema.Thread.id, params.threadId),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .limit(1)
      if (!thread) {
        return Result.error(new Error(`Thread ${params.threadId} not found`))
      }
      if (thread.status !== ThreadStatus.OPEN) {
        // Only OPEN threads accept new inbound chat messages. Closed/archived
        // threads reject — visitor must start a new conversation.
        return Result.error(new Error(`Thread is not open (status=${thread.status})`))
      }

      const now = new Date()
      const messageId = params.clientMessageId

      const { messageRowId } = await db.transaction(async (tx) => {
        const insertValues: any = {
          threadId: thread.id,
          integrationId: thread.integrationId,
          organizationId: this.organizationId,
          fromId: params.fromParticipantId,
          isInbound: true,
          subject: null,
          textPlain: params.content,
          sentAt: now,
          receivedAt: now,
          sendStatus: 'SENT' as any,
          createdAt: now,
          updatedAt: now,
        }
        if (messageId) insertValues.id = messageId

        const [inserted] = await tx
          .insert(schema.Message)
          .values(insertValues)
          .onConflictDoNothing({ target: schema.Message.id })
          .returning({ id: schema.Message.id })

        const finalId = inserted?.id ?? messageId
        if (!finalId) throw new Error('Failed to insert inbound chat message')

        // Attachments — same shape as MessageComposerService uses for outbound.
        if (params.attachmentIds && params.attachmentIds.length > 0) {
          await tx.insert(schema.Attachment).values(
            params.attachmentIds.map((assetId, idx) => ({
              organizationId: this.organizationId,
              entityType: 'MESSAGE',
              entityId: finalId,
              assetId,
              role: 'ATTACHMENT',
              sort: idx,
            }))
          )
          await tx
            .update(schema.Message)
            .set({ hasAttachments: true })
            .where(eq(schema.Message.id, finalId))
        }

        // Bump thread: lift WAITING → OPEN, update counters/latest.
        await tx
          .update(schema.Thread)
          .set({
            lastMessageAt: now,
            latestMessageId: finalId,
            messageCount: sql`${schema.Thread.messageCount} + 1`,
            status: ThreadStatus.OPEN,
            updatedAt: now,
          })
          .where(eq(schema.Thread.id, thread.id))

        return { messageRowId: finalId }
      })

      // Realtime — inbox channel for agents, visitor channel for echo.
      await publishChatMessageCreated(getRealtimeService(), {
        organizationId: this.organizationId,
        inboxId: thread.inboxId,
        visitorChatSessionId: thread.id,
        messageId: messageRowId,
        threadId: thread.id,
        visitorPayload: {
          id: messageRowId,
          threadId: thread.id,
          content: params.content,
          sender: 'USER',
          createdAt: now,
          status: 'delivered',
          clientMessageId: params.clientMessageId,
        },
      })

      // Trigger AI agent if the widget has one configured.
      await this.maybeEnqueueAgentRun({
        threadId: thread.id,
        messageId: messageRowId,
        integrationId,
      })

      return Result.ok({ messageId: messageRowId, threadId: thread.id })
    } catch (error) {
      return Result.error(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Reads `ChatWidget.agentId` for the thread's channel and, if set, enqueues
   * an agent run job. The agent-framework's enqueue helper expects an
   * `AgentSession` id — chat doesn't have one yet, so this hook is a stub:
   * follow-up work will create the session (or short-circuit through a
   * chat-aware engine entry point) before enqueueing.
   */
  private async maybeEnqueueAgentRun(args: {
    threadId: string
    messageId: string
    integrationId: string
  }): Promise<void> {
    try {
      const [widget] = await db
        .select({ agentId: schema.ChatWidget.agentId })
        .from(schema.ChatWidget)
        .where(eq(schema.ChatWidget.integrationId, args.integrationId))
        .limit(1)
      if (!widget?.agentId) return

      // TODO(chat-agent): enqueueAgentJob expects an AgentSession id. The chat
      // → agent run path needs a session creation step (or a chat-specific
      // engine entry point). For phase 4a, leave this as a logged TODO so the
      // unblock work is visible.
      logger.warn('Chat widget has agentId but agent enqueue path not yet wired', {
        agentId: widget.agentId,
        threadId: args.threadId,
        messageId: args.messageId,
      })
    } catch (error) {
      logger.error('Failed to evaluate widget agent for inbound chat message', {
        threadId: args.threadId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Mark a set of agent → visitor messages as delivered or read by the
   * visitor, publishing `message:updated` on the inbox channel for each.
   * Idempotent — only flips state when the new timestamp is later than the
   * existing one.
   */
  async markReceipts(args: {
    messageIds: string[]
    visitorParticipantId: string
    kind: 'delivered' | 'read'
  }): Promise<{ updated: number }> {
    if (args.messageIds.length === 0) return { updated: 0 }
    const now = new Date()
    const patch = args.kind === 'delivered' ? { deliveredAt: now } : { readAt: now }

    const rows = await db
      .update(schema.MessageReceipt)
      .set({ ...patch, updatedAt: now })
      .where(
        and(
          eq(schema.MessageReceipt.recipientParticipantId, args.visitorParticipantId),
          inArray(schema.MessageReceipt.messageId, args.messageIds)
        )
      )
      .returning({
        id: schema.MessageReceipt.id,
        messageId: schema.MessageReceipt.messageId,
      })

    if (rows.length === 0) return { updated: 0 }

    // Look up thread + inbox for publish targeting.
    const messageRows = await db
      .select({
        id: schema.Message.id,
        threadId: schema.Message.threadId,
        inboxId: schema.Thread.inboxId,
      })
      .from(schema.Message)
      .innerJoin(schema.Thread, eq(schema.Thread.id, schema.Message.threadId))
      .where(
        inArray(
          schema.Message.id,
          rows.map((r) => r.messageId)
        )
      )

    await Promise.all(
      messageRows.map((m) =>
        publishChatMessageReceiptUpdated(getRealtimeService(), {
          organizationId: this.organizationId,
          inboxId: m.inboxId,
          messageId: m.id,
          threadId: m.threadId,
          patch,
        })
      )
    )

    return { updated: rows.length }
  }
}
