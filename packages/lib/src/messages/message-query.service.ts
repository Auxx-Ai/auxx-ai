// packages/lib/src/messages/message-query.service.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { type ParticipantId, toParticipantId } from '@auxx/types'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getOrgChannelProviderMap } from '../providers/channel-cache'
import { getMessageTypeFromProvider } from '../providers/type-utils'
import { ChannelProviderType } from '../providers/types'
import type {
  AttachmentMeta,
  ListMessagesByThreadResult,
  MessageMeta,
  SendStatus,
} from './types/message-query.types'

const logger = createScopedLogger('message-query-service')

/**
 * Service for message read operations (queries).
 * Provides batch-fetch APIs for the ID-first architecture.
 */
export class MessageQueryService {
  private readonly organizationId: string
  private db: Database

  /**
   * Creates an instance of MessageQueryService.
   * @param organizationId - The ID of the organization this service operates for.
   * @param db - The Drizzle database instance.
   */
  constructor(organizationId: string, db: Database) {
    this.organizationId = organizationId
    this.db = db
  }

  /**
   * Get all messages for a thread with full metadata.
   * Single query - no separate ID listing step.
   */
  async getMessagesByThread(threadId: string): Promise<ListMessagesByThreadResult> {
    logger.debug('Fetching messages for thread', {
      organizationId: this.organizationId,
      threadId,
    })

    const providerMap = await getOrgChannelProviderMap(this.organizationId, this.db)

    // All messages in Message table are sent messages (drafts are in Draft table)
    const rows = await this.db.query.Message.findMany({
      where: and(
        eq(schema.Message.threadId, threadId),
        eq(schema.Message.organizationId, this.organizationId)
      ),
      orderBy: [
        sql`${schema.Message.receivedAt} ASC NULLS LAST`,
        sql`${schema.Message.sentAt} ASC NULLS LAST`,
        sql`${schema.Message.id} ASC`,
      ],
      columns: {
        id: true,
        threadId: true,
        subject: true,
        snippet: true,
        textHtml: true,
        textPlain: true,
        isInbound: true,
        isFirstInThread: true,
        hasAttachments: true,
        htmlBodyStorageLocationId: true,
        sentAt: true,
        receivedAt: true,
        createdAt: true,
        createdById: true,
        fromId: true,
        replyToId: true,
        integrationId: true,
        sendStatus: true,
        providerError: true,
        attempts: true,
      },
    })

    // Batch fetch all participant relationships
    const messageIds = rows.map((m) => m.id)
    const participantsByMessage = await this.getParticipantsForMessages(messageIds)
    const attachmentsByMessage = await this.getAttachmentsForMessages(messageIds)

    const messages: MessageMeta[] = rows.map((m) => {
      const participantData = participantsByMessage.get(m.id)
      const participants = this.buildParticipantIds(m, participantData)

      const provider = providerMap.get(m.integrationId) ?? ChannelProviderType.google
      const messageType = getMessageTypeFromProvider(provider)

      const hasObjectBackedHtml = !!m.htmlBodyStorageLocationId

      return {
        id: m.id,
        threadId: m.threadId,
        subject: m.subject,
        snippet: m.snippet,
        // Suppress full HTML blob when body is object-backed; UI fetches lazily
        textHtml: hasObjectBackedHtml ? null : m.textHtml,
        textPlain: m.textPlain,
        isInbound: m.isInbound,
        isFirstInThread: m.isFirstInThread ?? false,
        hasAttachments: m.hasAttachments,
        hasHtmlBody: hasObjectBackedHtml || !!m.textHtml,
        hasTextBody: !!m.textPlain,
        sentAt: m.sentAt?.toISOString() ?? null,
        receivedAt: m.receivedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
        participants,
        createdById: m.createdById,
        messageType,
        sendStatus: (m.sendStatus as SendStatus) ?? null,
        providerError: m.providerError ?? null,
        attempts: m.attempts ?? 0,
        attachments: attachmentsByMessage.get(m.id) ?? [],
      }
    })

    return { messages, total: messages.length }
  }

  /**
   * Batch fetch messages by ID.
   * Returns messages in same order as input IDs (missing IDs are excluded).
   */
  async getMessageMetaBatch(ids: string[]): Promise<MessageMeta[]> {
    if (ids.length === 0) return []
    if (ids.length > 100) throw new Error('Batch size exceeds limit of 100')

    logger.debug('Fetching message metadata batch', {
      organizationId: this.organizationId,
      count: ids.length,
    })

    // Get cached provider map for this organization
    const providerMap = await getOrgChannelProviderMap(this.organizationId, this.db)

    // Fetch messages
    const messages = await this.db.query.Message.findMany({
      where: and(
        inArray(schema.Message.id, ids),
        eq(schema.Message.organizationId, this.organizationId)
      ),
      columns: {
        id: true,
        threadId: true,
        subject: true,
        snippet: true,
        textHtml: true,
        textPlain: true,
        isInbound: true,
        isFirstInThread: true,
        hasAttachments: true,
        htmlBodyStorageLocationId: true,
        sentAt: true,
        receivedAt: true,
        createdAt: true,
        createdById: true,
        fromId: true,
        replyToId: true,
        integrationId: true,
        sendStatus: true,
        providerError: true,
        attempts: true,
      },
    })

    // Batch fetch participant IDs for recipients (to, cc, bcc)
    const messageIds = messages.map((m) => m.id)
    const participantsByMessage = await this.getParticipantsForMessages(messageIds)
    const attachmentsByMessage = await this.getAttachmentsForMessages(messageIds)

    // Create a map for quick lookup
    const messageMap = new Map(
      messages.map((m) => {
        const participantData = participantsByMessage.get(m.id)
        const participants = this.buildParticipantIds(m, participantData)

        // Derive messageType from integration provider
        const provider = providerMap.get(m.integrationId) ?? ChannelProviderType.google
        const messageType = getMessageTypeFromProvider(provider)

        const hasObjectBackedHtml = !!m.htmlBodyStorageLocationId

        const meta: MessageMeta = {
          id: m.id,
          threadId: m.threadId,
          subject: m.subject,
          snippet: m.snippet,
          textHtml: hasObjectBackedHtml ? null : m.textHtml,
          textPlain: m.textPlain,
          isInbound: m.isInbound,
          isFirstInThread: m.isFirstInThread ?? false,
          hasAttachments: m.hasAttachments,
          hasHtmlBody: hasObjectBackedHtml || !!m.textHtml,
          hasTextBody: !!m.textPlain,
          sentAt: m.sentAt?.toISOString() ?? null,
          receivedAt: m.receivedAt?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
          participants,
          createdById: m.createdById,
          messageType,
          sendStatus: (m.sendStatus as SendStatus) ?? null,
          providerError: m.providerError ?? null,
          attempts: m.attempts ?? 0,
          attachments: attachmentsByMessage.get(m.id) ?? [],
        }
        return [m.id, meta]
      })
    )

    // Return in input order, filtering out missing IDs
    return ids.map((id) => messageMap.get(id)).filter((m): m is MessageMeta => m !== undefined)
  }

