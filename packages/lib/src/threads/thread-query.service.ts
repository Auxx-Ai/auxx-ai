// packages/lib/src/threads/thread-query.service.ts

import { type Database, schema } from '@auxx/database'
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
import { buildConditionGroupsQuery } from '../mail-query/condition-query-builder'
import { InternalFilterContextType } from '../mail-query/types'
import { MailViewService } from '../mail-views/mail-view-service'
import { createScopedLogger } from '@auxx/logger'
import { type MailViewFilter } from '../mail-query/types'
import { parseSearchQuery } from '../mail-query/search-query-parser'
import { toActorId } from '@auxx/types/actor'
import { toRecordId } from '@auxx/types/resource'
import { ResourceRegistryService } from '../resources/registry/resource-registry-service'

import {
  type ThreadSortDescriptor,
  type ThreadSortField,
  type ListThreadIdsInput,
  type PaginatedIdsResult,
  type ThreadMeta,
  type ThreadStatus,
  type IntegrationProvider,
} from './types'
import { batchGetThreadTagIds } from '../field-values/relationship-queries'
import type { RecordId } from '@auxx/types/resource'
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

  // ============================================================================
  // New ID-first batch-fetch methods (Phase 1 refactor)
  // ============================================================================

  /**
   * Returns only thread IDs with pagination info.
   * The frontend will then batch-fetch metadata separately via getThreadMetaBatch.
   *
   * Uses unified condition-based filtering - filter is a ConditionGroup[].
   */
  async listThreadIds(input: ListThreadIdsInput): Promise<PaginatedIdsResult> {
    const { filter, sort, cursor, limit = 50 } = input
    const effectiveLimit = Math.min(limit, 100)

    logger.info('Listing thread IDs', {
      organizationId: this.organizationId,
      conditionGroups: filter.length,
      totalConditions: filter.reduce((sum, g) => sum + g.conditions.length, 0),
      limit: effectiveLimit,
      hasCursor: Boolean(cursor),
    })

    // Build WHERE clause from condition groups
    const whereCondition = buildConditionGroupsQuery(filter, this.organizationId)

    const resolvedSort = this.resolveSortDescriptor(sort)
    const orderByExpressions = this.createOrderByFromDescriptor(resolvedSort)

    // Use existing getThreadIds logic to get IDs
    const { orderedThreadIds, nextCursor } = await this.getThreadIdsInternal(
      whereCondition,
      { limit: effectiveLimit, cursor },
      { orderBy: orderByExpressions, sort: resolvedSort }
    )

    // Get total count for the query
    let total = 0
    try {
      const countResult = await this.db
        .select({ count: count() })
        .from(schema.Thread)
        .where(whereCondition)
      total = countResult[0]?.count ?? 0
    } catch (error) {
      logger.warn('Failed to get total count for listThreadIds', {
        error: error instanceof Error ? error.message : error,
      })
    }

    return {
      ids: orderedThreadIds,
      total,
      nextCursor,
    }
  }

  /**
   * Batch fetch thread metadata by IDs.
   * Returns core thread data without embedded messages/participants.
   * Uses denormalized latestMessageId and latestCommentId columns.
   * Now includes isUnread status and draftIds for the requesting user.
   */
  async getThreadMetaBatch(ids: string[], userId: string): Promise<ThreadMeta[]> {
    if (ids.length === 0) return []
    if (ids.length > 100) throw new Error('Batch size exceeds limit of 100')

    logger.debug('Fetching thread metadata batch', {
      organizationId: this.organizationId,
      count: ids.length,
    })

    // Fetch threads
    const threads = await this.db.query.Thread.findMany({
      where: and(
        inArray(schema.Thread.id, ids),
        eq(schema.Thread.organizationId, this.organizationId)
      ),
      with: {
        integration: { columns: { provider: true } },
      },
    })

    // Fetch tag RecordIds via FieldValue system
    // Note: batchGetThreadTagIds returns RecordIds (from FieldValue.relatedEntityId which stores RecordIds)
    const tagIdMap = await batchGetThreadTagIds(this.db, ids, this.organizationId)

    // Resolve inbox entityDefinitionId for RecordId conversion
    const registryService = new ResourceRegistryService(this.organizationId, this.db)
    const inboxEntityDefId = await registryService.resolveEntityDefId('inbox')

    // Fetch read status for all threads for this user
    const readStatuses = await this.db
      .select({
        threadId: schema.ThreadReadStatus.threadId,
        isRead: schema.ThreadReadStatus.isRead,
        lastReadAt: schema.ThreadReadStatus.lastReadAt,
      })
      .from(schema.ThreadReadStatus)
      .where(
        and(
          inArray(schema.ThreadReadStatus.threadId, ids),
          eq(schema.ThreadReadStatus.userId, userId)
        )
      )

    // Build read status lookup
    const readStatusMap = new Map(
      readStatuses.map((s) => [s.threadId, { isRead: s.isRead, lastReadAt: s.lastReadAt }])
    )

    // Fetch draft IDs for all threads for this user
    const drafts = await this.db
      .select({
        threadId: schema.Draft.threadId,
        id: schema.Draft.id,
      })
      .from(schema.Draft)
      .where(
        and(
          inArray(schema.Draft.threadId, ids),
          eq(schema.Draft.createdById, userId),
          eq(schema.Draft.organizationId, this.organizationId)
        )
      )

    // Build draft IDs lookup (threadId → RecordId[])
    const draftIdsByThread = new Map<string, RecordId[]>()
    for (const d of drafts) {
      if (d.threadId) {
        const existing = draftIdsByThread.get(d.threadId) ?? []
        existing.push(toRecordId('draft', d.id))
        draftIdsByThread.set(d.threadId, existing)
      }
    }

    // Map to ThreadMeta, preserving input order
    const threadMap = new Map(threads.map((t) => [t.id, t]))

    return ids
      .map((id) => {
        const t = threadMap.get(id)
        if (!t) return null

        // Determine isUnread status
        const status = readStatusMap.get(id)
        let isUnread = true // Default: unread if no status entry

        if (status) {
          // Has status entry - check isRead flag
          isUnread = !status.isRead

          // Also check if new messages arrived after lastReadAt
          if (!isUnread && status.lastReadAt && t.lastMessageAt) {
            isUnread = new Date(t.lastMessageAt) > new Date(status.lastReadAt)
          }
        }

        // tagIdMap values are already RecordIds (stored in FieldValue.relatedEntityId)
        const tagIds = (tagIdMap.get(id) ?? []) as RecordId[]

        return {
          id: t.id,
          subject: t.subject,
          status: t.status as ThreadStatus,
          lastMessageAt: t.lastMessageAt?.toISOString() ?? new Date().toISOString(),
          firstMessageAt: t.firstMessageAt?.toISOString() ?? null,
          messageCount: t.messageCount,
          participantCount: t.participantCount,
          integrationId: t.integrationId,
          integrationProvider: (t.integration?.provider as IntegrationProvider) ?? null,
          assigneeId: t.assigneeId ? toActorId('user', t.assigneeId) : null,
          latestMessageId: t.latestMessageId ?? null,
          latestCommentId: t.latestCommentId ?? null,
          inboxId: t.inboxId ? toRecordId(inboxEntityDefId, t.inboxId) : null,
          externalId: t.externalId ?? null,
          tagIds,
          isUnread,
          draftIds: draftIdsByThread.get(id) ?? [],
        } satisfies ThreadMeta
      })
      .filter(Boolean) as ThreadMeta[]
  }

  /**
   * PHASE 1: Get thread IDs in order
   * Fetches only thread IDs and pagination metadata in a lightweight query
   */
  private async getThreadIdsInternal(
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
}
