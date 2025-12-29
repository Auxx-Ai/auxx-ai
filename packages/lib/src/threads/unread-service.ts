// src/lib/threads/unread-service.ts
import { database as db, schema } from '@auxx/database'
import { eq, and, or, inArray, sql, count, lt, exists } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { UserUnreadCounts } from './types'
// Import Redis client setup
// import { getRedisClient } from '@auxx/redis';

const logger = createScopedLogger('unread-service')

export class UnreadService {
  private organizationId: string
  private userId: string

  constructor(organizationId: string, userId: string, _db?: any) {
    this.organizationId = organizationId
    this.userId = userId
    // _db parameter is kept for compatibility but not used - we use the imported db directly
  }

  private getRedisCountKey(inboxId: string, userId: string): string {
    if (!userId) userId = this.userId // Use the class userId if not provided
    return `unread_count:org:${this.organizationId}:inbox:${inboxId}:user:${userId}`
  }

  /**
   * Calculates the unread count for a specific user and inbox.
   * This is the core logic based on last message date vs last read date.
   */
  async calculateUnreadCountForUserInbox(inboxId: string): Promise<number> {
    // Count threads without read status entries for the user
    const threadsWithoutReadStatus = await db
      .select({ threadId: schema.Thread.id })
      .from(schema.Thread)
      .leftJoin(
        schema.ThreadReadStatus,
        and(
          eq(schema.ThreadReadStatus.threadId, schema.Thread.id),
          eq(schema.ThreadReadStatus.userId, this.userId)
        )
      )
      .where(
        and(
          eq(schema.Thread.organizationId, this.organizationId),
          // Filter by inboxId using InboxIntegration junction table
          exists(
            db
              .select()
              .from(schema.InboxIntegration)
              .where(
                and(
                  eq(schema.InboxIntegration.integrationId, schema.Thread.integrationId),
                  eq(schema.InboxIntegration.inboxId, inboxId)
                )
              )
          ),
          eq(schema.Thread.status, 'OPEN' as any)
        )
      )

    // Count threads with explicit unread status
    const threadsWithUnreadStatus = await db
      .select({ threadId: schema.Thread.id })
      .from(schema.Thread)
      .innerJoin(schema.ThreadReadStatus, eq(schema.ThreadReadStatus.threadId, schema.Thread.id))
      .where(
        and(
          eq(schema.Thread.organizationId, this.organizationId),
          // Filter by inboxId using InboxIntegration junction table
          exists(
            db
              .select()
              .from(schema.InboxIntegration)
              .where(
                and(
                  eq(schema.InboxIntegration.integrationId, schema.Thread.integrationId),
                  eq(schema.InboxIntegration.inboxId, inboxId)
                )
              )
          ),
          eq(schema.Thread.status, 'OPEN' as any),
          eq(schema.ThreadReadStatus.userId, this.userId),
          or(
            eq(schema.ThreadReadStatus.lastReadAt, null),
            eq(schema.ThreadReadStatus.isRead, false)
          )
        )
      )

    const totalCount = threadsWithoutReadStatus.length + threadsWithUnreadStatus.length
    logger.debug(
      `Calculated unread count for user ${this.userId} in inbox ${inboxId}: ${totalCount}`
    )
    return totalCount

    // TODO: Revisit the WHERE clause for accuracy vs. performance.
    // A potentially more accurate count might require fetching thread IDs and their lastMessageDate,
    // fetching corresponding ThreadReadStatus, and comparing dates in the application code.
    // For now, the above count relies heavily on keeping `isRead` accurate.
  }

