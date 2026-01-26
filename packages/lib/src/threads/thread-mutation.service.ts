// packages/lib/src/threads/thread-mutation.service.ts

import { type Database, schema } from '@auxx/database'
import { ThreadStatus, DraftMode } from '@auxx/database/enums'
import { eq, and, inArray } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('thread-mutation-service')

// Performance-optimized mutation options
export interface MutationOptions {
  returnData?: boolean | 'minimal' | 'full'
  include?: {
    messages?: boolean
    tags?: boolean
    labels?: boolean
    assignee?: boolean
    // Note: inbox removed - Thread.inboxId was removed in migration 0028
    integration?: boolean // Added to support provider-based type derivation
    // Note: comments removed - fetched separately via CommentService
  }
}

export interface MutationResult {
  id: string
  success: boolean
  updatedFields: Record<string, any>
  timestamp: Date
}

export interface MutationResultWithData<T = ThreadListItem> extends MutationResult {
  data?: T
}

export type ThreadListItem = {
  id: string
  subject: string
  organizationId: string
  status: string
  lastMessageAt?: Date | null
  firstMessageAt?: Date | null
  messageCount: number
  participantCount: number
  assigneeId?: string | null
  // Note: inboxId removed - Thread.inboxId was removed in migration 0028
  createdAt: Date
  // Relations
  messages?: any[]
  labels?: any[]
  tags?: any[]
  assignee?: any
  integration?: any
  inbox?: any
  comments?: any[]
  // Computed fields
  currentUserReadStatus?: { isRead: boolean; lastReadAt: Date | null } | null
  isUnread?: boolean
  latestComment?: any | null
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
   * Updates the status of a single thread with performance optimization
   */
  async updateThreadStatus(
    threadId: string,
    status: typeof ThreadStatus[keyof typeof ThreadStatus],
    options: MutationOptions = { returnData: 'minimal' }
  ): Promise<MutationResult | ThreadListItem> {
    logger.info('Updating thread status', { threadId, status, organizationId: this.organizationId })

    try {
      // Fast update with minimal return
      const result = await this.db
        .update(schema.Thread)
        .set({
          status: status as any
        })
        .where(
          and(
            eq(schema.Thread.id, threadId),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .returning({
          id: schema.Thread.id,
          status: schema.Thread.status
        })

      if (result.length === 0) {
        throw new Error(`Thread ${threadId} not found`)
      }

      // Return minimal result by default (much faster)
      if (options.returnData === 'minimal' || options.returnData === false) {
        return {
          id: threadId,
          success: true,
          updatedFields: { status },
          timestamp: new Date()
        }
      }

      // Only fetch full data if explicitly requested
      if (options.returnData === 'full' || options.returnData === true) {
        return await this.fetchThreadWithOptimizedIncludes(threadId, options.include)
      }

      return result[0] as any // Return just the updated fields
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
   * Optimized fetch method with selective includes
   */
  private async fetchThreadWithOptimizedIncludes(
    threadId: string,
    include?: MutationOptions['include']
  ): Promise<ThreadListItem> {
    const thread = await this.db.query.Thread.findFirst({
      where: (threads, { eq, and }) => and(
        eq(threads.id, threadId),
        eq(threads.organizationId, this.organizationId)
      ),
      with: {
        // Only include what's requested
        ...(include?.messages && {
          messages: {
            where: (messages, { eq }) => eq(messages.draftMode, DraftMode.NONE),
            orderBy: (messages, { desc }) => [desc(messages.sentAt)],
            limit: 1,
            with: { from: true }
          }
        }),
        ...(include?.assignee && { assignee: true }),
        // Note: inbox relation removed - Thread.inboxId was removed in migration 0028
        ...(include?.integration && { integration: true }),
        ...(include?.labels && {
          labels: { with: { label: true } }
        }),
        ...(include?.tags && {
          tags: { with: { tag: true } }
        }),
        // Comments removed - fetched separately via CommentService
      }
    })

    return thread as ThreadListItem
  }

  /**
   * Updates the subject of a thread
   */
  async updateThreadSubject(
    threadId: string,
    subject: string,
    options: MutationOptions = { returnData: 'minimal' }
  ): Promise<MutationResult | ThreadListItem> {
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
          subject: trimmedSubject
        })
        .where(
          and(
            eq(schema.Thread.id, threadId),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .returning({
          id: schema.Thread.id,
          subject: schema.Thread.subject
        })

      if (result.length === 0) {
        throw new Error(`Thread ${threadId} not found`)
      }

      // Return minimal result by default
      if (options.returnData === 'minimal' || options.returnData === false) {
        return {
          id: threadId,
          success: true,
          updatedFields: { subject: trimmedSubject },
          timestamp: new Date()
        }
      }

      // Only fetch full data if explicitly requested
      if (options.returnData === 'full' || options.returnData === true) {
        return await this.fetchThreadWithOptimizedIncludes(threadId, options.include)
      }

      return result[0] as any
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
   * Assigns or unassigns a thread to a user
   */
  async assignThread(
    threadId: string,
    assigneeId: string | null, // User ID or null to unassign
    options: MutationOptions = { returnData: 'minimal' }
  ): Promise<MutationResult | ThreadListItem> {
    logger.info('Assigning thread', { threadId, assigneeId, organizationId: this.organizationId })

    try {
      // Optional: Verify assigneeId belongs to the organization if not null
      if (assigneeId) {
        const memberExists = await this.db.query.OrganizationMember.findFirst({
          where: (members, { eq, and }) => and(
            eq(members.userId, assigneeId),
            eq(members.organizationId, this.organizationId)
          ),
          columns: { id: true }
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
          assigneeId
        })
        .where(
          and(
            eq(schema.Thread.id, threadId),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .returning({
          id: schema.Thread.id,
          assigneeId: schema.Thread.assigneeId
        })

      if (result.length === 0) {
        throw new Error(`Thread ${threadId} not found`)
      }

      // Return minimal result by default
      if (options.returnData === 'minimal' || options.returnData === false) {
        return {
          id: threadId,
          success: true,
          updatedFields: { assigneeId },
          timestamp: new Date()
        }
      }

      // Only fetch full data if explicitly requested
      if (options.returnData === 'full' || options.returnData === true) {
        return await this.fetchThreadWithOptimizedIncludes(threadId, options.include)
      }

      return result[0] as any
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
    status: typeof ThreadStatus[keyof typeof ThreadStatus],
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
          status: status as any
        })
        .where(
          and(
            inArray(schema.Thread.id, threadIds),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .returning(options.returnAffectedCount ? { id: schema.Thread.id } : { id: schema.Thread.id })

      return {
        count: result.length,
        ...(options.returnAffectedCount && { affectedIds: result.map(r => r.id) })
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
          where: (members, { eq, and }) => and(
            eq(members.userId, assigneeId),
            eq(members.organizationId, this.organizationId)
          ),
          columns: { id: true } // Minimal select
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
          assigneeId
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
        errors
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
   * Most performance-critical operation - completely redesigned for Drizzle
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
      // 1. Fast tag validation (batch query)
      const existingTags = await this.db.query.Tag.findMany({
        where: (tags, { and, inArray, eq }) => and(
          inArray(tags.id, tagIds),
          eq(tags.organizationId, this.organizationId)
        ),
        columns: { id: true }
      })

      const validTagIds = existingTags.map(t => t.id)
      const invalidTagIds = tagIds.filter(id => !validTagIds.includes(id))

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
          // Remove all existing tags for these threads first
          await tx.delete(schema.TagsOnThread)
            .where(inArray(schema.TagsOnThread.threadId, threadIds))
        }

        if (operation === 'remove') {
          const deleteResult = await tx.delete(schema.TagsOnThread)
            .where(
              and(
                inArray(schema.TagsOnThread.threadId, threadIds),
                inArray(schema.TagsOnThread.tagId, validTagIds)
              )
            )
            .returning({ threadId: schema.TagsOnThread.threadId })
          created = deleteResult.length
        } else {
          // 'add' or 'set' - Generate all combinations efficiently
          const tagsToCreate = threadIds.flatMap(threadId =>
            validTagIds.map(tagId => ({
              threadId,
              tagId,
              createdAt: new Date()
            }))
          )

          if (tagsToCreate.length > 0) {
            // Bulk insert with conflict handling (much faster than individual checks)
            const result = await tx
              .insert(schema.TagsOnThread)
              .values(tagsToCreate)
              .onConflictDoNothing({ target: [schema.TagsOnThread.threadId, schema.TagsOnThread.tagId] })
              .returning({ threadId: schema.TagsOnThread.threadId })

            created = result.length
            skipped = tagsToCreate.length - result.length
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
   * Moves multiple threads to a specified target inbox
   */
  async moveThreadsToInbox(
    threadIds: string[],
    targetInboxId: string,
    userId: string
  ): Promise<{ count: number }> {
    if (!threadIds || threadIds.length === 0) return { count: 0 }

    logger.info('Moving threads to inbox', {
      count: threadIds.length,
      targetInboxId,
      organizationId: this.organizationId,
      userId,
    })

    try {
      // Verify target inbox exists and belongs to the org
      const targetInbox = await this.db.query.Inbox.findFirst({
        where: (inboxes, { eq, and }) => and(
          eq(inboxes.id, targetInboxId),
          eq(inboxes.organizationId, this.organizationId)
        ),
        columns: { id: true }
      })
      if (!targetInbox)
        throw new Error(`Target inbox (${targetInboxId}) not found or not accessible.`)

      // Update threads
      const result = await this.db
        .update(schema.Thread)
        .set({
          inboxId: targetInboxId
        })
        .where(
          and(
            inArray(schema.Thread.id, threadIds),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .returning({ id: schema.Thread.id })

      logger.info('Threads successfully moved to inbox', { updatedCount: result.length })
      return { count: result.length }
    } catch (error: unknown) {
      logger.error('Failed to move threads to inbox', {
        error: error instanceof Error ? error.message : error,
        targetInboxId,
      })
      if (error instanceof Error && error.message.startsWith('Target inbox')) throw error
      throw new Error(
        `Database error while moving threads: ${error instanceof Error ? error.message : error}`
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
          and(
            eq(schema.Thread.id, threadId),
            eq(schema.Thread.organizationId, this.organizationId)
          )
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
  async markAsSpam(threadId: string, options?: MutationOptions): Promise<MutationResult | ThreadListItem> {
    return this.updateThreadStatus(threadId, 'SPAM', options)
  }

  async moveToTrash(threadId: string, options?: MutationOptions): Promise<MutationResult | ThreadListItem> {
    return this.updateThreadStatus(threadId, 'TRASH', options)
  }

  async archiveThread(threadId: string, options?: MutationOptions): Promise<MutationResult | ThreadListItem> {
    return this.updateThreadStatus(threadId, 'ARCHIVED', options)
  }

  async unarchiveThread(threadId: string, options?: MutationOptions): Promise<MutationResult | ThreadListItem> {
    return this.updateThreadStatus(threadId, 'OPEN', options)
  }

  // Convenience bulk status methods
  async markAsSpamBulk(threadIds: string[], options?: { returnAffectedCount?: boolean }): Promise<{ count: number; affectedIds?: string[] }> {
    return this.updateThreadStatusBulk(threadIds, 'SPAM', options)
  }

  async moveToTrashBulk(threadIds: string[], options?: { returnAffectedCount?: boolean }): Promise<{ count: number; affectedIds?: string[] }> {
    return this.updateThreadStatusBulk(threadIds, 'TRASH', options)
  }

  async archiveThreadBulk(threadIds: string[], options?: { returnAffectedCount?: boolean }): Promise<{ count: number; affectedIds?: string[] }> {
    return this.updateThreadStatusBulk(threadIds, 'ARCHIVED', options)
  }

  async unarchiveThreadBulk(threadIds: string[], options?: { returnAffectedCount?: boolean }): Promise<{ count: number; affectedIds?: string[] }> {
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
    // Get all non-draft messages with proper dates
    const messages = await this.db.query.Message.findMany({
      where: (messages, { eq, and, isNotNull }) => and(
        eq(messages.threadId, threadId),
        eq(messages.draftMode, DraftMode.NONE),
        isNotNull(messages.sentAt)
      ),
      columns: { sentAt: true },
      orderBy: (messages, { asc }) => [asc(messages.sentAt)]
    })

    const messageCount = messages.length
    const firstMessageAt = messages[0]?.sentAt || null
    const lastMessageAt = messages[messages.length - 1]?.sentAt || null

    await this.db
      .update(schema.Thread)
      .set({
        messageCount,
        firstMessageAt,
        lastMessageAt
      })
      .where(eq(schema.Thread.id, threadId))

    logger.debug('Updated thread metadata', {
      threadId,
      operation,
      messageCount,
      firstMessageAt,
      lastMessageAt,
    })
  }

  /**
   * Updates thread participants after message operations
   */
  async updateThreadParticipants(threadId: string): Promise<void> {
    // Get messages and their participants for this thread
    const messages = await this.db.query.Message.findMany({
      where: (messages, { eq, and }) => and(
        eq(messages.threadId, threadId),
        eq(messages.draftMode, DraftMode.NONE)
      ),
      columns: { id: true },
      with: {
        participants: {
          columns: { participantId: true }
        }
      }
    })

    // Extract unique participant IDs
    const participantIds = [...new Set(
      messages
        .flatMap(m => m.participants)
        .map(p => p.participantId)
        .filter(Boolean)
    )]

    await this.db
      .update(schema.Thread)
      .set({
        participantIds,
        participantCount: participantIds.length
      })
      .where(eq(schema.Thread.id, threadId))

    logger.debug('Updated thread participants', {
      threadId,
      participantCount: participantIds.length,
    })
  }
}
