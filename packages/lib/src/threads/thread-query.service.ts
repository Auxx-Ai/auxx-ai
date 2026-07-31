// packages/lib/src/threads/thread-query.service.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { getCachedEntityDefId, requireCachedEntityDefId } from '../cache'
import { resolveConditionContext } from '../conditions/resolve-context'
import { batchGetThreadTagIds } from '../field-values/relationship-queries'
import { inboxDefKeyOf, loadInboxDefKeys } from '../inbox-record-ids'
import { buildConditionGroupsQuery } from '../mail-query/condition-query-builder'
import {
  buildDraftConditions,
  hasUnsupportedDraftConditions,
  isDraftsContextQuery,
} from '../mail-query/draft-condition-builder'
import { buildMailVisibilityPredicate } from '../mail-query/visibility-scope'
import { MailViewService } from '../mail-views/mail-view-service'
import { getParticipantIdsByMessage } from '../messages/participant-ids'
import type {
  MailViewer,
  ThreadVisibilityInput,
  UserInstanceGrants,
} from '../permissions/visibility/context'
import {
  hasContactGrants,
  isAutomationViewer,
  isSystemViewer,
} from '../permissions/visibility/context'
import { automationLens, effectiveLensBatch } from '../permissions/visibility/effective-lens'
import type { Lens } from '../permissions/visibility/lens'
import { redactThreadMeta } from '../permissions/visibility/redact'
import type {
  ChannelProvider,
  ListThreadIdsInput,
  PaginatedIdsResult,
  ThreadMergeData,
  ThreadMeta,
  ThreadSortDescriptor,
  ThreadSortField,
  ThreadStatus,
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
 * Cursor payload for mixed thread/draft UNION queries.
 * Encodes enough information to resume pagination across both entity types.
 */
type MixedCursorPayload = {
  sortValue: string | null // ISO date or string value
  entityType: 'thread' | 'draft'
  entityId: string
  sortField: ThreadSortField
  sortDirection: 'asc' | 'desc'
}

/**
 * Service for thread read operations (queries)
 * Handles all thread list and detail fetching logic
 */
export class ThreadQueryService {
  private db: Database
  private mailViewService: MailViewService
  private readonly organizationId: string
  private readonly viewer: MailViewer

  constructor(organizationId: string, db: Database, viewer: MailViewer) {
    this.db = db
    this.organizationId = organizationId
    this.viewer = viewer
    this.mailViewService = new MailViewService(this.organizationId, db, viewer)
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

  /** Sender sorting is a correlated subquery, not a column — hence the union. */
  private getSortValueSelection(sort: ThreadSortDescriptor): PgColumn | SQL {
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

    // §5.1: stats only count threads the viewer can see (SYSTEM/admin skip).
    const visibility = buildMailVisibilityPredicate(this.viewer)
    const scoped = (extra?: SQL<unknown>) =>
      and(
        eq(schema.Thread.organizationId, orgId),
        ...(visibility ? [visibility] : []),
        ...(extra ? [extra] : [])
      )

    try {
      const [total, open, archived, spam, trash] = await Promise.all([
        this.db
          .select({ count: count() })
          .from(schema.Thread)
          .where(scoped())
          .then((result) => result[0]?.count || 0),
        this.db
          .select({ count: count() })
          .from(schema.Thread)
          .where(scoped(eq(schema.Thread.status, 'OPEN')))
          .then((result) => result[0]?.count || 0),
        this.db
          .select({ count: count() })
          .from(schema.Thread)
          .where(scoped(eq(schema.Thread.status, 'ARCHIVED')))
          .then((result) => result[0]?.count || 0),
        this.db
          .select({ count: count() })
          .from(schema.Thread)
          .where(scoped(eq(schema.Thread.status, 'SPAM')))
          .then((result) => result[0]?.count || 0),
        this.db
          .select({ count: count() })
          .from(schema.Thread)
          .where(scoped(eq(schema.Thread.status, 'TRASH')))
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
   * Returns only record IDs with pagination info.
   * The frontend will then batch-fetch metadata separately via getThreadMetaBatch/getStandaloneDraftMetas.
   *
   * Uses unified condition-based filtering - filter is a ConditionGroup[].
   * For DRAFTS context, returns both threads-with-drafts AND standalone drafts via UNION query.
   */
  async listThreadIds(input: ListThreadIdsInput): Promise<PaginatedIdsResult> {
    const { sort, cursor, limit = 50, userId } = input
    const filter = resolveConditionContext(input.filter, { currentUserId: userId })
    const effectiveLimit = Math.min(limit, 100)

    logger.info('Listing thread IDs', {
      organizationId: this.organizationId,
      conditionGroups: filter.length,
      totalConditions: filter.reduce((sum, g) => sum + g.conditions.length, 0),
      limit: effectiveLimit,
      hasCursor: Boolean(cursor),
    })

    // Detect if this is a DRAFTS context query
    const isDraftsContext = isDraftsContextQuery(filter)

    if (isDraftsContext) {
      // Use UNION query for proper interleaving of threads-with-drafts and standalone drafts
      return this.listDraftsContextIds({ ...input, filter }, effectiveLimit)
    }

    // All other contexts: thread-only query returning RecordIds
    // Build WHERE clause from condition groups
    const whereCondition = buildConditionGroupsQuery(filter, this.organizationId, this.viewer)

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

    // Convert to RecordIds (thread:instanceId format)
    const recordIds = orderedThreadIds.map((id) => toRecordId('thread', id))

    return {
      ids: recordIds,
      total,
      nextCursor,
    }
  }

  /**
   * For DRAFTS context, build a UNION query combining threads-with-drafts and standalone drafts.
   * This ensures proper interleaving and pagination across both entity types.
   */
  private async listDraftsContextIds(
    input: ListThreadIdsInput,
    effectiveLimit: number
  ): Promise<PaginatedIdsResult> {
    const { filter, sort, cursor, userId } = input

    if (!userId) {
      throw new Error('userId required for DRAFTS context')
    }

    const resolvedSort = this.resolveSortDescriptor(sort)
    const decodedCursor = this.decodeMixedCursor(cursor)

    // Build thread WHERE clause (existing logic)
    const threadWhereCondition = buildConditionGroupsQuery(filter, this.organizationId, this.viewer)

    // Check if standalone drafts should be included
    const includeDrafts = !hasUnsupportedDraftConditions(filter)

    // Build the UNION query
    const rows = await this.buildDraftsUnionQuery({
      threadWhereCondition,
      includeDrafts,
      draftConditions: includeDrafts
        ? buildDraftConditions(filter, this.organizationId, userId)
        : null,
      sort: resolvedSort,
      cursor: decodedCursor,
      limit: effectiveLimit,
      userId,
    })

    // Process results
    const hasMore = rows.length > effectiveLimit
    const items = hasMore ? rows.slice(0, -1) : rows

    const recordIds: RecordId[] = items.map((row) =>
      toRecordId(row.entityType as 'thread' | 'draft', row.entityId)
    )

    // Build next cursor from last item
    let nextCursor: string | null = null
    const lastItem = items.at(-1)
    if (hasMore && lastItem) {
      nextCursor = this.encodeMixedCursor({
        sortValue: lastItem.sortDate,
        entityType: lastItem.entityType as 'thread' | 'draft',
        entityId: lastItem.entityId,
        sortField: resolvedSort.field,
        sortDirection: resolvedSort.direction,
      })
    }

    // Get total count (both threads and drafts)
    const total = await this.getDraftsContextTotalCount(
      threadWhereCondition,
      includeDrafts ? buildDraftConditions(filter, this.organizationId, userId) : null
    )

    return {
      ids: recordIds,
      total,
      nextCursor,
    }
  }

  /**
   * Build the UNION query for DRAFTS context.
   */
  private async buildDraftsUnionQuery(params: {
    threadWhereCondition: SQL
    includeDrafts: boolean
    draftConditions: SQL | null
    sort: ThreadSortDescriptor
    cursor: MixedCursorPayload | null
    limit: number
    userId: string
  }): Promise<{ entityType: string; entityId: string; sortDate: string }[]> {
    const { threadWhereCondition, includeDrafts, draftConditions, sort, cursor, limit } = params

    // Build cursor condition SQL if present
    const cursorCondition = cursor ? this.buildMixedCursorCondition(cursor, sort) : sql``

    if (!includeDrafts || !draftConditions) {
      // No drafts - just query threads (but still return in RecordId-compatible format)
      const rows = await this.db.execute<{
        entityType: string
        entityId: string
        sortDate: string
      }>(sql`
        SELECT
          'thread' as "entityType",
          "Thread".id as "entityId",
          "Thread"."lastMessageAt"::text as "sortDate"
        FROM "Thread"
        WHERE ${threadWhereCondition}
          ${cursorCondition}
        ORDER BY "Thread"."lastMessageAt" ${sort.direction === 'desc' ? sql`DESC` : sql`ASC`},
                 "Thread".id ${sort.direction === 'desc' ? sql`DESC` : sql`ASC`}
        LIMIT ${limit + 1}
      `)
      return rows.rows
    }

    // Full UNION query
    const rows = await this.db.execute<{
      entityType: string
      entityId: string
      sortDate: string
    }>(sql`
      WITH combined AS (
        -- Threads with drafts
        SELECT
          'thread' as "entityType",
          "Thread".id as "entityId",
          "Thread"."lastMessageAt"::text as "sortDate"
        FROM "Thread"
        WHERE ${threadWhereCondition}

        UNION ALL

        -- Standalone drafts
        SELECT
          'draft' as "entityType",
          "Draft".id as "entityId",
          "Draft"."updatedAt"::text as "sortDate"
        FROM "Draft"
        WHERE ${draftConditions}
      )
      SELECT "entityType", "entityId", "sortDate"
      FROM combined
      WHERE 1=1 ${cursorCondition}
      ORDER BY "sortDate" ${sort.direction === 'desc' ? sql`DESC` : sql`ASC`},
               "entityType" ${sort.direction === 'desc' ? sql`DESC` : sql`ASC`},
               "entityId" ${sort.direction === 'desc' ? sql`DESC` : sql`ASC`}
      LIMIT ${limit + 1}
    `)
    return rows.rows
  }

  /**
   * Get total count for DRAFTS context (threads + standalone drafts).
   */
  private async getDraftsContextTotalCount(
    threadWhereCondition: SQL,
    draftConditions: SQL | null
  ): Promise<number> {
    const threadCount = await this.db
      .select({ count: count() })
      .from(schema.Thread)
      .where(threadWhereCondition)
      .then((r) => r[0]?.count ?? 0)

    if (!draftConditions) {
      return threadCount
    }

    const draftCount = await this.db
      .select({ count: count() })
      .from(schema.Draft)
      .where(draftConditions)
      .then((r) => r[0]?.count ?? 0)

    return threadCount + draftCount
  }

  /**
   * Encode mixed cursor for UNION query pagination.
   */
  private encodeMixedCursor(payload: MixedCursorPayload): string {
    const encoded = this.toBase64Url(JSON.stringify(payload))
    return `v2:${encoded}`
  }

  /**
   * Decode mixed cursor for UNION query pagination.
   */
  private decodeMixedCursor(cursor: string | null | undefined): MixedCursorPayload | null {
    if (!cursor) return null

    if (cursor.startsWith('v2:')) {
      const raw = cursor.slice(3)
      try {
        const json = this.fromBase64Url(raw)
        const data = JSON.parse(json)
        if (
          data &&
          typeof data.entityId === 'string' &&
          (data.entityType === 'thread' || data.entityType === 'draft') &&
          (data.sortField === 'lastMessageAt' ||
            data.sortField === 'subject' ||
            data.sortField === 'sender') &&
          (data.sortDirection === 'asc' || data.sortDirection === 'desc')
        ) {
          return {
            sortValue: data.sortValue ?? null,
            entityType: data.entityType,
            entityId: data.entityId,
            sortField: data.sortField,
            sortDirection: data.sortDirection,
          }
        }
      } catch (error) {
        logger.warn('Failed to decode mixed cursor payload', {
          organizationId: this.organizationId,
          error: error instanceof Error ? error.message : error,
        })
        return null
      }
    }

    return null
  }

  /**
   * Build cursor condition for mixed UNION query.
   * Uses keyset pagination: (sortDate, entityType, entityId) > (cursorValue, cursorType, cursorId)
   */
  private buildMixedCursorCondition(cursor: MixedCursorPayload, sort: ThreadSortDescriptor): SQL {
    const isDesc = sort.direction === 'desc'

    if (isDesc) {
      // For DESC: find items BEFORE cursor (less than)
      return sql`AND (
        "sortDate" < ${cursor.sortValue}
        OR ("sortDate" = ${cursor.sortValue} AND "entityType" < ${cursor.entityType})
        OR ("sortDate" = ${cursor.sortValue} AND "entityType" = ${cursor.entityType} AND "entityId" < ${cursor.entityId})
      )`
    }

    // For ASC: find items AFTER cursor (greater than)
    return sql`AND (
      "sortDate" > ${cursor.sortValue}
      OR ("sortDate" = ${cursor.sortValue} AND "entityType" > ${cursor.entityType})
      OR ("sortDate" = ${cursor.sortValue} AND "entityType" = ${cursor.entityType} AND "entityId" > ${cursor.entityId})
    )`
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
        integration: { columns: { provider: true, isExample: true } },
      },
    })

    // Visibility (§5.2): evaluate the viewer's lens per thread once; `none`
    // rows are dropped below and the rest projected through redactThreadMeta.
    let lensByThread: Map<string, Lens> | null = null
    if (isAutomationViewer(this.viewer)) {
      // §8.2: full everywhere except personal inboxes — no grant derivations.
      const viewer = this.viewer
      lensByThread = new Map(
        threads.map((t) => [
          t.id,
          automationLens(viewer, {
            threadId: t.id,
            inboxId: t.inboxId ?? null,
            assigneeId: null,
            primaryEntityInstanceId: null,
            participantContactIds: [],
          }),
        ])
      )
    } else if (!isSystemViewer(this.viewer)) {
      const contactIds = await this.getParticipantContactIds(
        threads.map((t) => t.id),
        this.viewer
      )
      const inputs: ThreadVisibilityInput[] = threads.map((t) => ({
        threadId: t.id,
        inboxId: t.inboxId ?? null,
        assigneeId: t.assigneeId ?? null,
        primaryEntityInstanceId: t.primaryEntityInstanceId ?? null,
        participantContactIds: contactIds.get(t.id) ?? [],
      }))
      lensByThread = effectiveLensBatch(this.viewer, inputs)
    }

    // Fetch tag RecordIds via FieldValue system
    // Note: batchGetThreadTagIds returns RecordIds (from FieldValue.relatedEntityId which stores RecordIds)
    const tagIdMap = await batchGetThreadTagIds(this.db, ids, this.organizationId)

    // Latest-message envelope participants (metadata tier) — lets sub-`full`
    // viewers see sender identity even though `latestMessageId` is blanked.
    const participantsByMessage = await getParticipantIdsByMessage(
      this.db,
      threads.map((t) => t.latestMessageId).filter((id): id is string => !!id)
    )

    // Threads with explicit shares (instance grants) — powers the list rows'
    // share indicator (`hasShares`, metadata tier).
    const shareRows = await this.db
      .selectDistinct({ entityInstanceId: schema.ResourceAccess.entityInstanceId })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, this.organizationId),
          eq(schema.ResourceAccess.entityDefinitionId, 'thread'),
          inArray(schema.ResourceAccess.entityInstanceId, ids)
        )
      )
    const sharedThreadIds = new Set(shareRows.map((r) => r.entityInstanceId))

    // Resolve inbox and ticket entityDefinitionIds from org cache
    const inboxEntityDefId = await requireCachedEntityDefId(this.organizationId, 'inbox')
    const ticketEntityDefId = await requireCachedEntityDefId(this.organizationId, 'ticket')

    // A mailbox lives on `inbox` or `personal_inbox` (plan 40 §3 / 40a §5.1),
    // so the def is a PER-THREAD decision, not a batch constant — the majority
    // of threads in a typical org sit in someone's personal mailbox.
    //
    // This surface is keyed by `EntityDefinition.id`, NOT by the def slug: the
    // FE resolves `ThreadMeta.inboxId` through `useInbox` → `inboxMap`, whose
    // keys come from `record.listAll` (`toRecordId(entityDefId, …)`). Minting a
    // slug here would silently stop matching for EVERY thread, shared ones
    // included. The def-slug keyspace is the ResourceAccess/realtime one
    // (`toInboxRecordId`); the two are deliberately different here.
    //
    // `personal_inbox` is only present once entity migration 059 has run for
    // this org, so its id is optional and the resolver degrades to the shared
    // def — the same answer this line gave before the split.
    const [personalInboxEntityDefId, inboxDefKeys] = await Promise.all([
      getCachedEntityDefId(this.organizationId, 'personal_inbox'),
      loadInboxDefKeys(this.organizationId),
    ])
    const inboxDefIdFor = (inboxId: string): string =>
      personalInboxEntityDefId && inboxDefKeyOf(inboxDefKeys, inboxId) === 'personal_inbox'
        ? personalInboxEntityDefId
        : inboxEntityDefId

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

    // Subquery: draft IDs that have a pending scheduled message (exclude from draftIds)
    const scheduledDraftIds = this.db
      .select({ draftId: schema.ScheduledMessage.draftId })
      .from(schema.ScheduledMessage)
      .where(
        and(
          eq(schema.ScheduledMessage.organizationId, this.organizationId),
          eq(schema.ScheduledMessage.status, 'PENDING'),
          isNotNull(schema.ScheduledMessage.draftId)
        )
      )

    // Fetch draft IDs for all threads for this user (excluding scheduled drafts)
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
          eq(schema.Draft.organizationId, this.organizationId),
          notInArray(schema.Draft.id, scheduledDraftIds)
        )
      )

    // Fetch pending scheduled message counts per thread
    const scheduledCounts = await this.db
      .select({
        threadId: schema.ScheduledMessage.threadId,
        count: count(),
      })
      .from(schema.ScheduledMessage)
      .where(
        and(
          inArray(schema.ScheduledMessage.threadId, ids),
          eq(schema.ScheduledMessage.organizationId, this.organizationId),
          eq(schema.ScheduledMessage.status, 'PENDING')
        )
      )
      .groupBy(schema.ScheduledMessage.threadId)

    const scheduledCountMap = new Map<string, number>(
      scheduledCounts.map((s) => [s.threadId!, s.count])
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

        // Invisible to this viewer — indistinguishable from nonexistent.
        const lens = lensByThread ? (lensByThread.get(id) ?? 'none') : 'read'
        if (lens === 'none') return null

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

        const meta = {
          id: t.id,
          subject: t.subject,
          status: t.status as ThreadStatus,
          lastMessageAt: t.lastMessageAt?.toISOString() ?? new Date().toISOString(),
          firstMessageAt: t.firstMessageAt?.toISOString() ?? null,
          messageCount: t.messageCount,
          participantCount: t.participantCount,
          integrationId: t.integrationId,
          integrationProvider: (t.integration?.provider as ChannelProvider) ?? null,
          integrationIsExample: t.integration?.isExample ?? false,
          assigneeId: t.assigneeId ? toActorId('user', t.assigneeId) : null,
          latestMessageId: t.latestMessageId ?? null,
          latestCommentId: t.latestCommentId ?? null,
          participants: t.latestMessageId
            ? (participantsByMessage.get(t.latestMessageId) ?? [])
            : [],
          inboxId: t.inboxId ? toRecordId(inboxDefIdFor(t.inboxId), t.inboxId) : null,
          // Backwards-compat shim for the frontend: if the primary entity is a
          // Ticket, surface its instance id under the legacy `ticketId` key.
          // Non-ticket primaries (deals, leads, …) leave `ticketId` null —
          // the new `primaryEntity` field carries the full reference.
          ticketId:
            t.primaryEntityInstanceId && t.primaryEntityDefinitionId === ticketEntityDefId
              ? toRecordId(ticketEntityDefId, t.primaryEntityInstanceId)
              : null,
          primaryEntity:
            t.primaryEntityInstanceId && t.primaryEntityDefinitionId
              ? toRecordId(t.primaryEntityDefinitionId, t.primaryEntityInstanceId)
              : null,
          externalId: t.externalId ?? null,
          tagIds,
          isUnread,
          draftIds: draftIdsByThread.get(id) ?? [],
          scheduledMessageCount: scheduledCountMap.get(id) ?? 0,
          handoffState: t.handoffState,
          metadata: (t.metadata as Record<string, unknown> | null) ?? null,
          mergedIntoThreadId: t.mergedIntoThreadId
            ? toRecordId('thread', t.mergedIntoThreadId)
            : null,
          mergeData: (t.mergeData as ThreadMergeData | null) ?? null,
          myLens: lens,
          hasShares: sharedThreadIds.has(t.id),
        } satisfies ThreadMeta

        return redactThreadMeta(meta, lens)
      })
      .filter(Boolean) as ThreadMeta[]
  }

  /**
   * Contact instance ids per thread from `ThreadParticipant.entityInstanceId`
   * (§2.4) — the evaluator input for contact-derived grants. Skipped entirely
   * when the viewer holds no contact grants.
   */
  private async getParticipantContactIds(
    threadIds: string[],
    viewer: UserInstanceGrants
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>()
    if (threadIds.length === 0 || !hasContactGrants(viewer)) return map

    const rows = await this.db
      .select({
        threadId: schema.ThreadParticipant.threadId,
        entityInstanceId: schema.ThreadParticipant.entityInstanceId,
      })
      .from(schema.ThreadParticipant)
      .where(
        and(
          inArray(schema.ThreadParticipant.threadId, threadIds),
          isNotNull(schema.ThreadParticipant.entityInstanceId)
        )
      )

    for (const row of rows) {
      if (!row.entityInstanceId) continue
      const arr = map.get(row.threadId) ?? []
      arr.push(row.entityInstanceId)
      map.set(row.threadId, arr)
    }
    return map
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
    const baseQuery = this.db
      .select({
        id: schema.Thread.id,
        lastMessageAt: schema.Thread.lastMessageAt,
        sortValue: this.getSortValueSelection(sort),
      })
      .from(schema.Thread)

    // Applied as a ternary rather than `query = query.where(...)`: each chained
    // method narrows the builder's own type, so reassignment doesn't typecheck.
    const query = finalWhereCondition ? baseQuery.where(finalWhereCondition) : baseQuery

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
