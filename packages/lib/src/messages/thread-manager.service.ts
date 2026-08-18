// packages/lib/src/messages/thread-manager.service.ts

import { type Database, database, schema } from '@auxx/database'
import { IdentifierType, ThreadStatus } from '@auxx/database/enums'
import type { ThreadEntity as Thread } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { identifierTypeForProvider } from '../channels/capabilities'
import { threadSearchTextAssignmentSql } from '../mail-query/thread-search-text'
import { type ThreadContext, ThreadState } from './types/message-sending.types'

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
    /** Chat sends carry no subject; `Thread.subject` is NOT NULL so it stores `''`. */
    subject?: string | null
    integrationId: string
    organizationId: string
    /**
     * The intended recipients' routing identifiers. Used only on conversation-keyed channels
     * (see {@link findReusableConversationThread}); harmlessly ignored on email.
     */
    recipientIdentifiers?: string[]
  }): Promise<ThreadContext> {
    // If threadId provided, retrieve existing thread
    const { threadId, organizationId } = input
    if (threadId) {
      const thread = await this.db.query.Thread.findFirst({
        where: (threads, { and, eq }) =>
          and(eq(threads.id, threadId), eq(threads.organizationId, organizationId)),
        columns: {
          id: true,
          organizationId: true,
          integrationId: true,
          externalId: true,
          inboxId: true,
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
        inboxId: thread.inboxId ?? null,
        metadata: thread.metadata as Record<string, any>,
      }
    }

    // On a conversation-keyed channel, "compose to this number" means the conversation we are
    // already in — not a new one. Checked before minting a pending thread.
    const reusable = await this.findReusableConversationThread(input)
    if (reusable) {
      return {
        id: reusable.id,
        organizationId: reusable.organizationId,
        integrationId: reusable.integrationId,
        externalId: this.sanitizeExternalId(reusable.externalId),
        isPending: false,
        inboxId: reusable.inboxId ?? null,
        metadata: (reusable.metadata ?? {}) as Record<string, any>,
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
      inboxId: pendingThread.inboxId ?? null,
      metadata: {
        state: ThreadState.PENDING_SEND,
      },
    }
  }

  /**
   * Finds the open thread a compose should join, on channels where "a new message to X" is not a
   * new conversation.
   *
   * **Email vs SMS.** On email a fresh subject genuinely starts a new thread, and two threads
   * with the same recipient are two conversations. On SMS there is exactly one conversation per
   * (our number, their number) and the provider enforces it — Quo keys everything on a single
   * `CN…` per pair. Minting a pending thread there produces a duplicate that survives only until
   * reconciliation merges it away, which means a flash of a phantom row in every open list and a
   * merge on every second compose.
   *
   * Gated on `identifierTypeForProvider(provider) === PHONE` — the one canonical provider→type
   * map (#1655). Not on a hand-rolled provider list: that is the drift that made SMS unselectable
   * in the From picker for months.
   *
   * Deliberately narrow:
   * - **single recipient only.** Group SMS is unverified (no group conversations exist on the
   *   test workspace), and guessing that a 3-way text is "the same conversation" as a 1:1 with
   *   one of its members would merge two real conversations. Multi-recipient forks, as today.
   * - **open threads only.** A closed conversation that someone deliberately resolved should
   *   start fresh rather than silently reopen.
   * - **never a merged-away thread.** Landing on one files the message somewhere invisible.
   *
   * Matches on the `ThreadParticipant` rollup, which is keyed by routing identifier (the column
   * is named `email` but holds an E.164 number on a phone channel) — the same key both the
   * ingest and outbound writers use.
   */
  private async findReusableConversationThread(input: {
    integrationId: string
    organizationId: string
    recipientIdentifiers?: string[]
  }): Promise<Thread | undefined> {
    const recipients = (input.recipientIdentifiers ?? []).filter(Boolean)
    if (recipients.length !== 1) return undefined
    const recipient = recipients[0]!

    // Provider comes from the org cache — `CachedChannel.provider` is exactly this value, and
    // the cache is already warm on any path that got far enough to be sending a message.
    const channels = await getOrgCache().get(input.organizationId, 'channels')
    const provider = channels.find((c) => c.id === input.integrationId)?.provider
    if (identifierTypeForProvider(provider) !== IdentifierType.PHONE) return undefined

    const [existing] = await this.db
      .select()
      .from(schema.Thread)
      .innerJoin(schema.ThreadParticipant, eq(schema.ThreadParticipant.threadId, schema.Thread.id))
      .where(
        and(
          eq(schema.Thread.organizationId, input.organizationId),
          eq(schema.Thread.integrationId, input.integrationId),
          eq(schema.Thread.status, ThreadStatus.OPEN),
          isNull(schema.Thread.mergedIntoThreadId),
          eq(schema.ThreadParticipant.email, recipient)
        )
      )
      .orderBy(desc(schema.Thread.lastMessageAt))
      .limit(1)

    if (!existing) return undefined

    logger.info('Reusing the open conversation for this recipient instead of a new thread', {
      threadId: existing.Thread.id,
      integrationId: input.integrationId,
    })
    return existing.Thread as Thread
  }

  /**
   * Creates a pending thread that will be reconciled after provider response
   */
  private async createPendingThread(input: {
    subject?: string | null
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

    // Stamp the inbox from the integration's InboxIntegration mapping so the
    // thread never falls into the null-inbox visibility class
    // (mail-permissions Phase 0). Column stays nullable defensively.
    const inboxId = integration.inboxIntegration?.inboxId ?? null
    if (!inboxId) {
      logger.error('Pending thread could not resolve an inboxId for integration', {
        integrationId: input.integrationId,
        organizationId: input.organizationId,
      })
    }

    // Create thread with NULL externalId - will be filled by provider
    // Note: integrationType and messageType removed - derive from Integration.provider
    const threadInsert = await this.db
      .insert(schema.Thread)
      .values({
        externalId: null,
        // `Thread.subject` is NOT NULL — a subject-less send (chat) stores an
        // empty string. `Message.subject` keeps the true nullish value.
        subject: input.subject ?? '',
        organizationId: input.organizationId,
        integrationId: input.integrationId,
        inboxId,
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

    // Update the pending thread with real data. Merge reconciliation state into
    // the existing jsonb instead of replacing — replacing would clobber any
    // provider-specific metadata already on the thread (e.g. chat's
    // visitorParticipantId / channel, which downstream filters depend on).
    await this.db
      .update(schema.Thread)
      .set({
        externalId: providerData.externalThreadId,
        metadata: sql`COALESCE(${schema.Thread.metadata}, '{}'::jsonb) || jsonb_build_object(
          'state', ${ThreadState.RECONCILED}::text,
          'reconciledAt', ${new Date().toISOString()}::text,
          'originalExternalId', ${providerData.externalThreadId}::text
        )`,
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
   * Efficient thread metadata update using aggregate SQL.
   *
   * Also refreshes `searchText`, the ranked-search corpus
   * (`mail-query/thread-search-text.ts`). It rides on this statement rather than
   * getting its own hook because this function already runs on every outbound
   * send, every reconciliation and both sides of a thread merge — so the corpus
   * stays correct for exactly as long as `messageCount` does.
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
              AND "sentAt" IS NOT NULL
          ), 0),
          -- Dates fall back to "createdAt" for messages that never got a
          -- "sentAt" (a send the provider rejected). Aggregating on "sentAt"
          -- alone left an outbound-only thread with "lastMessageAt" NULL, which
          -- the list projection then papered over with the current time —
          -- rendering as "0 seconds" forever and pinning the row to the top of
          -- every newest-first list (DESC sorts NULLs first). "messageCount"
          -- deliberately still counts delivered messages only.
          "firstMessageAt" = (
            SELECT MIN(COALESCE("sentAt", "createdAt"))
            FROM "Message"
            WHERE "threadId" = ${threadId}
          ),
          "lastMessageAt" = (
            SELECT MAX(COALESCE("sentAt", "createdAt"))
            FROM "Message"
            WHERE "threadId" = ${threadId}
          ),
          "latestMessageId" = (
            SELECT id
            FROM "Message"
            WHERE "threadId" = ${threadId}
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
              AND mp."participantId" IS NOT NULL
          ), 0),
          ${sql.raw(threadSearchTextAssignmentSql('t'))}
        WHERE t.id = ${threadId}
      `)

      logger.debug('Updated thread metadata', { threadId })
    } catch (error) {
      logger.error('Failed to update thread metadata', { threadId, error })
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Recount `Thread.participantCount` from the thread's `MessageParticipant` links.
   *
   * Counts only — it does NOT write the `ThreadParticipant` rollup, despite what
   * its old name (`updateThreadParticipants`) implied. That name is why an
   * outbound-first thread silently had no rollup rows for so long: the send path
   * called this, it looked like the rollup was handled, and it never was. The
   * rollup is written by `ingest/store-message.ts` inbound, `chat/session.ts` for
   * visitors, thread merges, and `upsertOutboundThreadParticipants` on the
   * outbound path.
   */
  async updateThreadParticipantCount(threadId: string): Promise<void> {
    const participants = await this.db
      .selectDistinct({ participantId: schema.MessageParticipant.participantId })
      .from(schema.MessageParticipant)
      .innerJoin(schema.Message, eq(schema.MessageParticipant.messageId, schema.Message.id))
      .where(eq(schema.Message.threadId, threadId))

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
    await this.db.delete(schema.Thread).where(
      inArray(
        schema.Thread.id,
        orphaned.map((t) => t.id)
      )
    )

    logger.info('Cleaned up orphaned threads', {
      count: orphaned.length,
    })

    return orphaned.length
  }

  /**
   * Deletes a pending thread that was created during a failed send attempt.
   * Only deletes if the thread has no messages (safety check).
   */
  async deletePendingThread(threadId: string): Promise<void> {
    const messageCount = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.threadId, threadId),
      columns: { id: true },
    })

    if (messageCount) {
      logger.warn('Skipping pending thread cleanup — thread has messages', { threadId })
      return
    }

    await this.db
      .delete(schema.Thread)
      .where(
        and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
      )

    logger.info('Deleted orphaned pending thread', { threadId })
  }
}
