// packages/lib/src/messages/thread-manager.service.ts

import { database, type Database, schema } from '@auxx/database'
import { DraftMode, ThreadStatus } from '@auxx/database/enums'
import type { ThreadEntity as Thread } from '@auxx/database/models'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ThreadContext, ThreadState } from './types/message-sending.types'

/** Scoped logger instance for thread manager operations */
const logger = createScopedLogger('thread-manager')

/**
 * Manages thread lifecycle and metadata during message sending
 */
export class ThreadManagerService {
  private threadStateMap = new Map<string, ThreadState>()

  constructor(
    private organizationId: string,
    private db: Database = database
  ) {}

  /**
   * Sanitizes external ID to remove placeholders
   */
  private sanitizeExternalId(id: string | null | undefined): string | null {
    if (!id) return null
    if (id.startsWith('new_') || id.startsWith('pending_') || id.startsWith('draft_')) return null
    if (id.includes('-') && id.length === 36) return null // UUID
    return id
  }

  /**
   * Creates or retrieves a thread for sending
   * Returns a thread context that may be pending reconciliation
   */
  async getOrCreateThreadForSending(input: {
    threadId?: string
    subject: string
    integrationId: string
    organizationId: string
  }): Promise<ThreadContext> {
    // If threadId provided, retrieve existing thread
    if (input.threadId) {
      const thread = await this.db.query.Thread.findFirst({
        where: (threads, { and, eq }) =>
          and(eq(threads.id, input.threadId), eq(threads.organizationId, input.organizationId)),
        columns: {
          id: true,
          organizationId: true,
          integrationId: true,
          externalId: true,
          metadata: true,
        },
      })

      if (!thread) {
        throw new Error(`Thread ${input.threadId} not found`)
      }

      return {
        id: thread.id,
        organizationId: thread.organizationId,
        integrationId: thread.integrationId,
        externalId: this.sanitizeExternalId(thread.externalId),
        isPending: false,
        metadata: thread.metadata as Record<string, any>,
      }
    }

    // Create a new pending thread
    const pendingThread = await this.createPendingThread({
      subject: input.subject,
      integrationId: input.integrationId,
      organizationId: input.organizationId,
    })

    return {
      id: pendingThread.id,
      organizationId: pendingThread.organizationId,
      integrationId: pendingThread.integrationId,
      externalId: null,
      isPending: true,
      metadata: {
        state: ThreadState.PENDING_SEND,
      },
    }
  }

  /**
   * Creates a pending thread that will be reconciled after provider response
   */
  private async createPendingThread(input: {
    subject: string
    integrationId: string
    organizationId: string
  }): Promise<Thread> {
    // Get integration details
    const integration = await this.db.query.Integration.findFirst({
      where: (integrations, { eq }) => eq(integrations.id, input.integrationId),
      columns: {
        id: true,
        provider: true,
      },
      with: {
        inboxIntegration: {
          columns: {
            inboxId: true,
          },
        },
      },
    })

    if (!integration) {
      throw new Error(`Integration ${input.integrationId} not found`)
    }

    // Note: inboxId was removed from Thread schema in migration 0028
    // Inbox association is now through InboxIntegration table via integrationId

    // Create thread with NULL externalId - will be filled by provider
    // Note: integrationType and messageType removed - derive from Integration.provider
    const threadInsert = await this.db
      .insert(schema.Thread)
      .values({
        externalId: null,
        subject: input.subject,
        organizationId: input.organizationId,
        integrationId: input.integrationId,
        status: ThreadStatus.OPEN,
        messageCount: 0,
        participantCount: 0,
        metadata: {
          state: ThreadState.PENDING_SEND,
          createdAt: new Date().toISOString(),
        },
      })
      .returning()

    const thread = threadInsert[0] as Thread | undefined

    if (!thread) {
      throw new Error('Failed to create pending thread')
    }

    // Track state
    this.threadStateMap.set(thread.id, ThreadState.PENDING_SEND)

    logger.info('Created pending thread', {
      threadId: thread.id,
      integrationId: input.integrationId,
      subject: input.subject,
    })

    return thread
  }

