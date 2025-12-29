// packages/lib/src/threads/thread-query.service.ts

import { type Database, schema } from '@auxx/database'
import { DraftMode } from '@auxx/database/enums'
import {
  and,
  eq,
  gt,
  lt,
  count,
  desc,
  asc,
  inArray,
  or,
  sql,
  type SQL,
  type Column,
} from 'drizzle-orm'
import { MailQueryBuilder, type MailQueryInput } from '../mail-query/mail-query-builder'
import { InternalFilterContextType } from '../mail-query/types'
import { MailViewService } from '../mail-views/mail-view-service'
import { createScopedLogger } from '@auxx/logger'
import { type MailViewFilter } from '../mail-query/types'
import { parseSearchQuery } from '../mail-query/search-query-parser'
import { MessageAttachmentService } from '../messages/message-attachment.service'
import { spliceAttachmentsIntoMessages } from '../messages/attachment-transformers'

import {
  type ThreadListItem,
  type DraftMessageType,
  type ThreadWithDetails,
  type ListThreadsInput,
  type PaginatedThreadsResult,
  type ThreadSortDescriptor,
  type ThreadSortField,
  type ThreadMessageSummary,
  type ThreadCommentSummary,
  type ThreadTagSummary,
  type ThreadParticipantSummary,
  type ThreadActorSummary,
} from './types'
const logger = createScopedLogger('thread-query-service')

/** Default ordering used when no explicit sort is requested. */
const DEFAULT_SORT: ThreadSortDescriptor = {
  field: 'lastMessageAt',
  direction: 'desc',
}

type EncodedCursorPayload = {
  field: ThreadSortField
  direction: 'asc' | 'desc'
  id: string
  value: string | null
}

type DecodedCursorPayload = EncodedCursorPayload

/**
 * Service for thread read operations (queries)
 * Handles all thread list and detail fetching logic
 */
export class ThreadQueryService {
  private db: Database
  private mailViewService: MailViewService
  private readonly organizationId: string

  constructor(organizationId: string, db: Database) {
    this.db = db
    this.organizationId = organizationId
    this.mailViewService = new MailViewService(this.organizationId, db)
  }

  private buildSenderSortExpression(): SQL {
    return sql`
      lower(
        coalesce(
          (
            select tp."name"
            from "ThreadParticipant" tp
            where tp."threadId" = ${schema.Thread.id}
              and tp."isInternal" = false
            order by tp."lastMessageAt" desc
            limit 1
          ),
          (
            select tp."email"
            from "ThreadParticipant" tp
            where tp."threadId" = ${schema.Thread.id}
              and tp."isInternal" = false
            order by tp."lastMessageAt" desc
            limit 1
          ),
          ''
        )
      )
    `
  }

  /** Chooses the active sort descriptor, preferring user input and then fallback defaults. */
  private resolveSortDescriptor(
    sort?: ThreadSortDescriptor,
    fallback?: ThreadSortDescriptor
  ): ThreadSortDescriptor {
    if (sort) {
      return sort
    }
    if (fallback) {
      return fallback
    }
    return DEFAULT_SORT
  }

  /** Returns Drizzle-compatible orderBy expressions for the provided sort descriptor. */
  private createOrderByFromDescriptor(sort: ThreadSortDescriptor): SQL[] {
    const tieBreaker = sort.direction === 'asc' ? asc(schema.Thread.id) : desc(schema.Thread.id)

    if (sort.field === 'subject') {
      const subjectOrder =
        sort.direction === 'asc' ? asc(schema.Thread.subject) : desc(schema.Thread.subject)
      return [subjectOrder, tieBreaker]
    }

    if (sort.field === 'sender') {
      const senderDisplay = this.buildSenderSortExpression()
      const senderOrder = sort.direction === 'asc' ? asc(senderDisplay) : desc(senderDisplay)
      return [senderOrder, tieBreaker]
    }

    const lastMessageOrder =
      sort.direction === 'asc'
        ? asc(schema.Thread.lastMessageAt)
        : desc(schema.Thread.lastMessageAt)
    return [lastMessageOrder, tieBreaker]
  }

  /** Normalizes mail-view persisted sort values into the shared descriptor format. */
  private normalizeMailViewSort(
    field?: string | null,
    direction?: string | null
  ): ThreadSortDescriptor | undefined {
    if (!field || !direction) {
      return undefined
    }

    const normalizedDirection =
      direction === 'asc' ? 'asc' : direction === 'desc' ? 'desc' : undefined
    if (!normalizedDirection) {
      return undefined
    }

    if (field === 'newest') {
      return { field: 'lastMessageAt', direction: 'desc' }
    }
    if (field === 'oldest') {
      return { field: 'lastMessageAt', direction: 'asc' }
    }
    if (field === 'subject') {
      return { field: 'subject', direction: normalizedDirection }
    }
    if (field === 'sender') {
      return { field: 'sender', direction: normalizedDirection }
    }
    if (field === 'lastMessageAt') {
      return { field: 'lastMessageAt', direction: normalizedDirection }
    }

    return undefined
  }

