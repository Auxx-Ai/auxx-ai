// packages/lib/src/threads/thread-mutation.service.ts

import { type Database, schema } from '@auxx/database'
import { DraftMode } from '@auxx/database/enums'
import { eq, and, inArray, isNotNull } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { parseActorId, type ActorId } from '@auxx/types/actor'
import { parseRecordId, getInstanceId, type RecordId } from '@auxx/types/resource'

const logger = createScopedLogger('thread-mutation-service')

/**
 * Unified thread updates interface.
 * Used by the update() and updateBulk() methods.
 */
export interface ThreadUpdates {
  status?: 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH'
  subject?: string
  assigneeId?: ActorId | null
  /** Inbox RecordId (format: "entityDefinitionId:instanceId") or null to unassign */
  inboxId?: RecordId | null
  isUnread?: boolean
}

/**
 * Standard result returned by all mutation operations.
 * Frontend uses optimistic updates and refetches via ThreadQueryService if needed.
 */
export interface MutationResult {
  id: string
  success: boolean
  updatedFields: Record<string, any>
  timestamp: Date
}

/**
 * Service for thread mutation operations (updates, deletes, etc.)
 * Handles all thread modification logic
 */
export class ThreadMutationService {
  private readonly organizationId: string

  private db: Database

  constructor(organizationId: string, db: Database) {
    this.organizationId = organizationId
    this.db = db
  }