  /**
   * Updates a pending thread with real provider data
   */
  async reconcileThread(
    pendingThreadId: string,
    providerData: {
      externalThreadId: string
      actualMessageId: string
      sentAt: Date
    }
  ): Promise<void> {
    logger.info('Reconciling thread with provider data', {
      pendingThreadId,
      externalThreadId: providerData.externalThreadId,
    })

    // Check if a thread with the real external ID already exists
    const existingRealThread = await this.db.query.Thread.findFirst({
      where: (threads, { and, eq }) =>
        and(
          eq(threads.organizationId, this.organizationId),
          eq(threads.externalId, providerData.externalThreadId)
        ),
    })

    if (existingRealThread && existingRealThread.id !== pendingThreadId) {
      // We have a duplicate - need to merge
      logger.warn('Found existing thread with same external ID, merging', {
        pendingThreadId,
        existingThreadId: existingRealThread.id,
        externalThreadId: providerData.externalThreadId,
      })

      // Move messages from pending to real thread
      await this.mergeThreads(pendingThreadId, existingRealThread.id)

      // Delete the pending thread
      await this.db.delete(schema.Thread).where(eq(schema.Thread.id, pendingThreadId))

      // Update metadata on the real thread
      await this.updateThreadMetadata(existingRealThread.id)
      return
    }

    // Update the pending thread with real data
    await this.db
      .update(schema.Thread)
      .set({
        externalId: providerData.externalThreadId,
        metadata: {
          state: ThreadState.RECONCILED,
          reconciledAt: new Date().toISOString(),
          originalExternalId: providerData.externalThreadId,
        },
      })
      .where(eq(schema.Thread.id, pendingThreadId))

    // Update thread metadata
    await this.updateThreadMetadata(pendingThreadId)

    // Update state
    this.threadStateMap.set(pendingThreadId, ThreadState.RECONCILED)
  }

  /**
   * Merges messages from one thread to another
   */
  private async mergeThreads(fromThreadId: string, toThreadId: string): Promise<void> {
    // Fetch the provider thread ID from destination
    const toThread = await this.db.query.Thread.findFirst({
      where: (threads, { eq }) => eq(threads.id, toThreadId),
      columns: { externalId: true },
    })
    const providerThreadId = toThread?.externalId

    // Move all messages
    await this.db
      .update(schema.Message)
      .set({
        threadId: toThreadId,
        ...(providerThreadId ? { externalThreadId: providerThreadId } : {}),
      })
      .where(eq(schema.Message.threadId, fromThreadId))

    // Move all related comments (update entityId since comments now use entityId + entityDefinitionId)
    await this.db
      .update(schema.Comment)
      .set({ entityId: toThreadId })
      .where(
        and(
          eq(schema.Comment.entityId, fromThreadId),
          eq(schema.Comment.entityDefinitionId, 'thread')
        )
      )

    await this.db
      .update(schema.ThreadReadStatus)
      .set({ threadId: toThreadId })
      .where(eq(schema.ThreadReadStatus.threadId, fromThreadId))

    // Recalculate latestMessageId for both threads after message move
    await this.updateThreadMetadata(fromThreadId)
    await this.updateThreadMetadata(toThreadId)

    // Recalculate latestCommentId for both threads after comment move
    await this.recalculateLatestCommentId(fromThreadId)
    await this.recalculateLatestCommentId(toThreadId)

    logger.info('Merged threads', {
      fromThreadId,
      toThreadId,
      providerThreadId,
    })
  }

  /**
   * Recalculates and updates the latestCommentId for a thread
   */
  private async recalculateLatestCommentId(threadId: string): Promise<void> {
    try {
      await this.db.execute(sql`
        UPDATE "Thread"
        SET "latestCommentId" = (
          SELECT id
          FROM "Comment"
          WHERE "entityId" = ${threadId}
            AND "entityDefinitionId" = 'thread'
            AND "deletedAt" IS NULL
          ORDER BY "createdAt" DESC, id DESC
          LIMIT 1
        )
        WHERE id = ${threadId}
      `)
    } catch (error) {
      logger.error('Failed to recalculate latestCommentId', { threadId, error })
    }
  }

