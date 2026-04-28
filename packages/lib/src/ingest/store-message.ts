// packages/lib/src/ingest/store-message.ts

import { schema } from '@auxx/database'
import { ParticipantRole as ParticipantRoleEnum, ThreadStatus } from '@auxx/database/enums'
import type { ParticipantEntity as Participant, ParticipantRole } from '@auxx/database/types'
import { and, eq, isNull } from 'drizzle-orm'
import { touchActivityForThreadLinks } from '../entity-instances/activity'
import type { IngestContext } from './context'
import { shouldIgnoreMessage } from './filtering/should-ignore'
import { storeIgnoredMessage } from './filtering/store-ignored'
import { findOrCreateParticipantRecord } from './participants/find-or-create'
import { determineIdentifierType, normalizeIdentifier } from './participants/normalize'
import { extractInternetMessageId } from './reconciliation/extract-internet-message-id'
import { reconcileMessage } from './reconciliation/reconcile-message'
import { updateThreadMetadataEfficient } from './threads/update-metadata'
import type { IntegrationSettings, MessageData, ParticipantInputData } from './types'

/**
 * Store a single inbound/outbound message with full ingest pipeline:
 * reconciliation → participants → thread upsert → message upsert →
 * message-participant links → thread metadata update.
 *
 * Returns the new or matched message id and whether it was newly inserted.
 * Mirrors the legacy `MessageStorageService.storeMessage` semantics byte-for-byte.
 */