  // ═══════════════════════════════════════════════════════════════
  // UNIFIED UPDATE METHODS (RecordId-based)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Unified update method for a single thread.
   * Accepts RecordId and applies partial updates.
   */
  async update(recordId: RecordId, updates: ThreadUpdates): Promise<MutationResult> {
    const { entityInstanceId: threadId } = parseRecordId(recordId)

    logger.info('Updating thread via unified method', {
      threadId,
      updates,
      organizationId: this.organizationId,
    })

    try {
      // Build the update object dynamically
      const dbUpdates: Record<string, any> = {}

      if (updates.status !== undefined) {
        dbUpdates.status = updates.status
      }
      if (updates.subject !== undefined) {
        dbUpdates.subject = updates.subject.trim().substring(0, 100)
      }
      if (updates.assigneeId !== undefined) {
        // Parse ActorId to extract user ID for database storage
        dbUpdates.assigneeId = updates.assigneeId ? parseActorId(updates.assigneeId).id : null
      }
      if (updates.inboxId !== undefined) {
        dbUpdates.inboxId = updates.inboxId ? getInstanceId(updates.inboxId) : null
      }

      // isUnread is handled separately via UnreadService, but for now we skip it
      // The frontend store handles optimistic updates for read status

      if (Object.keys(dbUpdates).length === 0) {
        return {
          id: threadId,
          success: true,
          updatedFields: updates,
          timestamp: new Date(),
        }
      }

      const result = await this.db
        .update(schema.Thread)
        .set(dbUpdates)
        .where(
          and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
        )
        .returning({ id: schema.Thread.id })

      if (result.length === 0) {
        throw new Error(`Thread ${threadId} not found`)
      }

      return {
        id: threadId,
        success: true,
        updatedFields: updates,
        timestamp: new Date(),
      }
    } catch (error: unknown) {
      logger.error('Failed to update thread', {
        threadId,
        updates,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error updating thread ${threadId}: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Unified bulk update method for multiple threads.
   * Accepts RecordIds and applies partial updates to all.
   */
  async updateBulk(recordIds: RecordId[], updates: ThreadUpdates): Promise<{ count: number }> {
    if (!recordIds || recordIds.length === 0) return { count: 0 }

    const threadIds = recordIds.map((id) => parseRecordId(id).entityInstanceId)

    logger.info('Bulk updating threads via unified method', {
      count: threadIds.length,
      updates,
      organizationId: this.organizationId,
    })

    try {
      // Build the update object dynamically
      const dbUpdates: Record<string, any> = {}

      if (updates.status !== undefined) {
        dbUpdates.status = updates.status
      }
      if (updates.assigneeId !== undefined) {
        dbUpdates.assigneeId = updates.assigneeId ? parseActorId(updates.assigneeId).id : null
      }
      if (updates.inboxId !== undefined) {
        dbUpdates.inboxId = updates.inboxId ? getInstanceId(updates.inboxId) : null
      }

      if (Object.keys(dbUpdates).length === 0) {
        return { count: threadIds.length }
      }

      const result = await this.db
        .update(schema.Thread)
        .set(dbUpdates)
        .where(
          and(
            inArray(schema.Thread.id, threadIds),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .returning({ id: schema.Thread.id })

      return { count: result.length }
    } catch (error: unknown) {
      logger.error('Failed to bulk update threads', {
        count: threadIds.length,
        updates,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error bulk updating threads: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Unified remove method for permanent deletion.
   * Accepts RecordId.
   */
  async remove(recordId: RecordId): Promise<{ success: boolean }> {
    const { entityInstanceId: threadId } = parseRecordId(recordId)
    return this.deletePermanently(threadId)
  }

  /**
   * Unified bulk remove method for permanent deletion.
   * Accepts RecordIds.
   */
  async removeBulk(recordIds: RecordId[]): Promise<{ count: number }> {
    if (!recordIds || recordIds.length === 0) return { count: 0 }
    const threadIds = recordIds.map((id) => parseRecordId(id).entityInstanceId)
    return this.bulkDeletePermanently(threadIds)
  }

  // ═══════════════════════════════════════════════════════════════
  // TAG OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Bulk tag operation - uses FieldValue storage for tags.
   * Tags are stored as RELATIONSHIP field values with systemAttribute='thread_tags'.
   */
  async tagThreadsBulk(
    threadIds: string[],
    tagIds: string[],
    operation: 'add' | 'remove' | 'set' = 'add'
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    if (!threadIds.length || !tagIds.length) return { created: 0, skipped: 0, errors: [] }

    logger.info(`Bulk tagging threads`, {
      operation,
      threadCount: threadIds.length,
      tagCount: tagIds.length,
      organizationId: this.organizationId,
    })

    const errors: string[] = []

    try {
      // 1. Get the CustomField ID for thread_tags
      const tagsField = await this.db
        .select({ id: schema.CustomField.id })
        .from(schema.CustomField)
        .innerJoin(
          schema.EntityDefinition,
          eq(schema.CustomField.entityDefinitionId, schema.EntityDefinition.id)
        )
        .where(
          and(
            eq(schema.CustomField.systemAttribute, 'thread_tags'),
            eq(schema.EntityDefinition.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (tagsField.length === 0) {
        errors.push('Thread tags field not found for organization')
        return { created: 0, skipped: 0, errors }
      }

      const fieldId = tagsField[0]!.id

      // 2. Fast tag validation (batch query)
      const existingTags = await this.db.query.Tag.findMany({
        where: (tags, { and, inArray, eq }) =>
          and(inArray(tags.id, tagIds), eq(tags.organizationId, this.organizationId)),
        columns: { id: true },
      })

      const validTagIds = existingTags.map((t) => t.id)
      const invalidTagIds = tagIds.filter((id) => !validTagIds.includes(id))

      if (invalidTagIds.length > 0) {
        errors.push(`Invalid tag IDs: ${invalidTagIds.join(', ')}`)
      }

      if (validTagIds.length === 0) {
        return { created: 0, skipped: 0, errors }
      }

      let created = 0
      let skipped = 0

      await this.db.transaction(async (tx) => {
        if (operation === 'set') {
          // Remove all existing tags for these threads first (via FieldValue)
          await tx
            .delete(schema.FieldValue)
            .where(
              and(
                eq(schema.FieldValue.fieldId, fieldId),
                inArray(schema.FieldValue.entityId, threadIds),
                isNotNull(schema.FieldValue.relatedEntityId)
              )
            )
        }

        if (operation === 'remove') {
          // Delete specific tag assignments (via FieldValue)
          const deleteResult = await tx
            .delete(schema.FieldValue)
            .where(
              and(
                eq(schema.FieldValue.fieldId, fieldId),
                inArray(schema.FieldValue.entityId, threadIds),
                inArray(schema.FieldValue.relatedEntityId, validTagIds)
              )
            )
            .returning({ entityId: schema.FieldValue.entityId })
          created = deleteResult.length
        } else {
          // 'add' or 'set' - Generate all combinations efficiently
          const valuesToCreate = threadIds.flatMap((threadId) =>
            validTagIds.map((tagId) => ({
              id: generateId('fv'),
              fieldId,
              entityId: threadId,
              relatedEntityId: tagId,
              createdAt: new Date(),
              updatedAt: new Date(),
            }))
          )

          if (valuesToCreate.length > 0) {
            // Bulk insert with conflict handling using unique constraint
            const result = await tx
              .insert(schema.FieldValue)
              .values(valuesToCreate)
              .onConflictDoNothing({
                target: [
                  schema.FieldValue.fieldId,
                  schema.FieldValue.entityId,
                  schema.FieldValue.relatedEntityId,
                ],
              })
              .returning({ entityId: schema.FieldValue.entityId })

            created = result.length
            skipped = valuesToCreate.length - result.length
          }
        }
      })

      logger.info(`Bulk thread tagging completed`, {
        operation,
        created,
        skipped,
      })
      return { created, skipped, errors }
    } catch (error: unknown) {
      logger.error('Failed to update thread tags in bulk', {
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error updating tags for threads: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Permanently deletes a thread and its associated data
   * Use with extreme caution!
   */
  async deletePermanently(threadId: string): Promise<{ success: boolean }> {
    logger.warn('Attempting permanent deletion of thread', {
      threadId,
      organizationId: this.organizationId,
    })

    try {
      const result = await this.db
        .delete(schema.Thread)
        .where(
          and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
        )
        .returning({ id: schema.Thread.id })

      if (result.length === 0) {
        logger.error('Thread not found for permanent deletion.', { threadId })
        throw new Error(`Thread ${threadId} not found for deletion.`)
      }

      logger.info('Thread permanently deleted', { threadId })
      return { success: true }
    } catch (error: unknown) {
      logger.error('Failed to permanently delete thread', {
        threadId,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error deleting thread ${threadId}: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Permanently deletes multiple threads in bulk
   * Use with extreme caution!
   */
  async bulkDeletePermanently(threadIds: string[]): Promise<{ count: number }> {
    if (!threadIds || threadIds.length === 0) return { count: 0 }

    logger.warn('Attempting permanent bulk deletion of threads', {
      count: threadIds.length,
      organizationId: this.organizationId,
    })

    try {
      const result = await this.db
        .delete(schema.Thread)
        .where(
          and(
            inArray(schema.Thread.id, threadIds),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .returning({ id: schema.Thread.id })

      logger.info('Threads permanently deleted in bulk', {
        requestedCount: threadIds.length,
        deletedCount: result.length,
      })

      return { count: result.length }
    } catch (error: unknown) {
      logger.error('Failed to permanently delete threads in bulk', {
        threadIds,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error deleting threads in bulk: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // METADATA OPERATIONS (internal use)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Updates thread metadata after message operations
   * Call this after: create, update, promote draft, sync
   */
  async updateThreadMetadata(
    threadId: string,
    operation: 'create' | 'update' | 'delete' = 'create'
  ): Promise<void> {
    // Get all non-draft messages with proper dates (ordered by sentAt ASC for first/last)
    const messages = await this.db.query.Message.findMany({
      where: (messages, { eq, and, isNotNull }) =>
        and(
          eq(messages.threadId, threadId),
          eq(messages.draftMode, DraftMode.NONE),
          isNotNull(messages.sentAt)
        ),
      columns: { sentAt: true },
      orderBy: (messages, { asc }) => [asc(messages.sentAt)],
    })

    // Get the latest message with deterministic ordering for latestMessageId
    const latestMessage = await this.db.query.Message.findFirst({
      where: (messages, { eq, and }) =>
        and(eq(messages.threadId, threadId), eq(messages.draftMode, DraftMode.NONE)),
      columns: { id: true },
      orderBy: (messages, { desc }) => [
        desc(messages.receivedAt),
        desc(messages.sentAt),
        desc(messages.id),
      ],
    })

    const messageCount = messages.length
    const firstMessageAt = messages[0]?.sentAt || null
    const lastMessageAt = messages[messages.length - 1]?.sentAt || null
    const latestMessageId = latestMessage?.id || null

    await this.db
      .update(schema.Thread)
      .set({
        messageCount,
        firstMessageAt,
        lastMessageAt,
        latestMessageId,
      })
      .where(eq(schema.Thread.id, threadId))

    logger.debug('Updated thread metadata', {
      threadId,
      operation,
      messageCount,
      firstMessageAt,
      lastMessageAt,
      latestMessageId,
    })
  }

  /**
   * Updates thread participants after message operations
   */
  async updateThreadParticipants(threadId: string): Promise<void> {
    // Get messages and their participants for this thread
    const messages = await this.db.query.Message.findMany({
      where: (messages, { eq, and }) =>
        and(eq(messages.threadId, threadId), eq(messages.draftMode, DraftMode.NONE)),
      columns: { id: true },
      with: {
        participants: {
          columns: { participantId: true },
        },
      },
    })

    // Extract unique participant IDs
    const participantIds = [
      ...new Set(
        messages
          .flatMap((m) => m.participants)
          .map((p) => p.participantId)
          .filter(Boolean)
      ),
    ]

    await this.db
      .update(schema.Thread)
      .set({
        participantIds,
        participantCount: participantIds.length,
      })
      .where(eq(schema.Thread.id, threadId))

    logger.debug('Updated thread participants', {
      threadId,
      participantCount: participantIds.length,
    })
  }
}