  /**
   * Updates the aggregated unread count in the database and Redis cache.
   */
  async updateUserInboxUnreadCount(inboxId: string, userId?: string): Promise<any> {
    if (!userId) userId = this.userId // Use the class userId if not provided
    const calculatedCount = await this.calculateUnreadCountForUserInbox(inboxId)
    const _redisKey = this.getRedisCountKey(inboxId, userId)

    logger.info(
      `Updating unread count for user ${userId} in inbox ${inboxId} to ${calculatedCount}`
    )

    // Check if record exists
    const [existingRecord] = await db
      .select()
      .from(schema.UserInboxUnreadCount)
      .where(
        and(
          eq(schema.UserInboxUnreadCount.organizationId, this.organizationId),
          eq(schema.UserInboxUnreadCount.inboxId, inboxId),
          eq(schema.UserInboxUnreadCount.userId, userId)
        )
      )
      .limit(1)

    let updatedRecord: any
    const now = new Date()

    if (existingRecord) {
      // Update existing record
      await db
        .update(schema.UserInboxUnreadCount)
        .set({
          unreadCount: calculatedCount,
          lastUpdatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.UserInboxUnreadCount.organizationId, this.organizationId),
            eq(schema.UserInboxUnreadCount.inboxId, inboxId),
            eq(schema.UserInboxUnreadCount.userId, userId)
          )
        )

      updatedRecord = { ...existingRecord, unreadCount: calculatedCount, updatedAt: now }
    } else {
      // Create new record
      const [newRecord] = await db
        .insert(schema.UserInboxUnreadCount)
        .values({
          organizationId: this.organizationId,
          inboxId: inboxId,
          userId,
          unreadCount: calculatedCount,
          lastUpdatedAt: new Date(),
        })
        .returning()

      updatedRecord = newRecord
    }

    // Update Redis Cache (Set with an expiration?)
    // await redis.set(redisKey, calculatedCount, 'EX', 3600); // Cache for 1 hour