export async function storeMessage(
  ctx: IngestContext,
  messageData: MessageData
): Promise<{ messageId: string; isNew: boolean }> {
  if (!messageData.from?.identifier) {
    throw new Error(
      `Message externalId ${messageData.externalId} is missing required sender identifier.`
    )
  }

  try {
    // Priority reconciliation by Internet Message-ID. Avoids duplicate threads/messages
    // when the same message arrives via two paths (e.g. local sent + provider pull).
    const existingByMsgId = messageData.internetMessageId
      ? (
          await ctx.db
            .select({
              id: schema.Message.id,
              threadId: schema.Message.threadId,
              externalId: schema.Message.externalId,
              textPlain: schema.Message.textPlain,
              textHtml: schema.Message.textHtml,
            })
            .from(schema.Message)
            .where(
              and(
                eq(schema.Message.organizationId, messageData.organizationId),
                eq(schema.Message.internetMessageId, messageData.internetMessageId)
              )
            )
            .limit(1)
        )?.[0]
      : null

    if (existingByMsgId) {
      ctx.logger.info('Reconciling message by internetMessageId', {
        messageId: existingByMsgId.id,
        internetMessageId: messageData.internetMessageId,
        incomingExternalId: messageData.externalId,
      })

      await ctx.db
        .update(schema.Message)
        .set({
          externalId: messageData.externalId,
          externalThreadId: messageData.externalThreadId,
          textPlain: existingByMsgId.textPlain ?? messageData.textPlain,
          textHtml: messageData.htmlBodyStorageLocationId
            ? null
            : (existingByMsgId.textHtml ?? messageData.textHtml),
          snippet: messageData.snippet ?? null,
          htmlBodyStorageLocationId: messageData.htmlBodyStorageLocationId ?? undefined,
          hasAttachments: messageData.hasAttachments,
          metadata: messageData.metadata ?? {},
          receivedAt: messageData.receivedAt,
          sentAt: messageData.sentAt,
          historyId: messageData.historyId ? BigInt(messageData.historyId) : null,
          isInbound: messageData.isInbound,
          updatedAt: new Date(),
        })
        .where(eq(schema.Message.id, existingByMsgId.id))

      if (messageData.externalThreadId && existingByMsgId.threadId) {
        const [thread] = await ctx.db
          .select({ externalId: schema.Thread.externalId })
          .from(schema.Thread)
          .where(eq(schema.Thread.id, existingByMsgId.threadId))
          .limit(1)

        if (
          thread &&
          (!thread.externalId ||
            thread.externalId.startsWith('new_') ||
            thread.externalId.startsWith('pending_'))
        ) {
          await ctx.db
            .update(schema.Thread)
            .set({ externalId: messageData.externalThreadId })
            .where(eq(schema.Thread.id, existingByMsgId.threadId))

          ctx.logger.info('Updated thread with real externalId', {
            threadId: existingByMsgId.threadId,
            externalId: messageData.externalThreadId,
          })
        }
      }

      await updateThreadMetadataEfficient(ctx, existingByMsgId.threadId)
      return { messageId: existingByMsgId.id, isNew: false }
    }

    const existingMessage = await reconcileMessage(ctx, messageData)
    if (existingMessage) {
      ctx.logger.info('Message reconciled with existing record via MessageReconcilerService', {
        messageId: existingMessage.id,
        externalId: messageData.externalId,
      })

      if (existingMessage.threadId && messageData.externalThreadId) {
        const [thread] = await ctx.db
          .select({ externalId: schema.Thread.externalId })
          .from(schema.Thread)
          .where(eq(schema.Thread.id, existingMessage.threadId))
          .limit(1)

        const ext = thread?.externalId
        if (
          !ext ||
          ext.startsWith('new_') ||
          ext.startsWith('pending_') ||
          ext.startsWith('draft_') ||
          (ext.includes('-') && ext.length === 36)
        ) {
          await ctx.db
            .update(schema.Thread)
            .set({ externalId: messageData.externalThreadId })
            .where(eq(schema.Thread.id, existingMessage.threadId))

          ctx.logger.info('Promoted thread externalId from placeholder during reconciliation', {
            threadId: existingMessage.threadId,
            oldExternalId: ext,
            newExternalId: messageData.externalThreadId,
          })
        }
      }

      if (existingMessage.threadId) {
        await updateThreadMetadataEfficient(ctx, existingMessage.threadId)
      }

      return { messageId: existingMessage.id, isNew: false }
    }

    ctx.logger.info('Storing new message (Schema: Msg->Participant)', {
      externalId: messageData.externalId,
      integrationId: messageData.integrationId,
    })

    if (!ctx.integrationSettings && messageData.integrationId) {
      const [integration] = await ctx.db
        .select({ metadata: schema.Integration.metadata })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, messageData.integrationId),
            isNull(schema.Integration.deletedAt)
          )
        )
        .limit(1)

      ctx.integrationSettings =
        ((integration?.metadata as any)?.settings as IntegrationSettings | undefined) ?? undefined
    }

    if (shouldIgnoreMessage(ctx, messageData)) {
      return storeIgnoredMessage(ctx, messageData)
    }

    const participantInputsWithRoles: Array<{
      role: ParticipantRole
      data: ParticipantInputData
    }> = []

    // Per-message cache (NOT per-batch) — dedupes when the same identifier
    // appears in multiple roles on this message, and the iteration below is
    // how we derive the thread's participantCount. Sharing across messages
    // would over-count.
    const participantCache = new Map<string, Participant>()

    const processAndCacheParticipant = async (
      data: ParticipantInputData,
      role?: ParticipantRole
    ): Promise<Participant | null> => {
      if (!data?.identifier) return null
      const identifierType = await determineIdentifierType(
        ctx,
        data.identifier,
        messageData.integrationId
      )
      const normalizedId = normalizeIdentifier(data.identifier, identifierType)
      const cacheKey = `${identifierType}:${normalizedId}`

      const cached = participantCache.get(cacheKey)
      if (cached) return cached

      const messageContext = role ? { isInbound: messageData.isInbound, role } : undefined

      const participantRecord = await findOrCreateParticipantRecord(
        ctx,
        data,
        identifierType,
        messageContext
      )
      participantCache.set(cacheKey, participantRecord)
      return participantRecord
    }

    const allInputs = [
      { role: ParticipantRoleEnum.FROM, data: messageData.from },
      ...messageData.to.map((p) => ({ role: ParticipantRoleEnum.TO, data: p })),
      ...(messageData.cc || []).map((p) => ({ role: ParticipantRoleEnum.CC, data: p })),
      ...(messageData.bcc || []).map((p) => ({ role: ParticipantRoleEnum.BCC, data: p })),
      ...(messageData.replyTo || []).map((p) => ({ role: ParticipantRoleEnum.REPLY_TO, data: p })),
    ]

    for (const { role, data } of allInputs) {
      if (data?.identifier) {
        participantInputsWithRoles.push({ role, data })
        await processAndCacheParticipant(data, role)
      } else {
        ctx.logger.warn('Skipping participant input due to missing identifier', { role })
      }
    }

    const senderParticipant = await processAndCacheParticipant(
      messageData.from,
      ParticipantRoleEnum.FROM
    )
    if (!senderParticipant) {
      throw new Error(`Failed to process sender participant for message ${messageData.externalId}`)
    }
    const senderParticipantId = senderParticipant.id

    let firstReplyToParticipantId: string | null = null
    if (messageData.replyTo && messageData.replyTo.length > 0) {
      const replyToParticipant = await processAndCacheParticipant(
        messageData.replyTo[0],
        ParticipantRoleEnum.REPLY_TO
      )
      firstReplyToParticipantId = replyToParticipant?.id ?? null
    }

    const currentMessageParticipantIds: string[] = []
    for (const participant of participantCache.values()) {
      if (participant?.id) currentMessageParticipantIds.push(participant.id)
    }

    const threadData = await ctx.db
      .insert(schema.Thread)
      .values({
        externalId: messageData.externalThreadId,
        integrationId: messageData.integrationId,
        organizationId: messageData.organizationId,
        inboxId: messageData.inboxId ?? null,
        subject: messageData.subject ?? 'No Subject',
        status: ThreadStatus.OPEN,
        firstMessageAt: messageData.sentAt,
        lastMessageAt: messageData.sentAt,
        messageCount: 1,
        participantCount: currentMessageParticipantIds.length,
      })
      .onConflictDoUpdate({
        target: [schema.Thread.integrationId, schema.Thread.externalId],
        set: {
          subject: messageData.subject || undefined,
          inboxId: messageData.inboxId ?? undefined,
        },
      })
      .returning({
        id: schema.Thread.id,
        messageCount: schema.Thread.messageCount,
        firstMessageAt: schema.Thread.firstMessageAt,
        lastMessageAt: schema.Thread.lastMessageAt,
        participantCount: schema.Thread.participantCount,
      })

    const thread = threadData[0]
    const isNewThread =
      (thread.messageCount ?? 0) === 1 &&
      thread.firstMessageAt?.getTime() === messageData.sentAt.getTime()

    const messageRecords = await ctx.db
      .insert(schema.Message)
      .values({
        externalThreadId: messageData.externalThreadId,
        threadId: thread.id,
        organizationId: messageData.organizationId,
        integrationId: messageData.integrationId,
        historyId: messageData.historyId ? Number(messageData.historyId) : null,
        createdAt: messageData.createdTime,
        updatedAt: new Date(),
        sentAt: messageData.sentAt,
        receivedAt: messageData.receivedAt,
        internetMessageId: extractInternetMessageId(messageData) || messageData.internetMessageId,
        subject: messageData.subject ?? '',
        hasAttachments: messageData.hasAttachments,
        textHtml: messageData.htmlBodyStorageLocationId ? null : messageData.textHtml,
        textPlain: messageData.textPlain,
        snippet: messageData.snippet,
        htmlBodyStorageLocationId: messageData.htmlBodyStorageLocationId ?? null,
        metadata: messageData.metadata || null,
        isInbound: messageData.isInbound,
        isFirstInThread: isNewThread,
        fromId: senderParticipantId,
        replyToId: firstReplyToParticipantId,
      })
      .onConflictDoUpdate({
        target: [schema.Message.integrationId, schema.Message.externalId],
        set: {
          threadId: thread.id,
          historyId: messageData.historyId ? Number(messageData.historyId) : null,
          updatedAt: new Date(),
          sentAt: messageData.sentAt,
          receivedAt: messageData.receivedAt,
          subject: messageData.subject || '',
          hasAttachments: messageData.hasAttachments,
          textHtml: messageData.htmlBodyStorageLocationId ? null : messageData.textHtml,
          textPlain: messageData.textPlain,
          snippet: messageData.snippet,
          htmlBodyStorageLocationId: messageData.htmlBodyStorageLocationId ?? null,
          metadata: messageData.metadata || null,
          isInbound: messageData.isInbound,
          fromId: senderParticipantId,
          replyToId: firstReplyToParticipantId,
        },
      })
      .returning({ id: schema.Message.id })

    const messageRecord = messageRecords[0]

    if (isNewThread && messageRecord?.id) {
      await ctx.db
        .update(schema.Thread)
        .set({ latestMessageId: messageRecord.id })
        .where(eq(schema.Thread.id, thread.id))
    }

    const messageParticipantData: any[] = []
    for (const { role, data } of participantInputsWithRoles) {
      if (!data?.identifier) continue
      const identifierType = await determineIdentifierType(
        ctx,
        data.identifier,
        messageData.integrationId
      )
      const normalizedId = normalizeIdentifier(data.identifier, identifierType)
      const participantId = participantCache.get(`${identifierType}:${normalizedId}`)?.id
      if (participantId) {
        messageParticipantData.push({
          messageId: messageRecord.id,
          participantId,
          role,
        })
      } else {
        ctx.logger.error(
          `Participant ID not found in cache for ${normalizedId} while creating MessageParticipant links.`
        )
      }
    }
    if (messageParticipantData.length > 0) {
      await ctx.db
        .insert(schema.MessageParticipant)
        .values(messageParticipantData)
        .onConflictDoNothing()

      ctx.logger.debug(
        `Created/Skipped ${messageParticipantData.length} MessageParticipant links for message ${messageRecord.id}`
      )
    }

    const shouldUpdateThreadMetadata =
      !isNewThread &&
      (!thread.firstMessageAt ||
        !thread.lastMessageAt ||
        messageData.sentAt < thread.firstMessageAt ||
        messageData.sentAt > thread.lastMessageAt)

    if (shouldUpdateThreadMetadata) {
      await updateThreadMetadataEfficient(ctx, thread.id)
    }

    // Advance lastActivityAt for any entity linked to this thread (primary +
    // active secondaries). Best-effort; helper logs and swallows on failure.
    await touchActivityForThreadLinks(thread.id, messageData.organizationId, messageData.sentAt)

    ctx.logger.info('Message stored successfully (Revised Schema v2)', {
      messageId: messageRecord.id,
      externalId: messageData.externalId,
    })
    return { messageId: messageRecord.id, isNew: true }
  } catch (error: any) {
    ctx.logger.error('Error storing message (Revised Schema v2):', {
      error: error.message,
      externalId: messageData?.externalId ?? 'UNKNOWN',
      stack: error.stack,
    })
    if (error.message?.includes('duplicate key') || error.code === '23505') {
      ctx.logger.warn(
        `Unique constraint violation storing message ${messageData?.externalId ?? 'UNKNOWN'}. Assuming already processed.`
      )
      const [existing] = await ctx.db
        .select({ id: schema.Message.id })
        .from(schema.Message)
        .where(
          and(
            eq(schema.Message.integrationId, messageData.integrationId),
            eq(schema.Message.externalId, messageData.externalId)
          )
        )
        .limit(1)

      if (existing) return { messageId: existing.id, isNew: false }
    }
    throw error
  }
}
