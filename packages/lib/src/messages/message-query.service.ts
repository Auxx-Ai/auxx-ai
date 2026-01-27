// packages/lib/src/messages/message-query.service.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import type {
  MessageMeta,
  DraftMode,
  SendStatus,
  ListMessageIdsOptions,
  ListMessagesByThreadResult,
} from './types/message-query.types'
import { getOrgProviderMap } from '../providers/integration-cache'
import { getMessageTypeFromProvider } from '../providers/type-utils'

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
    const providerMap = await getOrgProviderMap(this.organizationId, this.db)

    // Fetch messages with inline from/replyTo participant data
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
        sentAt: true,
        receivedAt: true,
        createdAt: true,
        draftMode: true,
        createdById: true,
        fromId: true,
        replyToId: true,
        integrationId: true,
        sendStatus: true,
        providerError: true,
        attempts: true,
      },
      with: {
        from: {
          columns: { id: true, name: true, displayName: true, identifier: true },
        },
        replyTo: {
          columns: { id: true, name: true, displayName: true, identifier: true },
        },
      },
    })

    // Batch fetch participant IDs for recipients (to, cc, bcc)
    const messageIds = messages.map((m) => m.id)
    const participantsByMessage = await this.getParticipantsForMessages(messageIds)

    // Create a map for quick lookup
    const messageMap = new Map(
      messages.map((m) => {
        const participants = participantsByMessage.get(m.id) ?? {
          from: null,
          replyTo: null,
          to: [],
          cc: [],
          bcc: [],
        }

        // Derive messageType from integration provider
        const provider = providerMap.get(m.integrationId) ?? 'google'
        const messageType = getMessageTypeFromProvider(provider)

        const meta: MessageMeta = {
          id: m.id,
          threadId: m.threadId,
          subject: m.subject,
          snippet: m.snippet,
          textHtml: m.textHtml,
          textPlain: m.textPlain,
          isInbound: m.isInbound,
          isFirstInThread: m.isFirstInThread ?? false,
          hasAttachments: m.hasAttachments,
          sentAt: m.sentAt?.toISOString() ?? null,
          receivedAt: m.receivedAt?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
          // Inline sender info for display
          from: m.from
            ? {
                id: m.from.id,
                name: m.from.name,
                displayName: m.from.displayName,
                identifier: m.from.identifier,
              }
            : null,
          replyTo: m.replyTo
            ? {
                id: m.replyTo.id,
                name: m.replyTo.name,
                displayName: m.replyTo.displayName,
                identifier: m.replyTo.identifier,
              }
            : null,
          // Participant IDs for detail views
          fromParticipantId: m.fromId ?? participants.from,
          replyToParticipantId: m.replyToId ?? participants.replyTo,
          toParticipantIds: participants.to,
          ccParticipantIds: participants.cc,
          bccParticipantIds: participants.bcc,
          draftMode: (m.draftMode as DraftMode) ?? 'NONE',
          createdById: m.createdById,
          // Message type derived from integration provider
          messageType,
          // Send status for outbound messages
          sendStatus: (m.sendStatus as SendStatus) ?? null,
          providerError: m.providerError ?? null,
          attempts: m.attempts ?? 0,
          // Attachments fetched separately if needed
          attachments: [],
        }
        return [m.id, meta]
      })
    )

    // Return in input order, filtering out missing IDs
    return ids.map((id) => messageMap.get(id)).filter((m): m is MessageMeta => m !== undefined)
  }

  /**
   * Get message IDs for a thread, sorted by date.
   * Excludes draft messages by default.
   */
  async listMessageIds(
    threadId: string,
    options: ListMessageIdsOptions = {}
  ): Promise<ListMessagesByThreadResult> {
    const { includeDrafts = false } = options

    logger.debug('Listing message IDs for thread', {
      organizationId: this.organizationId,
      threadId,
      includeDrafts,
    })

    const conditions = [
      eq(schema.Message.threadId, threadId),
      eq(schema.Message.organizationId, this.organizationId),
    ]

    if (!includeDrafts) {
      conditions.push(eq(schema.Message.draftMode, 'NONE'))
    }

    const messages = await this.db
      .select({ id: schema.Message.id })
      .from(schema.Message)
      .where(and(...conditions))
      .orderBy(
        sql`${schema.Message.receivedAt} ASC NULLS LAST`,
        sql`${schema.Message.sentAt} ASC NULLS LAST`,
        sql`${schema.Message.id} ASC`
      )

    const ids = messages.map((m) => m.id)
    return { ids, total: ids.length }
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