    return updatedRecord
  }

  /**
   * Marks a thread as read for a user.
   * Handles updating aggregate counts and cache.
   */
  async markThreadAsRead(
    threadId: string,
    userId?: string,
    lastSeenMessageId?: string
  ): Promise<void> {
    if (!userId) userId = this.userId

    // Get thread info with inbox association via InboxIntegration junction table
    const [thread] = await db
      .select({
        inboxId: schema.InboxIntegration.inboxId,
        lastMessageAt: schema.Thread.lastMessageAt,
      })
      .from(schema.Thread)
      .leftJoin(
        schema.InboxIntegration,
        eq(schema.InboxIntegration.integrationId, schema.Thread.integrationId)
      )
      .where(
        and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
      )
      .limit(1)

    if (!thread || !thread.inboxId) {
      logger.warn(`Thread ${threadId} not found or has no inboxId, cannot mark read.`)
      return
    }

    // Get latest message if not provided
    let latestMessageId = lastSeenMessageId
    if (!latestMessageId) {
      const [latestMessage] = await db
        .select({ id: schema.Message.id })
        .from(schema.Message)
        .where(eq(schema.Message.threadId, threadId))
        .orderBy(sql`${schema.Message.sentAt} DESC`)
        .limit(1)
      latestMessageId = latestMessage?.id ?? null
    }

    const now = new Date()

    // Use Drizzle transaction
    await db.transaction(async (tx) => {
      // Check if read status exists
      const [existingStatus] = await tx
        .select()
        .from(schema.ThreadReadStatus)
        .where(
          and(
            eq(schema.ThreadReadStatus.threadId, threadId),
            eq(schema.ThreadReadStatus.userId, userId)
          )
        )
        .limit(1)

      if (existingStatus) {
        // Update existing status
        await tx
          .update(schema.ThreadReadStatus)
          .set({
            isRead: true,
            lastReadAt: now,
            lastSeenMessageId: latestMessageId,
          })
          .where(
            and(
              eq(schema.ThreadReadStatus.threadId, threadId),
              eq(schema.ThreadReadStatus.userId, userId)
            )
          )
      } else {
        // Create new status
        await tx.insert(schema.ThreadReadStatus).values({
          threadId,
          userId,
          organizationId: this.organizationId,
          isRead: true,
          lastReadAt: now,
          lastSeenMessageId: latestMessageId,
        })
      }

      // Trigger count update (can be awaited or done async/queued)
      await this.updateUserInboxUnreadCount(thread.inboxId!, userId) // Await for consistency in this example
    })
    logger.info(`Marked thread ${threadId} as read for user ${userId}`)
  }

  /**
   * Marks a thread as unread for a user.
   */
  async markThreadAsUnread(threadId: string, userId?: string): Promise<void> {
    if (!userId) userId = this.userId // Use the class userId if not provided

    // Get thread inbox association via InboxIntegration junction table
    const [thread] = await db
      .select({ inboxId: schema.InboxIntegration.inboxId })
      .from(schema.Thread)
      .leftJoin(
        schema.InboxIntegration,
        eq(schema.InboxIntegration.integrationId, schema.Thread.integrationId)
      )
      .where(
        and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
      )
      .limit(1)

    if (!thread || !thread.inboxId) {
      logger.warn(`Thread ${threadId} not found or has no inboxId, cannot mark unread.`)
      return
    }

    const now = new Date()

    await db.transaction(async (tx) => {
      // Check if read status exists
      const [existingStatus] = await tx
        .select()
        .from(schema.ThreadReadStatus)
        .where(
          and(
            eq(schema.ThreadReadStatus.threadId, threadId),
            eq(schema.ThreadReadStatus.userId, userId)
          )
        )
        .limit(1)

      if (existingStatus) {
        // Update existing status
        await tx
          .update(schema.ThreadReadStatus)
          .set({
            isRead: false,
            lastReadAt: null,
          })
          .where(
            and(
              eq(schema.ThreadReadStatus.threadId, threadId),
              eq(schema.ThreadReadStatus.userId, userId)
            )
          )
      } else {
        // Create new status
        await tx.insert(schema.ThreadReadStatus).values({
          threadId,
          userId,
          organizationId: this.organizationId,
          isRead: false,
          lastReadAt: null,
        })
      }

      // Trigger count update
      await this.updateUserInboxUnreadCount(thread.inboxId!, userId) // Await for consistency in this example
    })
    logger.info(`Marked thread ${threadId} as unread for user ${userId}`)
  }

  /**
   * Marks multiple threads as read/unread in batch.
   */
  async markMultipleThreads(threadIds: string[], markAs: 'read' | 'unread'): Promise<void> {
    if (threadIds.length === 0) return

    // Get threads with their inbox associations via InboxIntegration junction table
    const threads = await db
      .select({
        id: schema.Thread.id,
        inboxId: schema.InboxIntegration.inboxId,
        lastMessageAt: schema.Thread.lastMessageAt,
      })
      .from(schema.Thread)
      .leftJoin(
        schema.InboxIntegration,
        eq(schema.InboxIntegration.integrationId, schema.Thread.integrationId)
      )
      .where(
        and(
          inArray(schema.Thread.id, threadIds),
          eq(schema.Thread.organizationId, this.organizationId),
          // Only include threads that have an inbox association
          exists(
            db
              .select()
              .from(schema.InboxIntegration)
              .where(eq(schema.InboxIntegration.integrationId, schema.Thread.integrationId))
          )
        )
      )

    if (threads.length === 0) return

    // Get latest messages for each thread
    const threadMessageMap = new Map<string, string>()
    for (const thread of threads) {
      const [latestMessage] = await db
        .select({ id: schema.Message.id })
        .from(schema.Message)
        .where(eq(schema.Message.threadId, thread.id))
        .orderBy(sql`${schema.Message.sentAt} DESC`)
        .limit(1)
      if (latestMessage) {
        threadMessageMap.set(thread.id, latestMessage.id)
      }
    }

    const affectedInboxIds = [
      ...new Set(threads.map((t) => t.inboxId).filter((id) => id !== null)),
    ] as string[]
    const now = new Date()

    await db.transaction(async (tx) => {
      const upsertPromises = threads.map(async (thread) => {
        const latestMessageId = threadMessageMap.get(thread.id) ?? null

        // Check if read status exists
        const [existingStatus] = await tx
          .select()
          .from(schema.ThreadReadStatus)
          .where(
            and(
              eq(schema.ThreadReadStatus.threadId, thread.id),
              eq(schema.ThreadReadStatus.userId, this.userId)
            )
          )
          .limit(1)

        if (existingStatus) {
          // Update existing status
          await tx
            .update(schema.ThreadReadStatus)
            .set({
              isRead: markAs === 'read',
              lastReadAt: markAs === 'read' ? now : null,
              lastSeenMessageId:
                markAs === 'read' ? latestMessageId : existingStatus.lastSeenMessageId,
            })
            .where(
              and(
                eq(schema.ThreadReadStatus.threadId, thread.id),
                eq(schema.ThreadReadStatus.userId, this.userId)
              )
            )
        } else {
          // Create new status
          await tx.insert(schema.ThreadReadStatus).values({
            threadId: thread.id,
            userId: this.userId,
            organizationId: this.organizationId,
            isRead: markAs === 'read',
            lastReadAt: markAs === 'read' ? now : null,
            lastSeenMessageId: markAs === 'read' ? latestMessageId : null,
          })
        }
      })

      await Promise.all(upsertPromises)

      // Update counts for all affected inboxes
      const updateCountPromises = affectedInboxIds.map(
        (inboxId) => this.updateUserInboxUnreadCount(inboxId) // Call the method that also updates cache
      )
      await Promise.all(updateCountPromises)
    })

    logger.info(`Marked ${threads.length} threads as ${markAs} for user ${this.userId}`)
  }

  /**
   * Fetches unread counts for all inboxes AND personal sections for a user.
   * Enhanced to include inbox and assigned counts.
   */
  async getUnreadCountsForUser(userId?: string): Promise<UserUnreadCounts> {
    // TODO: Implement Redis caching check here
    // const cachedCounts = await redis.get(...) pattern matching? MGET?
    // if (cachedCounts) return cachedCounts;
    if (!userId) userId = this.userId

    logger.debug(`Fetching enhanced unread counts from DB for user ${userId}`)

    // Get existing shared inbox counts
    const countsFromDb = await db
      .select({
        inboxId: schema.UserInboxUnreadCount.inboxId,
        unreadCount: schema.UserInboxUnreadCount.unreadCount,
      })
      .from(schema.UserInboxUnreadCount)
      .where(
        and(
          eq(schema.UserInboxUnreadCount.userId, userId),
          eq(schema.UserInboxUnreadCount.organizationId, this.organizationId)
        )
      )

    // Get personal counts in parallel
    const [personalInboxCount, assignedCount] = await Promise.all([
      // Count all unread threads in personal inbox context
      (async () => {
        // Count threads without read status
        const threadsWithoutStatus = await db
          .select({ threadId: schema.Thread.id })
          .from(schema.Thread)
          .leftJoin(
            schema.ThreadReadStatus,
            and(
              eq(schema.ThreadReadStatus.threadId, schema.Thread.id),
              eq(schema.ThreadReadStatus.userId, userId)
            )
          )
          .where(
            and(
              eq(schema.Thread.organizationId, this.organizationId),
              eq(schema.ThreadReadStatus.userId, null)
            )
          )

        // Count threads with explicit unread status
        const threadsWithUnreadStatus = await db
          .select({ threadId: schema.Thread.id })
          .from(schema.Thread)
          .innerJoin(
            schema.ThreadReadStatus,
            eq(schema.ThreadReadStatus.threadId, schema.Thread.id)
          )
          .where(
            and(
              eq(schema.Thread.organizationId, this.organizationId),
              eq(schema.ThreadReadStatus.userId, userId),
              eq(schema.ThreadReadStatus.isRead, false)
            )
          )

        return threadsWithoutStatus.length + threadsWithUnreadStatus.length
      })(),

      // Count unread threads assigned to user
      (async () => {
        // Count assigned threads without read status
        const assignedWithoutStatus = await db
          .select({ threadId: schema.Thread.id })
          .from(schema.Thread)
          .leftJoin(
            schema.ThreadReadStatus,
            and(
              eq(schema.ThreadReadStatus.threadId, schema.Thread.id),
              eq(schema.ThreadReadStatus.userId, userId)
            )
          )
          .where(
            and(
              eq(schema.Thread.organizationId, this.organizationId),
              eq(schema.Thread.assigneeId, userId),
              eq(schema.ThreadReadStatus.userId, null)
            )
          )

        // Count assigned threads with explicit unread status
        const assignedWithUnreadStatus = await db
          .select({ threadId: schema.Thread.id })
          .from(schema.Thread)
          .innerJoin(
            schema.ThreadReadStatus,
            eq(schema.ThreadReadStatus.threadId, schema.Thread.id)
          )
          .where(
            and(
              eq(schema.Thread.organizationId, this.organizationId),
              eq(schema.Thread.assigneeId, userId),
              eq(schema.ThreadReadStatus.userId, userId),
              eq(schema.ThreadReadStatus.isRead, false)
            )
          )

        return assignedWithoutStatus.length + assignedWithUnreadStatus.length
      })(),
    ])

    // Build the enhanced counts map
    const countsMap: UserUnreadCounts = {}

    // Add shared inbox counts (existing logic)
    for (const item of countsFromDb) {
      countsMap[item.inboxId] = item.unreadCount
    }

    // Add personal counts with special keys
    countsMap.inbox = personalInboxCount
    countsMap.assigned = assignedCount
    // Note: drafts and sent intentionally omitted - no unread concept

    logger.debug(`Enhanced unread counts for user ${userId}:`, {
      sharedInboxes: countsFromDb.length,
      personalInbox: personalInboxCount,
      assigned: assignedCount,
      finalCountsMap: countsMap,
    })

    return countsMap
  }

  // --- Helper potentially needed when new messages arrive ---
  /**
   * When a new message arrives, potentially mark the thread as unread
   * for users who had previously read it before this message.
   */
  async handleNewMessage(threadId: string, newMessageDate: Date): Promise<void> {
    // Get thread inbox association via InboxIntegration junction table
    const [thread] = await db
      .select({ inboxId: schema.InboxIntegration.inboxId })
      .from(schema.Thread)
      .leftJoin(
        schema.InboxIntegration,
        eq(schema.InboxIntegration.integrationId, schema.Thread.integrationId)
      )
      .where(
        and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
      )
      .limit(1)

    if (!thread || !thread.inboxId) return

    const inboxId = thread.inboxId

    // Find users who read this thread *before* the new message
    const usersToUpdate = await db
      .select({ userId: schema.ThreadReadStatus.userId })
      .from(schema.ThreadReadStatus)
      .where(
        and(
          eq(schema.ThreadReadStatus.threadId, threadId),
          eq(schema.ThreadReadStatus.organizationId, this.organizationId),
          eq(schema.ThreadReadStatus.isRead, true),
          lt(schema.ThreadReadStatus.lastReadAt, newMessageDate)
        )
      )

    if (usersToUpdate.length > 0) {
      const userIds = usersToUpdate.map((u) => u.userId)
      await db.transaction(async (tx) => {
        // Mark as unread for these users
        await tx
          .update(schema.ThreadReadStatus)
          .set({
            isRead: false,
            // Keep lastReadAt, it indicates when they *last* read, even if now unread
          })
          .where(
            and(
              eq(schema.ThreadReadStatus.threadId, threadId),
              inArray(schema.ThreadReadStatus.userId, userIds)
            )
          )

        // Update aggregate counts for all affected users in this inbox
        const updateCountPromises = userIds.map(
          (userId) => this.updateUserInboxUnreadCount(inboxId, userId) // Assumes this runs within the tx context if called directly
          // Or call a tx-aware version
        )
        await Promise.all(updateCountPromises)
      })
      logger.info(
        `Marked thread ${threadId} as unread for ${userIds.length} users due to new message`
      )
    }
  }
}
