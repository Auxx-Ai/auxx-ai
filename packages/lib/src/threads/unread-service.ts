// packages/lib/src/threads/unread-service.ts
import { database as db, schema } from '@auxx/database'
import { eq, and, or, inArray, sql, count, lt, isNull } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { type UserUnreadCounts, type FullCountsResponse } from './types'
import { buildConditionGroupsQuery } from '../mail-query/condition-query-builder'
import type { ConditionGroup } from '../conditions/types'

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
          // Filter by inboxId directly on Thread
          eq(schema.Thread.inboxId, inboxId),
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
          // Filter by inboxId directly on Thread
          eq(schema.Thread.inboxId, inboxId),
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
   * Sets the read status for one or more threads.
   */
  async setReadStatus(
    threadId: string | string[],
    isRead: boolean,
    userId?: string
  ): Promise<void> {
    const targetUserId = userId ?? this.userId
    const threadIds = Array.isArray(threadId) ? threadId : [threadId]

    if (threadIds.length === 0) return

    // Fetch threads with inboxIds
    const threads = await db
      .select({
        id: schema.Thread.id,
        inboxId: schema.Thread.inboxId,
      })
      .from(schema.Thread)
      .where(
        and(
          inArray(schema.Thread.id, threadIds),
          eq(schema.Thread.organizationId, this.organizationId)
        )
      )

    if (threads.length === 0) return

    // Get latest message IDs only when marking as read
    const threadMessageMap = new Map<string, string | null>()
    if (isRead) {
      const messages = await db
        .select({
          threadId: schema.Message.threadId,
          id: schema.Message.id,
        })
        .from(schema.Message)
        .where(inArray(schema.Message.threadId, threadIds))
        .orderBy(sql`${schema.Message.sentAt} DESC`)

      // Keep only the first (latest) message per thread
      for (const msg of messages) {
        if (!threadMessageMap.has(msg.threadId)) {
          threadMessageMap.set(msg.threadId, msg.id)
        }
      }
    }

    const affectedInboxIds = [...new Set(threads.map((t) => t.inboxId).filter(Boolean))] as string[]
    const now = new Date()

    await db.transaction(async (tx) => {
      // Upsert read status for each thread
      await Promise.all(
        threads.map(async (thread) => {
          const latestMessageId = threadMessageMap.get(thread.id) ?? null

          await tx
            .insert(schema.ThreadReadStatus)
            .values({
              threadId: thread.id,
              userId: targetUserId,
              organizationId: this.organizationId,
              isRead,
              lastReadAt: isRead ? now : null,
              lastSeenMessageId: isRead ? latestMessageId : null,
            })
            .onConflictDoUpdate({
              target: [schema.ThreadReadStatus.threadId, schema.ThreadReadStatus.userId],
              set: {
                isRead,
                lastReadAt: isRead ? now : null,
                ...(isRead && { lastSeenMessageId: latestMessageId }),
              },
            })
        })
      )

      // Update counts for all affected inboxes
      await Promise.all(
        affectedInboxIds.map((inboxId) => this.updateUserInboxUnreadCount(inboxId, targetUserId))
      )
    })

    logger.info(
      `Set ${threads.length} thread(s) to ${isRead ? 'read' : 'unread'} for user ${targetUserId}`
    )
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
    // Get thread with direct inboxId
    const [thread] = await db
      .select({ inboxId: schema.Thread.inboxId })
      .from(schema.Thread)
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

  // ============================================================================
  // NEW METHODS: Full counts for mail sidebar
  // ============================================================================

  /**
   * Counts all drafts for the current user.
   * Includes both standalone drafts and thread-attached drafts.
   */
  async getDraftsCount(): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(schema.Draft)
      .where(
        and(
          eq(schema.Draft.createdById, this.userId),
          eq(schema.Draft.organizationId, this.organizationId)
        )
      )

    return result[0]?.count ?? 0
  }

  /**
   * Counts unread threads assigned to the current user with OPEN status.
   * This is the "Personal Inbox" count - threads I need to action.
   */
  async getPersonalInboxCount(): Promise<number> {
    // Count threads without read status
    const withoutStatus = await db
      .select({ count: count() })
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
          eq(schema.Thread.assigneeId, this.userId),
          eq(schema.Thread.status, 'OPEN' as any),
          isNull(schema.ThreadReadStatus.userId) // No read status = unread
        )
      )

    // Count threads with explicit unread status
    const withUnreadStatus = await db
      .select({ count: count() })
      .from(schema.Thread)
      .innerJoin(
        schema.ThreadReadStatus,
        eq(schema.ThreadReadStatus.threadId, schema.Thread.id)
      )
      .where(
        and(
          eq(schema.Thread.organizationId, this.organizationId),
          eq(schema.Thread.assigneeId, this.userId),
          eq(schema.Thread.status, 'OPEN' as any),
          eq(schema.ThreadReadStatus.userId, this.userId),
          eq(schema.ThreadReadStatus.isRead, false)
        )
      )

    return (withoutStatus[0]?.count ?? 0) + (withUnreadStatus[0]?.count ?? 0)
  }

  /**
   * Gets all shared inbox counts for the organization.
   * Returns a map of inboxId -> unread count.
   */
  async getSharedInboxCounts(): Promise<Record<string, number>> {
    // Get counts from pre-calculated table
    const countsFromDb = await db
      .select({
        inboxId: schema.UserInboxUnreadCount.inboxId,
        unreadCount: schema.UserInboxUnreadCount.unreadCount,
      })
      .from(schema.UserInboxUnreadCount)
      .where(
        and(
          eq(schema.UserInboxUnreadCount.userId, this.userId),
          eq(schema.UserInboxUnreadCount.organizationId, this.organizationId)
        )
      )

    const countsMap: Record<string, number> = {}
    for (const item of countsFromDb) {
      countsMap[item.inboxId] = item.unreadCount
    }

    return countsMap
  }

  /**
   * Gets all accessible mail view IDs for the current user.
   * Includes both personal and shared views.
   */
  async getAccessibleViewIds(): Promise<string[]> {
    const [userViews, sharedViews] = await Promise.all([
      db
        .select({ id: schema.MailView.id })
        .from(schema.MailView)
        .where(
          and(
            eq(schema.MailView.userId, this.userId),
            eq(schema.MailView.organizationId, this.organizationId)
          )
        ),
      db
        .select({ id: schema.MailView.id })
        .from(schema.MailView)
        .where(
          and(
            eq(schema.MailView.isShared, true),
            eq(schema.MailView.organizationId, this.organizationId)
          )
        ),
    ])

    // Combine and deduplicate
    const allIds = new Set([
      ...userViews.map((v) => v.id),
      ...sharedViews.map((v) => v.id),
    ])

    return Array.from(allIds)
  }

  /**
   * Counts unread OPEN threads matching each view's filter conditions.
   * Returns a map of viewId -> unread count.
   */
  async getViewCounts(viewIds: string[]): Promise<Record<string, number>> {
    if (viewIds.length === 0) return {}

    // Fetch views with their filters
    const views = await db
      .select({
        id: schema.MailView.id,
        filters: schema.MailView.filters,
      })
      .from(schema.MailView)
      .where(inArray(schema.MailView.id, viewIds))

    // Calculate count for each view in parallel
    const countPromises = views.map(async (view) => {
      const filters = (view.filters as ConditionGroup[]) || []

      // Build WHERE condition from view filters
      const whereCondition = buildConditionGroupsQuery(filters, this.organizationId)

      // Count unread OPEN threads matching the filters
      // Use subquery approach to avoid complex join issues

      // Step 1: Get thread IDs that match the view filters and are OPEN
      // Step 2: Filter to only unread (no read status or isRead=false)

      // Unread threads without read status
      const withoutStatusResult = await db
        .select({ count: count() })
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
            whereCondition,
            eq(schema.Thread.status, 'OPEN' as any),
            isNull(schema.ThreadReadStatus.userId)
          )
        )

      // Unread threads with explicit unread status
      const withUnreadStatusResult = await db
        .select({ count: count() })
        .from(schema.Thread)
        .innerJoin(
          schema.ThreadReadStatus,
          eq(schema.ThreadReadStatus.threadId, schema.Thread.id)
        )
        .where(
          and(
            whereCondition,
            eq(schema.Thread.status, 'OPEN' as any),
            eq(schema.ThreadReadStatus.userId, this.userId),
            eq(schema.ThreadReadStatus.isRead, false)
          )
        )

      const totalUnread =
        (withoutStatusResult[0]?.count ?? 0) + (withUnreadStatusResult[0]?.count ?? 0)

      return { viewId: view.id, count: totalUnread }
    })

    const results = await Promise.all(countPromises)

    const countsMap: Record<string, number> = {}
    for (const result of results) {
      countsMap[result.viewId] = result.count
    }

    return countsMap
  }

  /**
   * Get all counts needed for the mail sidebar in a single call.
   * Fetches personal inbox, drafts, shared inboxes, and view counts.
   */
  async getFullCounts(): Promise<FullCountsResponse> {
    // Get accessible view IDs first (needed for view counts)
    const viewIds = await this.getAccessibleViewIds()

    // Fetch all counts in parallel
    const [inbox, drafts, sharedInboxes, views] = await Promise.all([
      this.getPersonalInboxCount(),
      this.getDraftsCount(),
      this.getSharedInboxCounts(),
      this.getViewCounts(viewIds),
    ])

    logger.debug(`Full counts for user ${this.userId}:`, {
      inbox,
      drafts,
      sharedInboxesCount: Object.keys(sharedInboxes).length,
      viewsCount: Object.keys(views).length,
    })

    return {
      inbox,
      drafts,
      sharedInboxes,
      views,
    }
  }
}
