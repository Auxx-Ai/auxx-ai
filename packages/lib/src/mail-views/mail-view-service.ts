// packages/lib/src/mail-views/mail-view-service.ts
// packages/lib/src/mail-views/mail-view-service.ts
import { type Database, database as db, schema } from '@auxx/database'
import type { CreateMailViewInput, MailViewEntity, UpdateMailViewInput } from '@auxx/database/types'
import { getRedisClient } from '@auxx/redis'
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { resolveConditionContext } from '../conditions/resolve-context'
import type { ConditionGroup } from '../conditions/types'
import { batchGetThreadTagIds } from '../field-values/relationship-queries'
import { createScopedLogger } from '../logger'
import { buildConditionGroupsQuery } from '../mail-query/condition-query-builder'

const logger = createScopedLogger('mail-view-service')

// Type definitions
type MailViewWithRelations = MailViewEntity

type ThreadWithRelations = {
  id: string
  subject: string
  status: string
  messageCount: number
  participantCount: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  closedAt: string | null
  repliedAt: string | null
  waitingSince: string | null
  createdAt: string
  organizationId: string
  integrationId: string
  assigneeId: string | null
  messageType: string
  type: string
  inboxId: string | null
  externalId: string | null
  participantIds: string[] | null
  metadata: any
  messages: Array<{
    id: string
    subject: string
    threadId: string
    fromId: string
    sentAt: string | null
    textHtml: string | null
    textPlain: string | null
    snippet: string | null
    isInbound: boolean
    messageType: string
    from: {
      id: string
      email: string
      name: string | null
    } | null
  }>
  tags: Array<{
    tag: {
      id: string
      name: string
      color: string | null
      organizationId: string
    } | null
  }>
  labels: Array<{
    label: {
      id: string
      name: string
      color: string | null
      organizationId: string
    } | null
  }>
  assignee: {
    id: string
    name: string | null
    email: string
    image: string | null
  } | null
  inbox: {
    id: string
    name: string
    organizationId: string
  } | null
  participants: Array<{
    id: string
    threadId: string
    email: string
    name: string | null
    isInternal: boolean
    messageCount: number
    firstMessageAt: string
    lastMessageAt: string
  }>
}

type CreateMailViewServiceInput = {
  name: string
  description?: string
  filterGroups: ConditionGroup[]
  isDefault?: boolean
  isPinned?: boolean
  isShared?: boolean
  sortField?: string
  sortDirection?: 'asc' | 'desc'
}

type UpdateMailViewServiceInput = Partial<{
  name: string
  description: string
  filterGroups: ConditionGroup[]
  isDefault: boolean
  isPinned: boolean
  isShared: boolean
  sortField: string
  sortDirection: 'asc' | 'desc'
}>

export class MailViewService {
  private db: Database
  private organizationId: string
  private enableCache: boolean
  private cacheTtl: number // in seconds

  /**
   * Create a new MailViewService instance
   * @param organizationId Organization ID to scope operations to
   * @param database Optional database instance (defaults to singleton)
   * @param options Optional service configuration
   */
  constructor(
    organizationId: string,
    database: Database = db,
    options: { enableCache?: boolean; cacheTtl?: number } = {}
  ) {
    this.db = database
    this.organizationId = organizationId
    this.enableCache = options.enableCache ?? true // Enable by default
    this.cacheTtl = options.cacheTtl ?? 300 // 5 minutes default TTL
  }

  /**
   * Get cache key for user mail views
   * @param userId User ID
   * @returns Cache key string
   */
  private getUserMailViewsCacheKey(userId: string): string {
    return `mailview:user:${userId}:org:${this.organizationId}`
  }

  /**
   * Get cache key for shared mail views
   * @returns Cache key string
   */
  private getSharedMailViewsCacheKey(): string {
    return `mailview:shared:org:${this.organizationId}`
  }

  /**
   * Get cache key for mail view by ID
   * @param mailViewId Mail view ID
   * @returns Cache key string
   */
  private getMailViewCacheKey(mailViewId: string): string {
    return `mailview:${mailViewId}:org:${this.organizationId}`
  }