  /**
   * Gets attachment metadata grouped by message ID.
   */
  private async getAttachmentsForMessages(
    messageIds: string[]
  ): Promise<Map<string, AttachmentMeta[]>> {
    if (messageIds.length === 0) return new Map()

    const attachmentRows = await this.db
      .select({
        id: schema.Attachment.id,
        entityId: schema.Attachment.entityId,
        title: schema.Attachment.title,
        role: schema.Attachment.role,
        sort: schema.Attachment.sort,
        contentId: schema.Attachment.contentId,
        assetMimeType: schema.MediaAsset.mimeType,
        assetSize: schema.MediaAsset.size,
      })
      .from(schema.Attachment)
      .leftJoin(schema.MediaAsset, eq(schema.Attachment.assetId, schema.MediaAsset.id))
      .where(
        and(
          eq(schema.Attachment.organizationId, this.organizationId),
          eq(schema.Attachment.entityType, 'MESSAGE'),
          inArray(schema.Attachment.entityId, messageIds)
        )
      )
      .orderBy(schema.Attachment.entityId, schema.Attachment.sort, schema.Attachment.createdAt)

    const attachmentsByMessage = new Map<string, AttachmentMeta[]>()

    for (const row of attachmentRows) {
      const existing = attachmentsByMessage.get(row.entityId) ?? []

      existing.push({
        id: row.id,
        name: row.title ?? 'attachment',
        mimeType: row.assetMimeType ?? null,
        size: row.assetSize ?? null,
        url: null,
        inline: row.role === 'INLINE',
        contentId: row.contentId ?? null,
      })

      attachmentsByMessage.set(row.entityId, existing)
    }

    return attachmentsByMessage
  }

  /**
   * Build ParticipantId[] array from message data and participant relationships.
   */
  private buildParticipantIds(
    message: { fromId: string | null; replyToId: string | null },
    participantData?: {
      from: string | null
      replyTo: string | null
      to: string[]
      cc: string[]
      bcc: string[]
    }
  ): ParticipantId[] {
    const participants: ParticipantId[] = []

    // From (prefer message.fromId, fallback to participant data)
    const fromId = message.fromId ?? participantData?.from
    if (fromId) {
      participants.push(toParticipantId('from', fromId))
    }

    // Reply-to
    const replyToId = message.replyToId ?? participantData?.replyTo
    if (replyToId) {
      participants.push(toParticipantId('replyto', replyToId))
    }

    // To recipients
    if (participantData?.to) {
      for (const id of participantData.to) {
        participants.push(toParticipantId('to', id))
      }
    }

    // CC recipients
    if (participantData?.cc) {
      for (const id of participantData.cc) {
        participants.push(toParticipantId('cc', id))
      }
    }

    // BCC recipients
    if (participantData?.bcc) {
      for (const id of participantData.bcc) {
        participants.push(toParticipantId('bcc', id))
      }
    }

    return participants
  }

  /**
   * Get participant IDs grouped by role for each message.
   */
  private async getParticipantsForMessages(messageIds: string[]): Promise<
    Map<
      string,
      {
        from: string | null
        replyTo: string | null
        to: string[]
        cc: string[]
        bcc: string[]
      }
    >
  > {
    if (messageIds.length === 0) return new Map()

    const messageParticipants = await this.db.query.MessageParticipant.findMany({
      where: inArray(schema.MessageParticipant.messageId, messageIds),
      columns: {
        messageId: true,
        participantId: true,
        role: true,
      },
    })

    const result = new Map<
      string,
      {
        from: string | null
        replyTo: string | null
        to: string[]
        cc: string[]
        bcc: string[]
      }
    >()

    // Initialize all messages
    for (const id of messageIds) {
      result.set(id, { from: null, replyTo: null, to: [], cc: [], bcc: [] })
    }

    // Group by message
    for (const mp of messageParticipants) {
      const entry = result.get(mp.messageId)
      if (!entry) continue

      switch (mp.role) {
        case 'FROM':
          entry.from = mp.participantId
          break
        case 'REPLY_TO':
          entry.replyTo = mp.participantId
          break
        case 'TO':
          entry.to.push(mp.participantId)
          break
        case 'CC':
          entry.cc.push(mp.participantId)
          break
        case 'BCC':
          entry.bcc.push(mp.participantId)
          break
      }
    }

    return result
  }
}
