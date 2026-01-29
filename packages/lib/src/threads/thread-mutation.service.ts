// packages/lib/src/threads/thread-mutation.service.ts

import { type Database, schema } from '@auxx/database'
import { ThreadStatus, DraftMode } from '@auxx/database/enums'
import { eq, and, inArray, isNotNull } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'

const logger = createScopedLogger('thread-mutation-service')

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

  /**
   * Updates the status of a single thread.
   * Returns MutationResult - frontend uses optimistic updates.
   */
  async updateThreadStatus(
    threadId: string,
    status: (typeof ThreadStatus)[keyof typeof ThreadStatus]
  ): Promise<MutationResult> {
    logger.info('Updating thread status', { threadId, status, organizationId: this.organizationId })

    try {
      const result = await this.db
        .update(schema.Thread)
        .set({
          status: status as any,
        })
        .where(
          and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
        )
        .returning({
          id: schema.Thread.id,
          status: schema.Thread.status,
        })

      if (result.length === 0) {
        throw new Error(`Thread ${threadId} not found`)
      }

      return {
        id: threadId,
        success: true,
        updatedFields: { status },
        timestamp: new Date(),
      }
    } catch (error: unknown) {
      logger.error('Failed to update thread status', {
        threadId,
        status,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error updating status for thread ${threadId}: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Updates the subject of a thread.
   * Returns MutationResult - frontend uses optimistic updates.
   */
  async updateThreadSubject(threadId: string, subject: string): Promise<MutationResult> {
    logger.info('Updating thread subject', {
      threadId,
      subject,
      organizationId: this.organizationId,
    })

    // Trim the subject to maximum 100 characters
    const trimmedSubject = subject.trim().substring(0, 100)

    try {
      const result = await this.db
        .update(schema.Thread)
        .set({
          subject: trimmedSubject,
        })
        .where(
          and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
        )
        .returning({
          id: schema.Thread.id,
          subject: schema.Thread.subject,
        })

      if (result.length === 0) {
        throw new Error(`Thread ${threadId} not found`)
      }

      return {
        id: threadId,
        success: true,
        updatedFields: { subject: trimmedSubject },
        timestamp: new Date(),
      }
    } catch (error: unknown) {
      logger.error('Failed to update thread subject', {
        threadId,
        subject,
        error: error instanceof Error ? error.message : error,
      })

      throw new Error(
        `Database error updating subject for thread ${threadId}: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Assigns or unassigns a thread to a user.
   * Returns MutationResult - frontend uses optimistic updates.
   */
  async assignThread(
    threadId: string,
    assigneeId: string | null // User ID or null to unassign
  ): Promise<MutationResult> {
    logger.info('Assigning thread', { threadId, assigneeId, organizationId: this.organizationId })

    try {
      // Verify assigneeId belongs to the organization if not null
      if (assigneeId) {
        const memberExists = await this.db.query.OrganizationMember.findFirst({
          where: (members, { eq, and }) =>
            and(eq(members.userId, assigneeId), eq(members.organizationId, this.organizationId)),
          columns: { id: true },
        })
        if (!memberExists) {
          throw new Error(
            `Assignee user ${assigneeId} is not part of organization ${this.organizationId}.`
          )
        }
      }

      const result = await this.db
        .update(schema.Thread)
        .set({
          assigneeId,
        })
        .where(
          and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
        )
        .returning({
          id: schema.Thread.id,
          assigneeId: schema.Thread.assigneeId,
        })

      if (result.length === 0) {
        throw new Error(`Thread ${threadId} not found`)
      }

      return {
        id: threadId,
        success: true,
        updatedFields: { assigneeId },
        timestamp: new Date(),
      }
    } catch (error: unknown) {
      logger.error('Failed to assign thread', {
        threadId,
        assigneeId,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error assigning thread ${threadId}: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Updates the status of multiple threads in bulk with ultra-fast performance
   */
  async updateThreadStatusBulk(
    threadIds: string[],
    status: (typeof ThreadStatus)[keyof typeof ThreadStatus],
    options: { returnAffectedCount?: boolean } = {}
  ): Promise<{ count: number; affectedIds?: string[] }> {
    if (!threadIds || threadIds.length === 0) return { count: 0 }

    logger.info('Bulk updating thread status', {
      count: threadIds.length,
      status,
      organizationId: this.organizationId,
    })

    try {
      // Single optimized query
      const result = await this.db
        .update(schema.Thread)
        .set({
          status: status as any,
        })
        .where(
          and(
            inArray(schema.Thread.id, threadIds),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .returning(
          options.returnAffectedCount ? { id: schema.Thread.id } : { id: schema.Thread.id }
        )

      return {
        count: result.length,
        ...(options.returnAffectedCount && { affectedIds: result.map((r) => r.id) }),
      }
    } catch (error: unknown) {
      logger.error('Failed to update thread status in bulk', {
        count: threadIds.length,
        status,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error updating status for threads: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Assigns multiple threads to a user or unassigns them in bulk with validation
   */
  async assignThreadBulk(
    threadIds: string[],
    assigneeId: string | null,
    options: { validateUser?: boolean } = { validateUser: true }
  ): Promise<{ count: number; errors: string[] }> {
    if (!threadIds || threadIds.length === 0) return { count: 0, errors: [] }

    logger.info('Bulk assigning threads', {
      count: threadIds.length,
      assigneeId,
      organizationId: this.organizationId,
    })

    const errors: string[] = []

    try {
      // Optional user validation (only if needed)
      if (options.validateUser && assigneeId) {
        const userExists = await this.db.query.OrganizationMember.findFirst({
          where: (members, { eq, and }) =>
            and(eq(members.userId, assigneeId), eq(members.organizationId, this.organizationId)),
          columns: { id: true }, // Minimal select
        })

        if (!userExists) {
          errors.push(`User ${assigneeId} not found`)
          return { count: 0, errors }
        }
      }

      // Fast bulk assignment
      const result = await this.db
        .update(schema.Thread)
        .set({
          assigneeId,
        })
        .where(
          and(
            inArray(schema.Thread.id, threadIds),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .returning({ id: schema.Thread.id })

      return {
        count: result.length,
        errors,
      }
    } catch (error: unknown) {
      logger.error('Failed to assign threads in bulk', {
        count: threadIds.length,
        assigneeId,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error assigning threads: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Most performance-critical operation - uses FieldValue storage for tags.
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

  // Convenience status update methods
  async markAsSpam(threadId: string): Promise<MutationResult> {
    return this.updateThreadStatus(threadId, 'SPAM')
  }

  async moveToTrash(threadId: string): Promise<MutationResult> {
    return this.updateThreadStatus(threadId, 'TRASH')
  }

  async archiveThread(threadId: string): Promise<MutationResult> {
    return this.updateThreadStatus(threadId, 'ARCHIVED')
  }

  async unarchiveThread(threadId: string): Promise<MutationResult> {
    return this.updateThreadStatus(threadId, 'OPEN')
  }

  // Convenience bulk status methods
  async markAsSpamBulk(
    threadIds: string[],
    options?: { returnAffectedCount?: boolean }
  ): Promise<{ count: number; affectedIds?: string[] }> {
    return this.updateThreadStatusBulk(threadIds, 'SPAM', options)
  }

  async moveToTrashBulk(
    threadIds: string[],
    options?: { returnAffectedCount?: boolean }
  ): Promise<{ count: number; affectedIds?: string[] }> {
    return this.updateThreadStatusBulk(threadIds, 'TRASH', options)
  }

  async archiveThreadBulk(
    threadIds: string[],
    options?: { returnAffectedCount?: boolean }
  ): Promise<{ count: number; affectedIds?: string[] }> {
    return this.updateThreadStatusBulk(threadIds, 'ARCHIVED', options)
  }

  async unarchiveThreadBulk(
    threadIds: string[],
    options?: { returnAffectedCount?: boolean }
  ): Promise<{ count: number; affectedIds?: string[] }> {
    return this.updateThreadStatusBulk(threadIds, 'OPEN', options)
  }

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