  /**
   * Efficient thread metadata update using aggregate SQL
   */
  async updateThreadMetadata(threadId: string): Promise<void> {
    try {
      await this.db.execute(sql`
        UPDATE "Thread" t
        SET
          "messageCount" = COALESCE((
            SELECT COUNT(*)
            FROM "Message"
            WHERE "threadId" = ${threadId}
              AND "draftMode" = 'NONE'
              AND "sentAt" IS NOT NULL
          ), 0),
          "firstMessageAt" = (
            SELECT MIN("sentAt")
            FROM "Message"
            WHERE "threadId" = ${threadId}
              AND "draftMode" = 'NONE'
              AND "sentAt" IS NOT NULL
          ),
          "lastMessageAt" = (
            SELECT MAX("sentAt")
            FROM "Message"
            WHERE "threadId" = ${threadId}
              AND "draftMode" = 'NONE'
              AND "sentAt" IS NOT NULL
          ),
          "latestMessageId" = (
            SELECT id
            FROM "Message"
            WHERE "threadId" = ${threadId}
              AND "draftMode" = 'NONE'
            ORDER BY "receivedAt" DESC NULLS LAST,
                     "sentAt" DESC NULLS LAST,
                     id DESC
            LIMIT 1
          ),
          "participantCount" = COALESCE((
            SELECT COUNT(DISTINCT "participantId")
            FROM "MessageParticipant" mp
            JOIN "Message" m ON mp."messageId" = m.id
            WHERE m."threadId" = ${threadId}
              AND m."draftMode" = 'NONE'
              AND mp."participantId" IS NOT NULL
          ), 0)
        WHERE t.id = ${threadId}
      `)

      logger.debug('Updated thread metadata', { threadId })
    } catch (error) {
      logger.error('Failed to update thread metadata', { threadId, error })
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Updates thread participants
   */
  async updateThreadParticipants(threadId: string): Promise<void> {
    // Get all unique participants from non-draft messages
    const participants = await this.db
      .selectDistinct({ participantId: schema.MessageParticipant.participantId })
      .from(schema.MessageParticipant)
      .innerJoin(schema.Message, eq(schema.MessageParticipant.messageId, schema.Message.id))
      .where(
        and(
          eq(schema.Message.threadId, threadId),
          eq(schema.Message.draftMode, DraftMode.NONE)
        )
      )

    const participantIds = participants.map((p) => p.participantId).filter(Boolean)

    // Note: participantIds field removed from schema
    await this.db
      .update(schema.Thread)
      .set({
        participantCount: participantIds.length,
      })
      .where(eq(schema.Thread.id, threadId))

    logger.debug('Updated thread participants', {
      threadId,
      participantCount: participantIds.length,
    })
  }

  /**
   * Marks orphaned pending threads for cleanup
   */
  async cleanupOrphanedThreads(): Promise<number> {
    // Find pending threads older than 1 hour with no messages
    const orphaned = await this.db.query.Thread.findMany({
      where: (threads, { and, eq, ilike, isNotNull, lt }) =>
        and(
          eq(threads.organizationId, this.organizationId),
          isNotNull(threads.externalId),
          ilike(threads.externalId, 'pending\\_%'),
          eq(threads.messageCount, 0),
          lt(threads.createdAt, new Date(Date.now() - 3600000))
        ),
      columns: { id: true },
    })

    if (orphaned.length === 0) return 0

    // Delete orphaned threads
    await this.db.delete(schema.Thread).where(inArray(schema.Thread.id, orphaned.map((t) => t.id)))

    logger.info('Cleaned up orphaned threads', {
      count: orphaned.length,
    })

    return orphaned.length
  }
}
