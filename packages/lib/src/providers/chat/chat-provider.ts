// packages/lib/src/providers/chat/chat-provider.ts

import { database as db, schema } from '@auxx/database'
import { IntegrationProviderType, ThreadStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { getCachedAgentById, getOrgCache } from '../../cache'
import { enqueueChatTurn } from '../../chat/agent/enqueue-chat-turn'
import { publishChatMessageCreated, publishChatMessageReceiptUpdated } from '../../chat/realtime'
import type { ChatAttachment } from '../../chat/types'
import { getRealtimeService } from '../../realtime'
import { publishMessageUpdated } from '../../realtime/publish-helpers'
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
 * Load non-inline attachment metadata for a single agent-sent message before
 * we publish the realtime frame. Gate the call site on
 * `Message.hasAttachments` — most replies are text-only.
 */
async function loadChatAttachmentsForMessage(
  organizationId: string,
  messageId: string
): Promise<ChatAttachment[]> {
  const rows = await db
    .select({
      id: schema.Attachment.id,
      title: schema.Attachment.title,
      assetName: schema.MediaAsset.name,
      assetMimeType: schema.MediaAsset.mimeType,
      assetSize: schema.MediaAsset.size,
      fileName: schema.FolderFile.name,
      fileMimeType: schema.FolderFile.mimeType,
      fileSize: schema.FolderFile.size,
    })
    .from(schema.Attachment)
    .leftJoin(schema.MediaAsset, eq(schema.MediaAsset.id, schema.Attachment.assetId))
    .leftJoin(schema.FolderFile, eq(schema.FolderFile.id, schema.Attachment.fileId))
    .where(
      and(
        eq(schema.Attachment.organizationId, organizationId),
        eq(schema.Attachment.entityType, 'MESSAGE'),
        eq(schema.Attachment.entityId, messageId),
        eq(schema.Attachment.role, 'ATTACHMENT')
      )
    )
    .orderBy(asc(schema.Attachment.sort))

  return rows.map((r) => ({
    id: r.id,
    name: r.title ?? r.assetName ?? r.fileName ?? 'attachment',
    mimeType: r.assetMimeType ?? r.fileMimeType ?? 'application/octet-stream',
    size: Number(r.assetSize ?? r.fileSize ?? 0),
  }))
}

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
        hasAttachments: schema.Message.hasAttachments,
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

    // Most agent replies are text-only; only join Attachment when the
    // composer flipped `hasAttachments`. Phase 5.5 — avoids one query per
    // reply on the common path.
    const attachments = message.hasAttachments
      ? await loadChatAttachmentsForMessage(this.organizationId, message.id)
      : undefined

    // `MessageSenderService` publishes `message:created` on the inbox channel
    // itself (with `excludeSocketId` for self-echo suppression). Skip the
    // duplicate here — without this, the originating tab receives an un-excluded
    // echo of its own send and falls into the deferred-fetch path.
    await publishChatMessageCreated(getRealtimeService(), {
      organizationId: this.organizationId,
      inboxId: thread.inboxId,
      visitorChatSessionId: thread.id,
      visitorParticipantId,
      messageId: message.id,
      threadId: thread.id,
      visitorPayload: {
        id: message.id,
        threadId: thread.id,
        content: message.textPlain ?? message.textHtml ?? '',
        sender: 'AGENT',
        createdAt: message.sentAt ?? new Date(),
        status: 'delivered',
        ...(attachments?.length ? { attachments } : {}),
      },
      skipInboxMessagePublish: true,
    })

    // When the message has attachments, push the server-authoritative
    // attachment metadata to the inbox channel as `message:updated`. The
    // sender's optimistic write uses staged file-ids (FolderFile / MediaAsset),
    // which don't resolve against `/api/attachments/{id}/{thumbnail,download}`
    // — those endpoints expect `Attachment.id`. No `excludeSocketId` here:
    // we *want* the sender to receive this patch and overwrite the optimistic
    // attachment array with real ids. Chat has no post-send sync, so without
    // this push the wrong ids stick.
    if (attachments?.length) {
      await publishMessageUpdated(getRealtimeService(), this.organizationId, {
        messageId: message.id,
        threadId: thread.id,
        inboxId: thread.inboxId,
        patch: {
          attachments: attachments.map((a) => ({
            id: a.id,
            name: a.name,
            mimeType: a.mimeType ?? null,
            size: a.size ?? null,
            url: null,
            inline: false,
            contentId: null,
          })),
        },
      })
    }

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
          handoffState: schema.Thread.handoffState,
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
          snippet: params.content ? params.content.slice(0, 280) : null,
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
          })
          .where(eq(schema.Thread.id, thread.id))

        return { messageRowId: finalId }
      })

      // Load attachment metadata for the realtime payload. The transaction
      // above already inserted Attachment rows for `params.attachmentIds`;
      // re-read by joining Attachment → MediaAsset so the publish carries
      // `Attachment.id` (the opaque id the URL endpoint resolves against).
      let attachments: ChatAttachment[] | undefined
      if (params.attachmentIds && params.attachmentIds.length > 0) {
        const rows = await loadChatAttachmentsForMessage(this.organizationId, messageRowId)
        if (rows.length > 0) {
          attachments = rows
        }
      }

      // Realtime — inbox channel for agents, visitor channel for echo.
      // The inbound sender IS the visitor, so their fromParticipantId is the
      // visitorParticipantId we publish per-visitor updates against.
      await publishChatMessageCreated(getRealtimeService(), {
        organizationId: this.organizationId,
        inboxId: thread.inboxId,
        visitorChatSessionId: thread.id,
        visitorParticipantId: params.fromParticipantId,
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
          ...(attachments?.length ? { attachments } : {}),
        },
      })

      // Trigger AI agent if the widget has one configured.
      await this.maybeEnqueueAgentRun({
        threadId: thread.id,
        messageId: messageRowId,
        integrationId,
        handoffState: thread.handoffState,
        participantId: params.fromParticipantId,
        contactId: params.contactId ?? null,
        identityVerified: params.identityVerified ?? false,
        claimed: params.claimed,
      })

      return Result.ok({ messageId: messageRowId, threadId: thread.id })
    } catch (error) {
      return Result.error(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * The phase-3 gate: decide whether an inbound visitor message fires the
   * bound chat-kind agent, and if so enqueue the turn onto the dedicated
   * `chat-agent` queue. `receiveMessageInternal` only ever calls this for an
   * inbound (visitor) message, so author disambiguation isn't needed — agent
   * and teammate replies go through the send path, never here.
   *
   * `contactId` stays null until promotion (phase 5); every identity-required
   * chat-safe tool short-circuits while it's null. See plans/chat/v5 phase-3.
   */
  private async maybeEnqueueAgentRun(args: {
    threadId: string
    messageId: string
    integrationId: string
    /** Read from the same Thread row receiveMessage already loaded. */
    handoffState: 'ai' | 'human'
    /** The inbound sender — the subject's `participant` anchor. */
    participantId: string
    /** Verified contact id from the passport; null when anonymous/unverified. */
    contactId: string | null
    /** `true` only when the passport was crypto-verified. */
    identityVerified: boolean
    /** Untrusted `identify()` claim — display only, never an anchor. */
    claimed?: { name?: string; email?: string }
  }): Promise<void> {
    try {
      // P4.2 gate — if a human took over this thread, never run the AI agent.
      // This is the earliest point we can short-circuit: before the widget
      // lookup, before any agent-framework work, before any draft/compose.
      if (args.handoffState === 'human') {
        logger.debug('Chat thread is in human handoff — skipping agent run', {
          threadId: args.threadId,
          messageId: args.messageId,
        })
        return
      }

      // Read agentId from the org `channels` cache instead of querying
      // ChatWidget on every inbound message. The cache already includes the
      // joined ChatWidget row and is invalidated on channel.connected /
      // channel.settings_updated / chat-widget edits.
      const channels = await getOrgCache().get(this.organizationId, 'channels')
      const channel = channels.find((c) => c.id === args.integrationId)
      const agentId = channel?.chatWidget?.agentId ?? null
      if (!agentId) return

      // Defensive chat-kind assert. Phase 2's `chatWidget.update` validation
      // guarantees only chat-kind agents are bindable, so this should never
      // fail — but a stale binding (agent kind can't change, but the agent
      // could be archived/deleted) shouldn't run a non-chat agent on a visitor.
      const agent = await getCachedAgentById(this.organizationId, agentId)
      if (!agent || agent.kind !== 'chat' || !agent.userId) {
        logger.warn('Chat widget agentId does not resolve to a live chat-kind agent — skipping', {
          agentId,
          threadId: args.threadId,
        })
        return
      }

      await enqueueChatTurn({
        organizationId: this.organizationId,
        agentId,
        threadId: args.threadId,
        participantId: args.participantId,
        // Verified-only: contactId is non-null/identityVerified solely when the
        // passport was crypto-verified (plans/chat/v8 phase-1 trust invariant).
        contactId: args.contactId,
        identityVerified: args.identityVerified,
        ...(args.claimed ? { claimed: args.claimed } : {}),
        inboundMessageId: args.messageId,
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