  /**
   * Get cache key for mail view threads
   * @param mailViewId Mail view ID
   * @param page Page number
   * @param pageSize Page size
   * @returns Cache key string
   */
  private getMailViewThreadsCacheKey(
    mailViewId: string,
    page: number,
    pageSize: number,
    userId?: string
  ): string {
    const suffix = userId ? `:user:${userId}` : ''
    return `mailview:threads:${mailViewId}:page:${page}:size:${pageSize}:org:${this.organizationId}${suffix}`
  }

  /**
   * Try to get data from cache
   * @param key Cache key
   * @returns Cached data or null if not found
   */
  private async getFromCache<T>(key: string): Promise<T | null> {
    if (!this.enableCache) return null

    try {
      const redis = await getRedisClient(false)
      if (!redis) return null

      const cachedData = await redis.get(key)
      if (cachedData) {
        return JSON.parse(cachedData) as T
      }
    } catch (error) {
      logger.warn('Cache retrieval failed', { error, key })
    }

    return null
  }

  /**
   * Set data in cache
   * @param key Cache key
   * @param data Data to cache
   * @returns Success status
   */
  private async setInCache<T>(key: string, data: T): Promise<boolean> {
    if (!this.enableCache) return false

    try {
      const redis = await getRedisClient(false)
      if (!redis) return false

      await redis.set(key, JSON.stringify(data), 'EX', this.cacheTtl)
      return true
    } catch (error) {
      logger.warn('Cache storage failed', { error, key })
      return false
    }
  }

  /**
   * Invalidate all mail view caches for an organization
   */
  async invalidateAllMailViewCaches(): Promise<void> {
    if (!this.enableCache) return

    try {
      const redis = await getRedisClient(false)
      if (!redis) {
        logger.debug('Redis unavailable, skipping cache invalidation')
        return
      }

      const pattern = `mailview:*:org:${this.organizationId}*`

      // Find all keys matching the pattern
      const keys = await redis!.keys(pattern)

      // Delete all matching keys
      if (keys.length > 0) {
        await redis!.del(keys)
        logger.info('Invalidated all mail view caches', {
          organizationId: this.organizationId,
          keyCount: keys.length,
        })
      }
    } catch (error) {
      logger.error('Error invalidating mail view caches', { error })
      // Continue execution even if cache invalidation fails
    }
  }

  /**
   * Invalidate mail view cache for a specific user
   * @param userId User ID
   */
  async invalidateUserMailViewCache(userId: string): Promise<void> {
    if (!this.enableCache) return

    try {
      const redis = await getRedisClient(false)
      if (!redis) {
        logger.debug('Redis unavailable, skipping user cache invalidation')
        return
      }

      const key = this.getUserMailViewsCacheKey(userId)
      await redis.del(key)
      logger.info('Invalidated user mail view cache', { userId })
    } catch (error) {
      logger.error('Error invalidating user mail view cache', { error, userId })
      // Continue execution even if cache invalidation fails
    }
  }

  /**
   * Invalidate threads cache for a specific mail view
   * @param mailViewId Mail view ID
   */
  async invalidateMailViewThreadsCache(mailViewId: string): Promise<void> {
    if (!this.enableCache) return

    try {
      const redis = await getRedisClient(false)
      if (!redis) {
        logger.debug('Redis unavailable, skipping thread cache invalidation')
        return
      }

      const pattern = `mailview:threads:${mailViewId}:*:org:${this.organizationId}`
      const keys = await redis!.keys(pattern)

      if (keys.length > 0) {
        await redis.del(keys)
        logger.info('Invalidated mail view threads cache', { mailViewId })
      }
    } catch (error) {
      logger.error('Error invalidating mail view threads cache', { error, mailViewId })
      // Continue execution even if cache invalidation fails
    }
  }

