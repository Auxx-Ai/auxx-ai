// packages/lib/src/threads/unread-service.ts
import { type Database, database as db, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm'

type DbOrTx = Database | Transaction

import { resolveConditionContext } from '../conditions/resolve-context'
import type { ConditionGroup } from '../conditions/types'
import { ForbiddenError } from '../errors'
import { buildConditionGroupsQuery } from '../mail-query/condition-query-builder'
import type { MailViewer } from '../permissions/visibility/context'
import { isSystemViewer } from '../permissions/visibility/context'
import { getThreadLensBatch } from '../permissions/visibility/thread-lens'
import { getRealtimeService, publishThreadUpdated } from '../realtime'

const logger = createScopedLogger('unread-service')

export class UnreadService {
  private organizationId: string
  private userId: string
  /** Visibility principal for count queries (§10.1) — usually `userId`'s own context. */
  private viewer: MailViewer
  /** Originating socket id for self-echo suppression on realtime publishes. */
  private socketId?: string
  /**
   * Loop guard for bidirectional provider sync: read-state changes that
   * originate FROM a provider event (Gmail UNREAD label) set `'provider-sync'`
   * so we never push the same change straight back to the provider.
   */
  private readonly origin?: 'provider-sync'

  constructor(
    organizationId: string,
    userId: string,
    viewer: MailViewer,
    socketId?: string,
    options?: { origin?: 'provider-sync' }
  ) {
    this.organizationId = organizationId
    this.userId = userId
    this.viewer = viewer
    this.socketId = socketId
    this.origin = options?.origin
  }

  /**
   * Counts unread OPEN threads in one inbox for the current user (no
   * read-status row, or an explicit isRead=false row). Used by the mail-counts
   * reconcile recount.
   *
   * @param tx Optional active tx — when called from inside `db.transaction()`,
   *   pass it through so reads share the same connection instead of grabbing
   *   another from the pool (which would deadlock under fan-out).
   */
  async calculateUnreadCountForUserInbox(inboxId: string, tx?: DbOrTx): Promise<number> {
    const dbOrTx = tx ?? db
    const result = await dbOrTx
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
          eq(schema.Thread.inboxId, inboxId),
          eq(schema.Thread.status, 'OPEN' as any),
          or(isNull(schema.ThreadReadStatus.userId), eq(schema.ThreadReadStatus.isRead, false))
        )
      )

    return result[0]?.count ?? 0
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

    // §7: unread state is `full`-tier — mark read/unread requires `full` lens
    // on every target (there is no visible unread state below `full` to clear).
    if (!isSystemViewer(this.viewer)) {
      const lenses = await getThreadLensBatch(db, this.organizationId, this.viewer, threadIds)
      const blocked = threadIds.filter((id) => lenses.get(id) !== 'read')
      if (blocked.length > 0) {
        throw new ForbiddenError('You do not have full access to the selected threads.')
      }
    }

    // Fetch threads with the fields count deltas need (inbox, status,
    // assignee) plus integrationId for the provider read-state push.
    const threads = await db
      .select({
        id: schema.Thread.id,
        inboxId: schema.Thread.inboxId,
        status: schema.Thread.status,
        assigneeId: schema.Thread.assigneeId,
        integrationId: schema.Thread.integrationId,
      })
      .from(schema.Thread)
      .where(
        and(
          inArray(schema.Thread.id, threadIds),
          eq(schema.Thread.organizationId, this.organizationId)
        )
      )

    if (threads.length === 0) return

    // Previous read state per thread — the upsert below can't reveal whether
    // it actually flipped anything, and deltas must only move on real flips.
    const previousReadRows = await db
      .select({
        threadId: schema.ThreadReadStatus.threadId,
        isRead: schema.ThreadReadStatus.isRead,
      })
      .from(schema.ThreadReadStatus)
      .where(
        and(
          inArray(schema.ThreadReadStatus.threadId, threadIds),
          eq(schema.ThreadReadStatus.userId, targetUserId)
        )
      )
    const previousReadMap = new Map(previousReadRows.map((r) => [r.threadId, r.isRead]))

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
    })

    // Counter deltas (post-commit): ±1 per thread that actually flipped, only
    // while the thread is OPEN (counts include only OPEN threads). Marking an
    // unrowed thread unread is a no-op — no row already means unread.
    const countDeltas: Array<{ userId: string; deltas: Record<string, number> }> = []
    for (const thread of threads) {
      const wasRead = previousReadMap.get(thread.id) ?? false
      const flipped = isRead ? !wasRead : wasRead
      if (!flipped || thread.status !== 'OPEN') continue
      const delta = isRead ? -1 : 1
      const deltas: Record<string, number> = {}
      if (thread.inboxId) deltas[`si:${thread.inboxId}`] = delta
      if (thread.assigneeId === targetUserId) deltas.inbox = delta
      if (Object.keys(deltas).length > 0) countDeltas.push({ userId: targetUserId, deltas })
    }
    if (countDeltas.length > 0) {
      // Lazy import — mail-counts statically imports this service.
      const { applyMailCountDeltas } = await import('./mail-counts')
      await applyMailCountDeltas(this.organizationId, countDeltas, {
        fastReconcileUserId: targetUserId,
      })
    }

    logger.info(
      `Set ${threads.length} thread(s) to ${isRead ? 'read' : 'unread'} for user ${targetUserId}`
    )

    // Publish per-thread `thread:updated` with `{ isUnread, userId }`. The FE
    // filters by userId so only the affected user's tabs apply the patch.
    const realtime = getRealtimeService()
    await Promise.allSettled(
      threads.map((thread) =>
        publishThreadUpdated(
          realtime,
          this.organizationId,
          {
            threadId: thread.id,
            inboxId: thread.inboxId ?? null,
            assigneeId: thread.assigneeId ?? null,
            patch: { isUnread: !isRead, userId: targetUserId },
          },
          { excludeSocketId: this.socketId }
        )
      )
    )

    // Mirror the read state to Gmail for personal channels — only the mailbox
    // owner's read state pushes (it's their mailbox; requireOwnerUserId filters
    // to inboxes they own), and never when this change came FROM provider sync
    // (loop guard). Fire-and-forget: enqueue failure logs, never throws.
    if (this.origin !== 'provider-sync') {
      try {
        const { enqueueProviderSyncForEligibleThreads } = await import(
          '../jobs/messages/thread-provider-status-sync-job'
        )
        await enqueueProviderSyncForEligibleThreads({
          organizationId: this.organizationId,
          threads: threads.map((t) => ({
            threadId: t.id,
            integrationId: t.integrationId ?? null,
            inboxId: t.inboxId ?? null,
          })),
          kind: 'read',
          requireOwnerUserId: targetUserId,
        })
      } catch (error) {
        logger.warn('Failed to enqueue provider read-state sync', {
          organizationId: this.organizationId,
          threadCount: threads.length,
          error: (error as Error).message,
        })
      }
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
      .innerJoin(schema.ThreadReadStatus, eq(schema.ThreadReadStatus.threadId, schema.Thread.id))
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
   * Gets all accessible mail view IDs for the current user.
   * Reads from UserCacheService (userMailViews) which already combines personal + shared views.
   */
  async getAccessibleViewIds(): Promise<string[]> {
    const { getUserCache } = await import('../cache')
    const views = await getUserCache().get(this.userId, 'userMailViews', this.organizationId)
    return views.map((v) => v.id)
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
      const rawFilters = (view.filters as ConditionGroup[]) || []
      const filters = resolveConditionContext(rawFilters, { currentUserId: this.userId })

      // Build WHERE condition from view filters
      const whereCondition = buildConditionGroupsQuery(filters, this.organizationId, this.viewer)

      // Count unread OPEN threads matching the filters: unread = no read-status
      // row for this user OR an explicit isRead=false row. One left-joined count
      // covers both cases.
      const unreadResult = await db
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
            or(isNull(schema.ThreadReadStatus.userId), eq(schema.ThreadReadStatus.isRead, false))
          )
        )

      return { viewId: view.id, count: unreadResult[0]?.count ?? 0 }
    })

    const results = await Promise.all(countPromises)

    const countsMap: Record<string, number> = {}
    for (const result of results) {
      countsMap[result.viewId] = result.count
    }

    return countsMap
  }
}