  private getSortValueSelection(sort: ThreadSortDescriptor): Column {
    if (sort.field === 'subject') {
      return schema.Thread.subject
    }
    if (sort.field === 'sender') {
      return this.buildSenderSortExpression()
    }
    return schema.Thread.lastMessageAt
  }

  private serializeSortValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null
    }
    if (value instanceof Date) {
      return value.toISOString()
    }
    if (typeof value === 'string') {
      return value
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return value.toString()
    }
    return String(value)
  }

  private toBase64Url(input: string): string {
    return Buffer.from(input, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  private fromBase64Url(input: string): string {
    let normalized = input.replace(/-/g, '+').replace(/_/g, '/')
    while (normalized.length % 4) {
      normalized += '='
    }
    return Buffer.from(normalized, 'base64').toString('utf8')
  }

  private encodeCursor(
    sort: ThreadSortDescriptor,
    row: { id: string; sortValue: unknown }
  ): string {
    const payload: EncodedCursorPayload = {
      field: sort.field,
      direction: sort.direction,
      id: row.id,
      value: this.serializeSortValue(row.sortValue),
    }
    const encoded = this.toBase64Url(JSON.stringify(payload))
    return `v1:${encoded}`
  }

  private decodeCursor(cursor: string | null | undefined): DecodedCursorPayload | null {
    if (!cursor) {
      return null
    }
    if (cursor.startsWith('v1:')) {
      const raw = cursor.slice(3)
      try {
        const json = this.fromBase64Url(raw)
        const data = JSON.parse(json)
        if (
          data &&
          typeof data.id === 'string' &&
          (data.field === 'lastMessageAt' || data.field === 'subject' || data.field === 'sender') &&
          (data.direction === 'asc' || data.direction === 'desc')
        ) {
          return {
            field: data.field,
            direction: data.direction,
            id: data.id,
            value:
              typeof data.value === 'string' || data.value === null
                ? data.value
                : String(data.value),
          }
        }
      } catch (error) {
        logger.warn('Failed to decode cursor payload', {
          organizationId: this.organizationId,
          error: error instanceof Error ? error.message : error,
        })
        return null
      }
      return null
    }
    return null
  }

  private buildCursorCondition(
    sort: ThreadSortDescriptor,
    payload: EncodedCursorPayload
  ): SQL | undefined {
    const tieCondition =
      sort.direction === 'desc'
        ? lt(schema.Thread.id, payload.id)
        : gt(schema.Thread.id, payload.id)

    switch (sort.field) {
      case 'lastMessageAt': {
        const timestampValue = this.parseCursorTimestamp(payload.value)
        if (!timestampValue) {
          return tieCondition
        }
        const sortComparison =
          sort.direction === 'desc'
            ? lt(schema.Thread.lastMessageAt, timestampValue)
            : gt(schema.Thread.lastMessageAt, timestampValue)
        const equality = eq(schema.Thread.lastMessageAt, timestampValue)
        return or(sortComparison, and(equality, tieCondition))
      }
      case 'subject': {
        const subjectValue = payload.value ?? ''
        const sortComparison =
          sort.direction === 'desc'
            ? lt(schema.Thread.subject, subjectValue)
            : gt(schema.Thread.subject, subjectValue)
        const equality = eq(schema.Thread.subject, subjectValue)
        return or(sortComparison, and(equality, tieCondition))
      }
      case 'sender': {
        if (!payload.value) {
          return tieCondition
        }
        const senderExpr = this.buildSenderSortExpression()
        const sortComparison =
          sort.direction === 'desc'
            ? sql`${senderExpr} < ${payload.value}`
            : sql`${senderExpr} > ${payload.value}`
        const equality = sql`${senderExpr} = ${payload.value}`
        return or(sortComparison, and(equality, tieCondition))
      }
      default:
        return undefined
    }
  }

  /**
   * Converts cursor payload timestamp strings back into Date objects for Drizzle comparisons.
   */
  private parseCursorTimestamp(value: string | null): Date | null {
    if (!value) {
      return null
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      logger.warn('Received invalid timestamp value in cursor payload', {
        organizationId: this.organizationId,
        value,
      })
      return null
    }

    return parsed
  }

  /**
   * Prepares the shared MailQueryBuilder input along with optional MailView sort overrides.
   */
  private async prepareQueryContext(input: ListThreadsInput): Promise<{
    queryBuilderInput: MailQueryInput
    mailViewSort?: ThreadSortDescriptor
  }> {
    const { userId, context, statusFilter, searchQuery } = input
    const queryBuilderInput: MailQueryInput = {
      organizationId: this.organizationId,
      userId,
      contextType: context.type,
      contextId: 'id' in context ? context.id : undefined,
      statusFilter,
      searchQuery,
    }

    if (searchQuery && searchQuery.trim()) {
      const parsedSearch = parseSearchQuery(searchQuery)
      queryBuilderInput.parsedSearch = parsedSearch
      logger.debug('Parsed search query', {
        hasStructured: parsedSearch.hasStructuredQuery,
        tokenCount: parsedSearch.tokens.length,
      })
    }

    let mailViewSort: ThreadSortDescriptor | undefined

    try {
      if (context.type === InternalFilterContextType.SPECIFIC_INBOX && 'id' in context) {
        // No-op: handled entirely through queryBuilderInput
      } else if (context.type === InternalFilterContextType.VIEW && 'id' in context) {
        const mailView = await this.mailViewService.getMailView(context.id)
        if (!mailView) throw new Error(`MailView with ID ${context.id} not found.`)

        if (
          mailView.filters &&
          typeof mailView.filters === 'object' &&
          mailView.filters !== null &&
          'operator' in mailView.filters &&
          'conditions' in mailView.filters
        ) {
          queryBuilderInput.mailViewFilter = mailView.filters as unknown as MailViewFilter
          logger.info('Applying MailView filters', { viewId: context.id })
        } else {
          logger.warn('MailView found but has invalid or no filters defined', {
            viewId: context.id,
          })
        }

        if (mailView.sortField && mailView.sortDirection) {
          mailViewSort = this.normalizeMailViewSort(mailView.sortField, mailView.sortDirection)
          if (mailViewSort) {
            logger.info('Using sort order from MailView', {
              viewId: context.id,
              field: mailView.sortField,
              dir: mailView.sortDirection,
            })
          }
        }
      }
    } catch (error: unknown) {
      logger.error('Failed to fetch auxiliary data for listThreads', {
        context,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Failed to prepare thread list query: ${error instanceof Error ? error.message : error}`
      )
    }

    return { queryBuilderInput, mailViewSort }
  }

  /**
   * Fetches a paginated list of threads based on combined filter criteria
   */
  async listThreads(
    input: ListThreadsInput,
    pagination: { limit: number; cursor?: string | null }
  ): Promise<PaginatedThreadsResult> {
    const { limit, cursor } = pagination
    const { userId, context, statusFilter, searchQuery } = input

    logger.info('Listing threads', {
      organizationId: this.organizationId,
      userId,
      context,
      statusFilter,
      searchQuery,
    })

    const { queryBuilderInput, mailViewSort } = await this.prepareQueryContext(input)
    const queryBuilder = new MailQueryBuilder(queryBuilderInput)
    const mailQueryWhere = queryBuilder.buildWhereCondition()

    const resolvedSort = this.resolveSortDescriptor(input.sort, mailViewSort)
    logger.debug('Resolved thread list sort', {
      organizationId: this.organizationId,
      sort: resolvedSort,
    })
    const orderByExpressions = this.createOrderByFromDescriptor(resolvedSort)

    try {
      // Phase 1: Get thread IDs (preserving order)
      const { orderedThreadIds, nextCursor } = await this.getThreadIds(mailQueryWhere, pagination, {
        orderBy: orderByExpressions,
        sort: resolvedSort,
      })

      if (orderedThreadIds.length === 0) {
        return { items: [], nextCursor: null }
      }

      // Phase 2: Fetch relations in parallel
      const { threadsUnordered, latestMessages, latestComments, tags, readStatus } =
        await this.fetchThreadRelations(orderedThreadIds, input)

      // Phase 3: Assemble in original order
      const items = this.assembleThreadListItems(
        orderedThreadIds,
        threadsUnordered,
        latestMessages,
        latestComments,
        tags,
        readStatus,
        input.userId
      )

      return { items, nextCursor }
    } catch (error: unknown) {
      logger.error('Database query failed when listing threads', {
        error: this.formatError(error),
      })
      const wrappedError = new Error(
        `Database error fetching threads: ${error instanceof Error ? error.message : String(error)}`
      ) as Error & { cause?: unknown }
      wrappedError.cause = error
      throw wrappedError
    }
  }

  /**
   * Fetches a single thread by its ID, including detailed information
   */
  async getThreadById(
    threadId: string,
    userId?: string,
    _options?: { include?: any }
  ): Promise<ThreadWithDetails | null> {
    logger.debug(`Fetching thread detail`, { threadId, organizationId: this.organizationId })

    try {
      const thread = await this.db.query.Thread.findFirst({
        where: (threads, { eq, and }) =>
          and(eq(threads.id, threadId), eq(threads.organizationId, this.organizationId)),
        with: {
          labels: {
            with: {
              label: true,
            },
          },
          tags: {
            with: {
              tag: true,
            },
          },
          assignee: true,
          // Note: inbox relation removed - Thread.inboxId was removed in migration 0028
          integration: true, // Added to support provider-based type derivation
          messages: {
            where: (messages, { eq, or, and }) =>
              userId
                ? or(
                    eq(messages.draftMode, DraftMode.NONE),
                    and(eq(messages.draftMode, DraftMode.PRIVATE), eq(messages.createdById, userId))
                  )
                : eq(messages.draftMode, DraftMode.NONE),
            orderBy: (messages, { asc }) => [
              asc(messages.sentAt),
              asc(messages.lastAttemptAt),
              asc(messages.createdAt),
            ],
            with: {
              participants: {
                orderBy: (participants, { asc }) => [asc(participants.role)],
                with: {
                  participant: {
                    with: {
                      contact: true,
                    },
                  },
                },
              },
              from: true,
              replyTo: true,
              signature: true,
            },
          },
          comments: {
            where: (comments, { isNull }) => isNull(comments.deletedAt),
            orderBy: (comments, { asc }) => [asc(comments.createdAt)],
            with: {
              createdBy: true,
              mentions: {
                with: {
                  user: true,
                },
              },
              reactions: {
                with: {
                  user: true,
                },
              },
            },
          },
          ...(userId && {
            readStatusEntries: {
              where: (entries, { eq }) => eq(entries.userId, userId),
              limit: 1,
            },
          }),
        },
      })

      if (!thread) {
        return null
      }

      // Separate Draft from Sent Messages
      let userDraftMessage: DraftMessageType | null = null
      const sentMessages: DraftMessageType[] = []

      if (thread.messages) {
        for (const msg of thread.messages) {
          if (msg.draftMode === DraftMode.PRIVATE && msg.createdById === userId) {
            userDraftMessage = { ...msg, attachments: [] } as DraftMessageType
          } else if (msg.draftMode === DraftMode.NONE) {
            sentMessages.push({ ...msg, attachments: [] } as DraftMessageType)
          }
        }
        sentMessages.sort((a, b) => {
          const aTime = (a.sentAt ?? a.lastAttemptAt ?? a.createdAt).getTime()
          const bTime = (b.sentAt ?? b.lastAttemptAt ?? b.createdAt).getTime()
          return aTime - bTime
        })
      }

      // Determine isUnread status
      let isUnread: boolean | null = userId ? true : null
      if (userId && thread.readStatusEntries) {
        const userStatus = thread.readStatusEntries[0]
        const lastMessageTime = thread.lastMessageAt ?? thread.firstMessageAt

        isUnread =
          !userStatus ||
          !userStatus.isRead ||
          Boolean(
            userStatus.lastReadAt &&
              lastMessageTime &&
              new Date(lastMessageTime) > new Date(userStatus.lastReadAt)
          )
      }

      const { messages, readStatusEntries, ...restOfThread } = thread

      // Load attachments for all messages (sent messages + draft message)
      const allMessages = [...sentMessages]
      if (userDraftMessage) {
        allMessages.push(userDraftMessage)
      }

      let messagesWithAttachments = sentMessages
      let draftWithAttachments = userDraftMessage

      if (allMessages.length > 0) {
        // For now, we'll create a temporary MessageAttachmentService
        // In a real implementation, this might be passed in or created differently to avoid userId dependency
        const tempUserId = userId || 'system' // Fallback for when userId is not provided
        const messageAttachmentService = new MessageAttachmentService(
          this.organizationId,
          tempUserId,
          this.db
        )

        const messageIds = allMessages.map((msg) => msg.id)
        const attachmentMap = await messageAttachmentService.fetchAttachmentsForMessages(messageIds)

        // Splice attachments into sent messages
        messagesWithAttachments = spliceAttachmentsIntoMessages(sentMessages, attachmentMap)

        // Splice attachments into draft message if it exists
        if (userDraftMessage) {
          const draftWithAttachmentsArray = spliceAttachmentsIntoMessages(
            [userDraftMessage],
            attachmentMap
          )
          draftWithAttachments = draftWithAttachmentsArray[0] || userDraftMessage
        }
      }

      const finalThread: ThreadWithDetails = {
        ...restOfThread,
        messages: messagesWithAttachments,
        isUnread: isUnread ?? undefined,
        draftMessage: draftWithAttachments,
      }

      return finalThread
    } catch (error: unknown) {
      logger.error('Failed to get thread by ID', {
        threadId,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error fetching thread ${threadId}: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Get thread statistics for an organization
   */
  async getThreadStats(organizationId?: string): Promise<{
    total: number
    open: number
    archived: number
    spam: number
    trash: number
  }> {
    const orgId = organizationId || this.organizationId

    logger.debug('Getting thread stats', { organizationId: orgId })

    try {
      const [total, open, archived, spam, trash] = await Promise.all([
        this.db
          .select({ count: count() })
          .from(schema.Thread)
          .where(eq(schema.Thread.organizationId, orgId))
          .then((result) => result[0]?.count || 0),
        this.db
          .select({ count: count() })
          .from(schema.Thread)
          .where(and(eq(schema.Thread.organizationId, orgId), eq(schema.Thread.status, 'OPEN')))
          .then((result) => result[0]?.count || 0),
        this.db
          .select({ count: count() })
          .from(schema.Thread)
          .where(and(eq(schema.Thread.organizationId, orgId), eq(schema.Thread.status, 'ARCHIVED')))
          .then((result) => result[0]?.count || 0),
        this.db
          .select({ count: count() })
          .from(schema.Thread)
          .where(and(eq(schema.Thread.organizationId, orgId), eq(schema.Thread.status, 'SPAM')))
          .then((result) => result[0]?.count || 0),
        this.db
          .select({ count: count() })
          .from(schema.Thread)
          .where(and(eq(schema.Thread.organizationId, orgId), eq(schema.Thread.status, 'TRASH')))
          .then((result) => result[0]?.count || 0),
      ])

      return { total, open, archived, spam, trash }
    } catch (error: unknown) {
      logger.error('Failed to get thread stats', {
        organizationId: orgId,
        error: error instanceof Error ? error.message : error,
      })
      throw new Error(
        `Database error getting thread stats: ${error instanceof Error ? error.message : error}`
      )
    }
  }

  /**
   * Search threads with advanced search capabilities
   */
  async searchThreads(
    query: string,
    filters?: {
      userId?: string
      inboxId?: string
      status?: string[]
      assigneeId?: string
      tagIds?: string[]
      dateFrom?: Date
      dateTo?: Date
    },
    pagination?: { limit?: number; cursor?: string | null }
  ): Promise<PaginatedThreadsResult> {
    const { limit = 50, cursor } = pagination || {}

    logger.info('Searching threads', {
      query,
      filters,
      organizationId: this.organizationId,
    })

    // Build search input for listThreads
    const searchInput: ListThreadsInput = {
      userId: filters?.userId,
      context: { type: InternalFilterContextType.ALL },
      searchQuery: query,
    }

    // Apply additional filters through the search query
    let enhancedQuery = query
    if (filters?.assigneeId) {
      enhancedQuery += ` assignee:${filters.assigneeId}`
    }
    if (filters?.inboxId) {
      enhancedQuery += ` inbox:${filters.inboxId}`
    }
    if (filters?.status && filters.status.length > 0) {
      enhancedQuery += ` status:${filters.status.join(',')}`
    }

    return this.listThreads({ ...searchInput, searchQuery: enhancedQuery }, { limit, cursor })
  }

  /**
   * PHASE 1: Get thread IDs in order
   * Fetches only thread IDs and pagination metadata in a lightweight query
   */
  private async getThreadIds(
    whereCondition: SQL | undefined,
    pagination: { limit: number; cursor?: string | null },
    options: { orderBy?: SQL[]; sort: ThreadSortDescriptor }
  ): Promise<{ orderedThreadIds: string[]; nextCursor: string | null }> {
    const { limit, cursor } = pagination
    const { orderBy = this.createOrderByFromDescriptor(options.sort), sort } = options

    let finalWhereCondition = whereCondition
    const decodedCursor = this.decodeCursor(cursor)

    if (decodedCursor) {
      if (decodedCursor.field === sort.field && decodedCursor.direction === sort.direction) {
        const cursorCondition = this.buildCursorCondition(sort, decodedCursor)
        if (cursorCondition) {
          finalWhereCondition = finalWhereCondition
            ? and(finalWhereCondition, cursorCondition)
            : cursorCondition
        }
      } else {
        logger.warn('Ignoring cursor with mismatched sort descriptor', {
          organizationId: this.organizationId,
          cursorField: decodedCursor.field,
          cursorDirection: decodedCursor.direction,
          activeSortField: sort.field,
          activeSortDirection: sort.direction,
        })
      }
    }

    // Note: Integration JOIN is added automatically by Drizzle when using
    // whereThreadMessageType/whereThreadProvider helpers in the WHERE clause
    let query = this.db
      .select({
        id: schema.Thread.id,
        lastMessageAt: schema.Thread.lastMessageAt,
        sortValue: this.getSortValueSelection(sort),
      })
      .from(schema.Thread)

    if (finalWhereCondition) {
      query = query.where(finalWhereCondition)
    }

    const orderByExpressions = orderBy.length > 0 ? orderBy : this.createOrderByFromDescriptor(sort)
    const finalQuery =
      orderByExpressions.length > 0
        ? query.orderBy(...orderByExpressions)
        : query.orderBy(desc(schema.Thread.lastMessageAt))

    const threadRows = await finalQuery.limit(limit + 1)

    let nextCursor: string | null = null
    if (threadRows.length > limit) {
      const nextItem = threadRows.pop()
      if (nextItem) {
        nextCursor = this.encodeCursor(sort, nextItem)
      }
    }

    const orderedThreadIds = threadRows.map((row) => row.id)

    return { orderedThreadIds, nextCursor }
  }

  /**
   * PHASE 2: Fetch thread relations in parallel
   * Fetches all related data for the given thread IDs
   */
  private async fetchThreadRelations(
    orderedThreadIds: string[],
    input: ListThreadsInput
  ): Promise<{
    threadsUnordered: any[]
    latestMessages: any[]
    latestComments: any[]
    tags: any[]
    readStatus: any[]
  }> {
    const { userId, context } = input

    if (orderedThreadIds.length === 0) {
      return {
        threadsUnordered: [],
        latestMessages: [],
        latestComments: [],
        tags: [],
        readStatus: [],
      }
    }

    try {
      // Execute all queries in parallel for maximum performance
      const [threadsUnordered, latestMessages, latestComments, tags, readStatus] =
        await Promise.all([
          // Fetch threads with basic relations (unordered)
          this.db.query.Thread.findMany({
            where: inArray(schema.Thread.id, orderedThreadIds),
            with: {
              assignee: true,
              // Note: inbox relation removed - Thread.inboxId was removed in migration 0028
              integration: true, // Added to support provider-based type derivation
            },
          }),

          this.fetchLatestMessagesForThreads(orderedThreadIds, input),

          this.fetchLatestCommentsForThreads(orderedThreadIds),

          // Fetch tags
          this.db.query.TagsOnThread.findMany({
            where: inArray(schema.TagsOnThread.threadId, orderedThreadIds),
            with: {
              tag: true,
            },
          }),

          // Fetch read status if userId provided
          userId
            ? this.db.query.ThreadReadStatus.findMany({
                where: and(
                  inArray(schema.ThreadReadStatus.threadId, orderedThreadIds),
                  eq(schema.ThreadReadStatus.userId, userId)
                ),
              })
            : Promise.resolve([]),
        ])

      return {
        threadsUnordered,
        latestMessages,
        latestComments,
        tags,
        readStatus,
      }
    } catch (error: unknown) {
      logger.error('Failed to fetch thread relations', {
        threadCount: orderedThreadIds.length,
        contextType: context.type,
        error: this.formatError(error),
      })
      throw error
    }
  }

  /**
   * Normalizes errors for consistent structured logging.
   */
  private formatError(error: unknown): Record<string, unknown> | unknown {
    if (error instanceof Error) {
      const serialized: Record<string, unknown> = {
        message: error.message,
        name: error.name,
      }

      if (error.stack) {
        serialized.stack = error.stack
      }

      const possibleCause = (error as Error & { cause?: unknown }).cause
      if (possibleCause) {
        serialized.cause =
          possibleCause instanceof Error
            ? {
                message: possibleCause.message,
                name: possibleCause.name,
                stack: possibleCause.stack,
              }
            : possibleCause
      }

      const pgLikeError = error as Error & {
        code?: string
        severity?: string
        detail?: string
        schema?: string
        table?: string
        column?: string
      }

      if (pgLikeError.code) serialized.code = pgLikeError.code
      if (pgLikeError.severity) serialized.severity = pgLikeError.severity
      if (pgLikeError.detail) serialized.detail = pgLikeError.detail
      if (pgLikeError.schema) serialized.schema = pgLikeError.schema
      if (pgLikeError.table) serialized.table = pgLikeError.table
      if (pgLikeError.column) serialized.column = pgLikeError.column

      return serialized
    }

    return error
  }

  /**
   * Builds SQL filter fragments needed to pick the latest message per thread safely.
   */
  private buildLatestMessageFilters(
    orderedThreadIds: string[],
    context: ListThreadsInput['context'],
    userId?: string
  ): SQL[] {
    const filters: SQL[] = []

    if (orderedThreadIds.length === 0) {
      return filters
    }

    filters.push(inArray(schema.Message.threadId, orderedThreadIds))

    switch (context.type) {
      case InternalFilterContextType.DRAFTS: {
        if (!userId) {
          throw new Error('userId is required when resolving draft messages')
        }

        filters.push(eq(schema.Message.createdById, userId))
        filters.push(inArray(schema.Message.draftMode, [DraftMode.PRIVATE, DraftMode.SHARED]))
        break
      }

      case InternalFilterContextType.SENT: {
        if (!userId) {
          throw new Error('userId is required when resolving sent messages')
        }

        filters.push(eq(schema.Message.createdById, userId))
        filters.push(eq(schema.Message.draftMode, DraftMode.NONE))
        filters.push(eq(schema.Message.isInbound, false))
        break
      }

      default: {
        filters.push(eq(schema.Message.draftMode, DraftMode.NONE))
        break
      }
    }

    return filters
  }

  /**
   * Fetches the latest message for every thread using deterministic ordering.
   */
  private async fetchLatestMessagesForThreads(
    orderedThreadIds: string[],
    input: ListThreadsInput
  ): Promise<any[]> {
    const filters = this.buildLatestMessageFilters(orderedThreadIds, input.context, input.userId)

    if (filters.length === 0) {
      return []
    }

    const whereClause = filters.length === 1 ? filters[0] : and(...filters)
    const timestampOrdering = sql`COALESCE(${schema.Message.sentAt}, ${schema.Message.lastAttemptAt}, ${schema.Message.createdAt})`

    // Step 1: Resolve the latest message IDs per thread using DISTINCT ON for determinism.
    let latestMessagePointers: Array<{ threadId: string; messageId: string }> = []

    try {
      const pointerResult = await this.db.execute(sql`
        SELECT DISTINCT ON (${schema.Message.threadId})
          ${schema.Message.threadId} AS "threadId",
          ${schema.Message.id} AS "messageId"
        FROM ${schema.Message}
        WHERE ${whereClause}
        ORDER BY ${schema.Message.threadId}, ${timestampOrdering} DESC
      `)

      latestMessagePointers =
        (pointerResult as unknown as { rows?: Array<{ threadId: string; messageId: string }> })
          .rows || []
    } catch (error: unknown) {
      logger.error('Failed to resolve latest message pointers for threads', {
        threadCount: orderedThreadIds.length,
        contextType: input.context.type,
        error: this.formatError(error),
      })
      throw error
    }

    if (latestMessagePointers.length === 0) {
      return []
    }

    const uniqueMessageIds = Array.from(new Set(latestMessagePointers.map((row) => row.messageId)))
    const pointerMap = new Map(latestMessagePointers.map((row) => [row.threadId, row.messageId]))

    let messages: any[] = []

    try {
      messages = await this.db.query.Message.findMany({
        where: inArray(schema.Message.id, uniqueMessageIds),
        columns: {
          id: true,
          subject: true,
          snippet: true,
          textHtml: true,
          textPlain: true,
          sentAt: true,
          lastAttemptAt: true,
          createdAt: true,
          isInbound: true,
          organizationId: true,
          isReply: true,
        },
        with: {
          from: {
            columns: {
              id: true,
              name: true,
              displayName: true,
              identifier: true,
            },
            with: {
              contact: {
                columns: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          replyTo: {
            columns: {
              id: true,
              name: true,
              displayName: true,
              identifier: true,
            },
            with: {
              contact: {
                columns: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          participants: {
            columns: {
              role: true,
            },
            with: {
              participant: {
                columns: {
                  id: true,
                  name: true,
                  displayName: true,
                  identifier: true,
                },
                with: {
                  contact: {
                    columns: {
                      id: true,
                      firstName: true,
                      lastName: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
    } catch (error: unknown) {
      logger.error('Failed to fetch latest message records', {
        messageIdCount: uniqueMessageIds.length,
        error: this.formatError(error),
      })
      throw error
    }

    const messagesById = new Map(messages.map((message) => [message.id, message]))
    const latestMessages: any[] = []

    for (const [threadId, messageId] of pointerMap.entries()) {
      const message = messagesById.get(messageId)
      if (message) {
        // Normalize threadId to ensure downstream Map construction works as expected
        message.threadId = message.threadId ?? threadId
        latestMessages.push(message)
      }
    }

    return latestMessages
  }

  /**
   * Fetches the latest non-deleted comment for each thread.
   */
  private async fetchLatestCommentsForThreads(orderedThreadIds: string[]): Promise<any[]> {
    if (orderedThreadIds.length === 0) {
      return []
    }

    let latestCommentPointers: Array<{ threadId: string; commentId: string }> = []

    try {
      const pointerResult = await this.db.execute(sql`
        SELECT DISTINCT ON (${schema.Comment.threadId})
          ${schema.Comment.threadId} AS "threadId",
          ${schema.Comment.id} AS "commentId"
        FROM ${schema.Comment}
        WHERE ${inArray(schema.Comment.threadId, orderedThreadIds)}
          AND ${schema.Comment.deletedAt} IS NULL
        ORDER BY ${schema.Comment.threadId}, ${schema.Comment.createdAt} DESC
      `)

      latestCommentPointers =
        (pointerResult as unknown as { rows?: Array<{ threadId: string; commentId: string }> })
          .rows || []
    } catch (error: unknown) {
      logger.error('Failed to resolve latest comment pointers for threads', {
        threadCount: orderedThreadIds.length,
        error: this.formatError(error),
      })
      throw error
    }

    if (latestCommentPointers.length === 0) {
      return []
    }

    const uniqueCommentIds = Array.from(new Set(latestCommentPointers.map((row) => row.commentId)))
    const pointerMap = new Map(latestCommentPointers.map((row) => [row.commentId, row.threadId]))

    try {
      const comments = await this.db.query.Comment.findMany({
        where: inArray(schema.Comment.id, uniqueCommentIds),
        columns: {
          id: true,
          threadId: true,
          content: true,
          createdAt: true,
        },
        with: {
          createdBy: {
            columns: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      })

      return comments
        .map((comment) => ({
          ...comment,
          threadId: comment.threadId ?? pointerMap.get(comment.id) ?? null,
        }))
        .filter((comment) => comment.threadId)
    } catch (error: unknown) {
      logger.error('Failed to fetch latest comment records', {
        commentIdCount: uniqueCommentIds.length,
        error: this.formatError(error),
      })
      throw error
    }
  }

  /**
   * PHASE 3: Assemble data in original order
   * Assembles the final ThreadListItem array preserving the original sort order
   */
  private assembleThreadListItems(
    orderedThreadIds: string[],
    threadsUnordered: any[],
    latestMessages: any[],
    latestComments: any[],
    tags: any[],
    readStatus: any[],
    userId?: string
  ): ThreadListItem[] {
    // Create lookup maps for O(1) access
    const threadMap = new Map(threadsUnordered.map((t) => [t.id, t]))

    const messageMap = new Map<string, ThreadMessageSummary>(
      latestMessages
        .map((message) => this.toMessageSummary(message))
        .filter((summary): summary is ThreadMessageSummary => Boolean(summary))
        .map((summary) => [summary.threadId, summary])
    )

    const commentMap = new Map<string, ThreadCommentSummary>(
      latestComments
        .map((comment) => this.toCommentSummary(comment))
        .filter((comment): comment is ThreadCommentSummary => Boolean(comment))
        .map((comment) => [comment.threadId, comment])
    )

    const tagsByThread: Record<string, ThreadTagSummary[]> = {}
    for (const tagOnThread of tags) {
      if (!tagOnThread.threadId || !tagOnThread.tag) continue
      const summary = this.toTagSummary(tagOnThread.tag)
      if (!summary) continue
      if (!tagsByThread[tagOnThread.threadId]) {
        tagsByThread[tagOnThread.threadId] = []
      }
      tagsByThread[tagOnThread.threadId].push(summary)
    }

    const readStatusMap = new Map(readStatus.map((r) => [r.threadId, r]))

    // CRITICAL: Map over orderedThreadIds to preserve original sort order
    const items = orderedThreadIds
      .map((threadId) => {
        const thread = threadMap.get(threadId)
        if (!thread) return null

        const latestMessage = messageMap.get(threadId) || null
        const threadTags = tagsByThread[threadId] || []
        const latestComment = commentMap.get(threadId) || null
        const userStatus = readStatusMap.get(threadId)

        // Determine isUnread status
        let isUnread: boolean | null = userId ? true : null
        if (userId) {
          if (userStatus) {
            isUnread =
              !userStatus.isRead ||
              (userStatus.lastReadAt &&
                thread.lastMessageAt &&
                new Date(thread.lastMessageAt) > new Date(userStatus.lastReadAt))
          } else {
            isUnread = true
          }
        }

        return {
          ...thread,
          isUnread,
          latestMessage,
          messages: latestMessage ? [latestMessage] : [],
          latestComment,
          tags: threadTags,
        } as ThreadListItem
      })
      .filter(Boolean) as ThreadListItem[]

    return items
  }

  /**
   * Converts a raw message record into a summarized structure suitable for list views.
   */
  private toMessageSummary(message: any): ThreadMessageSummary | null {
    const threadId = message.threadId
    if (!threadId) {
      return null
    }

    const summary: ThreadMessageSummary = {
      id: message.id,
      threadId,
      subject: message.subject ?? null,
      snippet: message.snippet ?? null,
      textHtml: message.textHtml ?? null,
      textPlain: message.textPlain ?? null,
      sentAt: message.sentAt ?? null,
      lastAttemptAt: message.lastAttemptAt ?? null,
      createdAt: message.createdAt,
      isInbound: Boolean(message.isInbound),
      organizationId: message.organizationId,
      from: this.toActorSummary(message.from),
      replyTo: this.toActorSummary(message.replyTo),
      participants: (message.participants || [])
        .map((participant: any) => this.toParticipantSummary(participant))
        .filter((participant): participant is ThreadParticipantSummary => Boolean(participant)),
    }

    return summary
  }

  /**
   * Converts a message participant record into a summarized participant entry.
   */
  private toParticipantSummary(participant: any): ThreadParticipantSummary | null {
    if (!participant?.participant) {
      return null
    }
    return {
      role: participant.role,
      participant: this.toActorSummary(participant.participant) ?? {},
    }
  }

  /**
   * Converts a raw actor/participant record into a summarized actor structure.
   */
  private toActorSummary(actor: any): ThreadActorSummary | null {
    if (!actor) {
      return null
    }
    const contact = actor.contact
    const contactName = contact
      ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') || null
      : null

    return {
      id: actor.id,
      name: actor.name ?? contactName ?? null,
      displayName: actor.displayName ?? contactName ?? null,
      identifier: actor.identifier ?? contact?.email ?? null,
      image: actor.image ?? null,
    }
  }

  /**
   * Converts a raw comment record into a summarized structure.
   */
  private toCommentSummary(comment: any): ThreadCommentSummary | null {
    if (!comment?.threadId) {
      return null
    }
    return {
      id: comment.id,
      threadId: comment.threadId,
      content: comment.content,
      createdAt: comment.createdAt,
      createdBy: this.toActorSummary(comment.createdBy) ?? {
        id: comment.createdBy?.id,
        name: comment.createdBy?.name ?? null,
      },
    }
  }

  /**
   * Converts a raw tag record into a summarized structure.
   */
  private toTagSummary(tag: any): ThreadTagSummary | null {
    if (!tag) {
      return null
    }
    return {
      id: tag.id,
      title: tag.title,
      color: tag.color ?? null,
      emoji: tag.emoji ?? null,
    }
  }
}