  /**
   * Create a new mail view
   * @param userId User ID creating the view
   * @param data Mail view creation data
   * @returns The created mail view
   */
  async createMailView(userId: string, data: CreateMailViewServiceInput) {
    try {
      logger.info('Creating new mail view', {
        organizationId: this.organizationId,
        userId,
        name: data.name,
      })

      // If this is set as default, unset any existing defaults
      if (data.isDefault) {
        await this.db
          .update(schema.MailView)
          .set({ isDefault: false })
          .where(
            and(
              eq(schema.MailView.userId, userId),
              eq(schema.MailView.organizationId, this.organizationId),
              eq(schema.MailView.isDefault, true)
            )
          )
      }

      const createData: CreateMailViewInput = {
        organizationId: this.organizationId,
        name: data.name,
        description: data.description,
        // Store filterGroups in the 'filters' jsonb column (backwards compatible)
        filters: data.filterGroups,
        isDefault: data.isDefault ?? false,
        isPinned: data.isPinned ?? false,
        isShared: data.isShared ?? false,
        sortField: data.sortField,
        sortDirection: data.sortDirection ?? 'desc',
        userId,
        updatedAt: new Date(),
      }

      const [mailView] = await this.db.insert(schema.MailView).values(createData).returning()
      if (!mailView) {
        throw new Error('Failed to create mail view')
      }

      // Invalidate caches after successful creation
      await this.invalidateUserMailViewCache(userId)
      if (data.isShared) {
        const redis = await getRedisClient(false)
        if (redis) {
          await redis.del(this.getSharedMailViewsCacheKey())
        }
      }

      return mailView
    } catch (error) {
      logger.error('Error creating mail view', {
        error,
        data,
        organizationId: this.organizationId,
        userId,
      })
      throw error
    }
  }

  /**
   * Get all mail views for a user
   * @param userId User ID
   * @returns Array of mail views
   */
  async getUserMailViews(userId: string) {
    try {
      const cacheKey = this.getUserMailViewsCacheKey(userId)

      // Try to get from cache
      const cachedViews = await this.getFromCache<MailViewWithRelations[]>(cacheKey)
      if (cachedViews) {
        logger.info('Retrieved user mail views from cache', { userId })
        return cachedViews
      }

      logger.info('Fetching user mail views from database', {
        userId,
        organizationId: this.organizationId,
      })

      const mailViews = await this.db
        .select()
        .from(schema.MailView)
        .where(
          and(
            eq(schema.MailView.organizationId, this.organizationId),
            eq(schema.MailView.userId, userId)
          )
        )
        .orderBy(
          desc(schema.MailView.isPinned),
          desc(schema.MailView.isDefault),
          desc(schema.MailView.updatedAt)
        )

      // Store in cache for future requests
      await this.setInCache(cacheKey, mailViews)

      return mailViews
    } catch (error) {
      logger.error('Error fetching user mail views', {
        error,
        userId,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Get shared mail views for the organization
   * @returns Array of shared mail views
   */
  async getSharedMailViews() {
    try {
      const cacheKey = this.getSharedMailViewsCacheKey()

      // Try to get from cache
      const cachedViews = await this.getFromCache<MailViewWithRelations[]>(cacheKey)
      if (cachedViews) {
        logger.info('Retrieved shared mail views from cache')
        return cachedViews
      }

      logger.info('Fetching shared mail views from database', {
        organizationId: this.organizationId,
      })

      const mailViews = await this.db
        .select()
        .from(schema.MailView)
        .where(
          and(
            eq(schema.MailView.organizationId, this.organizationId),
            eq(schema.MailView.isShared, true)
          )
        )
        .orderBy(desc(schema.MailView.isPinned), desc(schema.MailView.updatedAt))

      // Store in cache for future requests
      await this.setInCache(cacheKey, mailViews)

      return mailViews
    } catch (error) {
      logger.error('Error fetching shared mail views', {
        error,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Get all mail views available to a user (personal + shared)
   * @param userId User ID
   * @returns Combined array of mail views
   */
  async getAllUserAccessibleMailViews(userId: string): Promise<MailViewWithRelations[]> {
    try {
      // Get both personal and shared views
      const [personal, shared] = await Promise.all([
        this.getUserMailViews(userId),
        this.getSharedMailViews(),
      ])

      // Combine and sort them
      return [
        // Personal pinned views first
        ...personal!.filter((view) => view.isPinned),
        // Shared pinned views next
        ...shared!.filter((view) => view.isPinned),
        // Personal default view
        ...personal!.filter((view) => view.isDefault && !view.isPinned),
        // Remaining personal views
        ...personal!.filter((view) => !view.isPinned && !view.isDefault),
        // Remaining shared views
        ...shared!.filter((view) => !view.isPinned),
      ]
    } catch (error) {
      logger.error('Error fetching all accessible mail views', {
        error,
        userId,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Get a specific mail view by ID
   * @param mailViewId Mail view ID
   * @returns The mail view or null if not found
   */
  async getMailView(mailViewId: string) {
    try {
      const cacheKey = this.getMailViewCacheKey(mailViewId)

      // Try to get from cache
      const cachedView = await this.getFromCache<MailViewWithRelations>(cacheKey)
      if (cachedView) {
        logger.info('Retrieved mail view from cache', { mailViewId })
        return cachedView
      }

      logger.info('Fetching mail view from database', {
        mailViewId,
        organizationId: this.organizationId,
      })

      const [mailView] = await this.db
        .select()
        .from(schema.MailView)
        .where(
          and(
            eq(schema.MailView.id, mailViewId),
            eq(schema.MailView.organizationId, this.organizationId)
          )
        )
        .limit(1)

      // Only cache if mail view exists
      if (mailView) {
        await this.setInCache(cacheKey, mailView)
      }

      return mailView ?? null
    } catch (error) {
      logger.error('Error fetching mail view', {
        error,
        mailViewId,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Update an existing mail view
   * @param mailViewId Mail view ID
   * @param data Update data
   * @returns The updated mail view
   */
  async updateMailView(mailViewId: string, data: UpdateMailViewServiceInput) {
    try {
      logger.info('Updating mail view', { mailViewId, organizationId: this.organizationId, data })

      // Get the current mail view
      const [currentView] = await this.db
        .select()
        .from(schema.MailView)
        .where(
          and(
            eq(schema.MailView.id, mailViewId),
            eq(schema.MailView.organizationId, this.organizationId)
          )
        )
        .limit(1)
      if (!currentView) {
        throw new Error(`Mail view ${mailViewId} not found`)
      }

      // Check if default status is changing
      if (data.isDefault && !currentView.isDefault) {
        // Unset any existing defaults for this user
        await this.db
          .update(schema.MailView)
          .set({ isDefault: false })
          .where(
            and(
              eq(schema.MailView.userId, currentView.userId),
              eq(schema.MailView.organizationId, this.organizationId),
              eq(schema.MailView.isDefault, true)
            )
          )
      }

      const updateData: UpdateMailViewInput = {}

      // Only include fields that are provided
      if (data.name !== undefined) updateData.name = data.name
      if (data.description !== undefined) updateData.description = data.description
      // Map filterGroups to filters column (backwards compatible)
      if (data.filterGroups !== undefined) updateData.filters = data.filterGroups
      if (data.isDefault !== undefined) updateData.isDefault = data.isDefault
      if (data.isPinned !== undefined) updateData.isPinned = data.isPinned
      if (data.isShared !== undefined) updateData.isShared = data.isShared
      if (data.sortField !== undefined) updateData.sortField = data.sortField
      if (data.sortDirection !== undefined) updateData.sortDirection = data.sortDirection

      const [updatedView] = await this.db
        .update(schema.MailView)
        .set({ ...updateData, updatedAt: new Date() })
        .where(
          and(
            eq(schema.MailView.id, mailViewId),
            eq(schema.MailView.organizationId, this.organizationId)
          )
        )
        .returning()

      // Invalidate relevant caches
      await this.invalidateMailViewCaches(currentView, data)

      return updatedView
    } catch (error) {
      logger.error('Error updating mail view', {
        error,
        mailViewId,
        organizationId: this.organizationId,
        data,
      })
      throw error
    }
  }

  /**
   * Helper to invalidate caches after an update
   * @param currentView Current mail view
   * @param updateData Update data
   */
  private async invalidateMailViewCaches(
    currentView: MailViewEntity,
    updateData: UpdateMailViewServiceInput
  ): Promise<void> {
    const redis = await getRedisClient(false)
    if (!redis) {
      logger.debug('Redis unavailable, skipping cache invalidation')
      return
    }

    // Always invalidate the specific mail view cache
    await redis.del(this.getMailViewCacheKey(currentView.id))

    // Invalidate threads cache for this view
    await this.invalidateMailViewThreadsCache(currentView.id)

    // If user-specific properties changed, invalidate user's view cache
    if (
      updateData.isDefault !== undefined ||
      updateData.isPinned !== undefined ||
      updateData.name !== undefined
    ) {
      await this.invalidateUserMailViewCache(currentView.userId)
    }

    // If sharing changed, invalidate shared views cache
    if (updateData.isShared !== undefined) {
      await redis.del(this.getSharedMailViewsCacheKey())
    }

    // If filterGroups changed, invalidate thread caches
    if (updateData.filterGroups !== undefined) {
      await this.invalidateMailViewThreadsCache(currentView.id)
    }
  }

  /**
   * Delete a mail view
   * @param mailViewId Mail view ID
   * @returns True if successful, throws an error otherwise
   */
  async deleteMailView(mailViewId: string): Promise<boolean> {
    try {
      logger.info('Deleting mail view', { mailViewId, organizationId: this.organizationId })

      // Get the current view for cache invalidation
      const [currentView] = await this.db
        .select()
        .from(schema.MailView)
        .where(
          and(
            eq(schema.MailView.id, mailViewId),
            eq(schema.MailView.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (!currentView) {
        throw new Error(`Mail view ${mailViewId} not found`)
      }

      // Delete the mail view
      await this.db
        .delete(schema.MailView)
        .where(
          and(
            eq(schema.MailView.id, mailViewId),
            eq(schema.MailView.organizationId, this.organizationId)
          )
        )

      // Invalidate caches
      const redis = await getRedisClient(false)
      if (redis) {
        await redis.del(this.getMailViewCacheKey(mailViewId))

        if (currentView.isShared) {
          await redis.del(this.getSharedMailViewsCacheKey())
        }
      }

      await this.invalidateMailViewThreadsCache(mailViewId)
      await this.invalidateUserMailViewCache(currentView.userId)

      return true
    } catch (error) {
      logger.error('Error deleting mail view', {
        error,
        mailViewId,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Get threads that match a mail view
   * @param mailViewId Mail view ID
   * @param pagination Pagination options
   * @returns Object containing threads and total count
   */
  async getThreadsByMailView(
    mailViewId: string,
    pagination: { page: number; pageSize: number },
    userId?: string
  ) {
    try {
      // Validate pagination
      const page = Math.max(1, pagination.page || 1)
      const pageSize = Math.max(1, Math.min(100, pagination.pageSize || 25))

      // Try to get from cache (include userId to isolate currentUser substitutions)
      const cacheKey = this.getMailViewThreadsCacheKey(mailViewId, page, pageSize, userId)
      const cachedResult = await this.getFromCache<{
        threads: ThreadWithRelations[]
        total: number
      }>(cacheKey)

      if (cachedResult) {
        logger.info('Retrieved threads from cache', { mailViewId, page, pageSize })
        return cachedResult
      }

      // Get the mail view definition with filters
      const [mailView] = await this.db
        .select()
        .from(schema.MailView)
        .where(
          and(
            eq(schema.MailView.id, mailViewId),
            eq(schema.MailView.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (!mailView) {
        throw new Error('Mail view not found')
      }

      // Read filterGroups from the 'filters' column (backwards compatible)
      const rawFilterGroups = (mailView.filters as ConditionGroup[]) || []
      const filterGroups = resolveConditionContext(rawFilterGroups, { currentUserId: userId })

      // Build the WHERE condition using the condition query builder
      const whereCondition = buildConditionGroupsQuery(filterGroups, this.organizationId)

      // Count total matches for pagination using Drizzle
      const countResult = await this.db
        .select({ count: count() })
        .from(schema.Thread)
        .where(whereCondition)
      const total = countResult[0]?.count ?? 0

      // Calculate pagination
      const skip = (page - 1) * pageSize

      // Build sort options from mail view preferences
      const sortDirection = mailView.sortDirection || 'desc'

      // Default to lastMessageAt if sortField is not provided or invalid
      let orderByClause
      if (mailView.sortField) {
        // Handle common sort fields
        switch (mailView.sortField) {
          case 'lastMessageAt':
            orderByClause =
              sortDirection === 'asc'
                ? asc(schema.Thread.lastMessageAt)
                : desc(schema.Thread.lastMessageAt)
            break
          case 'createdAt':
            orderByClause =
              sortDirection === 'asc' ? asc(schema.Thread.createdAt) : desc(schema.Thread.createdAt)
            break
          case 'subject':
            orderByClause =
              sortDirection === 'asc' ? asc(schema.Thread.subject) : desc(schema.Thread.subject)
            break
          default:
            orderByClause =
              sortDirection === 'asc'
                ? asc(schema.Thread.lastMessageAt)
                : desc(schema.Thread.lastMessageAt)
        }
      } else {
        orderByClause =
          sortDirection === 'asc'
            ? asc(schema.Thread.lastMessageAt)
            : desc(schema.Thread.lastMessageAt)
      }

      // Step 1: Get base threads with one-to-one relations (assignee)
      const baseThreads = await this.db
        .select({
          thread: schema.Thread,
          assignee: schema.User,
        })
        .from(schema.Thread)
        .leftJoin(schema.User, eq(schema.Thread.assigneeId, schema.User.id))
        .where(whereCondition)
        .orderBy(orderByClause)
        .offset(skip)
        .limit(pageSize)

      if (baseThreads.length === 0) {
        return { threads: [], total }
      }

      const threadIds = baseThreads.map((t) => t.thread.id)

      // Step 2: Get latest messages with sender info for each thread
      // We need to get only the latest message per thread, so we'll use a subquery approach
      const latestMessageIds = await this.db
        .select({
          threadId: schema.Message.threadId,
          messageId: schema.Message.id,
        })
        .from(schema.Message)
        .where(inArray(schema.Message.threadId, threadIds))
        .orderBy(desc(schema.Message.sentAt))

      // Group by threadId to get only the latest message per thread
      const latestMessageByThread = new Map<string, string>()
      for (const msg of latestMessageIds) {
        if (!latestMessageByThread.has(msg.threadId)) {
          latestMessageByThread.set(msg.threadId, msg.messageId)
        }
      }

      const latestMessages =
        latestMessageByThread.size > 0
          ? await this.db
              .select({
                message: schema.Message,
                from: schema.Participant,
              })
              .from(schema.Message)
              .leftJoin(schema.Participant, eq(schema.Message.fromId, schema.Participant.id))
              .where(inArray(schema.Message.id, Array.from(latestMessageByThread.values())))
          : []

      // Step 3: Get thread tags via FieldValue relationship
      const threadTagIdsMap = await batchGetThreadTagIds(this.db, threadIds, this.organizationId)
      const allTagIds = Array.from(new Set(Array.from(threadTagIdsMap.values()).flat()))
      const tagsById = new Map<string, typeof schema.Tag.$inferSelect>()
      if (allTagIds.length > 0) {
        const tagRows = await this.db
          .select()
          .from(schema.Tag)
          .where(inArray(schema.Tag.id, allTagIds))
        for (const tag of tagRows) {
          tagsById.set(tag.id, tag)
        }
      }
      // Convert to the expected format: array of { threadId, tag }
      const threadTags: { threadId: string; tag: typeof schema.Tag.$inferSelect | null }[] = []
      for (const [threadId, tagIds] of threadTagIdsMap) {
        for (const tagId of tagIds) {
          threadTags.push({ threadId, tag: tagsById.get(tagId) ?? null })
        }
      }

      // Step 4: Get thread labels
      const threadLabels = await this.db
        .select({
          threadId: schema.LabelsOnThread.threadId,
          label: schema.Label,
        })
        .from(schema.LabelsOnThread)
        .leftJoin(schema.Label, eq(schema.LabelsOnThread.labelId, schema.Label.id))
        .where(inArray(schema.LabelsOnThread.threadId, threadIds))

      // Step 5: Get thread participants
      const threadParticipants = await this.db
        .select()
        .from(schema.ThreadParticipant)
        .where(inArray(schema.ThreadParticipant.threadId, threadIds))

      // Step 6: Transform data into the expected nested structure
      const threads = baseThreads.map((row) => {
        const thread = row.thread
        const threadId = thread.id

        // Get latest message for this thread
        const latestMessage = latestMessages.find((m) => m.message.threadId === threadId)
        const messages = latestMessage
          ? [{ ...latestMessage.message, from: latestMessage.from }]
          : []

        // Get tags for this thread
        const tags = threadTags.filter((t) => t.threadId === threadId).map((t) => ({ tag: t.tag }))

        // Get labels for this thread
        const labels = threadLabels
          .filter((l) => l.threadId === threadId)
          .map((l) => ({ label: l.label }))

        // Get participants for this thread
        const participants = threadParticipants.filter((p) => p.threadId === threadId)

        return {
          ...thread,
          messages,
          tags,
          labels,
          assignee: row.assignee,
          // inbox: row.inbox,
          participants,
        }
      })

      const result = { threads, total }

      // Cache the result
      await this.setInCache(cacheKey, result)

      return result
    } catch (error) {
      logger.error('Error getting threads by mail view', {
        error,
        mailViewId,
        pagination,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Set a mail view as default for a user
   * @param mailViewId Mail view ID
   * @param userId User ID
   * @returns The updated mail view
   */
  async setMailViewAsDefault(mailViewId: string, userId: string): Promise<MailViewWithRelations> {
    try {
      logger.info('Setting mail view as default', {
        mailViewId,
        userId,
        organizationId: this.organizationId,
      })

      await this.db.transaction(async (tx) => {
        // Unset any existing defaults for this user
        await tx
          .update(schema.MailView)
          .set({ isDefault: false })
          .where(
            and(
              eq(schema.MailView.userId, userId),
              eq(schema.MailView.organizationId, this.organizationId),
              eq(schema.MailView.isDefault, true)
            )
          )

        // Set this view as default
        await tx
          .update(schema.MailView)
          .set({ isDefault: true })
          .where(
            and(
              eq(schema.MailView.id, mailViewId),
              eq(schema.MailView.organizationId, this.organizationId)
            )
          )
      })

      // Invalidate user's views cache
      await this.invalidateUserMailViewCache(userId)

      // Return the updated view
      const updatedView = await this.getMailView(mailViewId)
      if (!updatedView) {
        throw new Error(`Mail view ${mailViewId} not found`)
      }

      return updatedView
    } catch (error) {
      logger.error('Error setting mail view as default', {
        error,
        mailViewId,
        userId,
        organizationId: this.organizationId,
      })
      throw error
    }
  }

  /**
   * Toggle pinned status of a mail view
   * @param mailViewId Mail view ID
   * @returns The updated mail view
   */
  async toggleMailViewPinned(mailViewId: string) {
    try {
      // Get current view
      const [currentView] = await this.db
        .select()
        .from(schema.MailView)
        .where(
          and(
            eq(schema.MailView.id, mailViewId),
            eq(schema.MailView.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (!currentView) {
        throw new Error(`Mail view ${mailViewId} not found`)
      }

      // Toggle pinned status
      const [updatedView] = await this.db
        .update(schema.MailView)
        .set({ isPinned: !currentView.isPinned, updatedAt: new Date() })
        .where(
          and(
            eq(schema.MailView.id, mailViewId),
            eq(schema.MailView.organizationId, this.organizationId)
          )
        )
        .returning()

      // Invalidate caches
      const redis = await getRedisClient(false)
      if (redis) {
        await redis.del(this.getMailViewCacheKey(mailViewId))

        if (currentView.isShared) {
          await redis.del(this.getSharedMailViewsCacheKey())
        }
      }

      await this.invalidateUserMailViewCache(currentView.userId)

      return updatedView
    } catch (error) {
      logger.error('Error toggling mail view pinned status', {
        error,
        mailViewId,
        organizationId: this.organizationId,
      })
      throw error
    }
  }
}
