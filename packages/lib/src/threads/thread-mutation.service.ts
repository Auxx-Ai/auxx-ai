// packages/lib/src/threads/thread-mutation.service.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { type ActorId, parseActorId } from '@auxx/types/actor'
import { getInstanceId, parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, exists, ilike, inArray, notExists, or, sql } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { BadRequestError, ForbiddenError } from '../errors'
import { publisher } from '../events/publisher'
import { FieldValueService } from '../field-values'
import type { MailViewer } from '../permissions/visibility/context'
import { isSystemViewer } from '../permissions/visibility/context'
import { getThreadLensBatch } from '../permissions/visibility/thread-lens'
import { getRealtimeService, publishThreadDeleted, publishThreadUpdated } from '../realtime'
import type { ThreadMeta } from '../realtime/events'
import { ThreadMergeService } from './thread-merge.service'
import type { ChatThreadMetadata } from './types'

const logger = createScopedLogger('thread-mutation-service')

/** Active statuses eligible for retroactive filtering */
const FILTERABLE_STATUSES = ['OPEN', 'ACTIVE', 'PENDING'] as const

/**
 * Unified thread updates interface.
 * Used by the update() and updateBulk() methods.
 */
export interface ThreadUpdates {
  status?: 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH' | 'IGNORED'
  subject?: string
  assigneeId?: ActorId | null
  /** Inbox RecordId (format: "entityDefinitionId:instanceId") or null to unassign */
  inboxId?: RecordId | null
  /** Ticket RecordId (format: "ticket:instanceId") or null to unlink */
  ticketId?: RecordId | null
  /**
   * Merge routing field. When set to a Thread RecordId, the corresponding
   * `update`/`updateBulk` call routes through {@link ThreadMergeService.merge}
   * instead of the standard field-update path. When explicitly `null`, the
   * call routes through {@link ThreadMergeService.unmerge}.
   */
  mergedIntoThreadId?: RecordId | null
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

  /**
   * Originating socket id for self-echo suppression on realtime publishes.
   * tRPC routers populate from `x-realtime-socket-id`; workers / workflow
   * nodes leave this undefined and accept the echo.
   */
  private readonly socketId?: string

  /**
   * Acting user id, used to attribute lifecycle events
   * (`thread:archived`, `thread:reopened`, `thread:assignee:changed`).
   * Workers / workflow nodes with no human actor leave this undefined and
   * skip the user-attributed event emission.
   */
  private readonly actorUserId?: string

  /**
   * Visibility principal (§7): acting on a thread requires `full` lens.
   * Workers / platform pipelines pass `SYSTEM_VISIBILITY` explicitly.
   */
  private readonly viewer: MailViewer

  /**
   * Loop guard for bidirectional provider sync: mutations that originate FROM
   * a provider event (Gmail archive → mark Done) set `'provider-sync'` so we
   * never push the same change straight back to the provider.
   */
  private readonly origin?: 'provider-sync'

  constructor(
    organizationId: string,
    db: Database,
    socketId: string | undefined,
    actorUserId: string | undefined,
    viewer: MailViewer,
    options?: { origin?: 'provider-sync' }
  ) {
    this.organizationId = organizationId
    this.db = db
    this.socketId = socketId
    this.actorUserId = actorUserId
    this.viewer = viewer
    this.origin = options?.origin
  }

  /**
   * §7 write gate: every target thread must be at `full` lens for the viewer.
   * Bulk ops reject partial-visibility sets outright (no silent partial
   * apply). Invisible ids fail the same way — indistinguishable from
   * nonexistent. SYSTEM skips.
   */
  private async assertCanActOnThreads(threadIds: string[]): Promise<void> {
    if (threadIds.length === 0 || isSystemViewer(this.viewer)) return
    const lenses = await getThreadLensBatch(this.db, this.organizationId, this.viewer, threadIds)
    const blocked = threadIds.filter((id) => lenses.get(id) !== 'full')
    if (blocked.length > 0) {
      throw new ForbiddenError(
        threadIds.length === 1
          ? 'You do not have full access to this thread.'
          : `You do not have full access to ${blocked.length} of the selected threads.`
      )
    }
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
    await this.assertCanActOnThreads([threadId])

    // Merge / unmerge routing: when mergedIntoThreadId is present in the
    // updates payload, defer to ThreadMergeService rather than running the
    // standard field-update path.
    if ('mergedIntoThreadId' in updates) {
      const mergeService = new ThreadMergeService(this.db, this.organizationId, this.actorUserId)
      if (typeof updates.mergedIntoThreadId === 'string') {
        if (!this.actorUserId) {
          throw new BadRequestError('Merge requires an authenticated actor')
        }
        const targetThreadId = getInstanceId(updates.mergedIntoThreadId)
        await this.assertCanActOnThreads([targetThreadId])
        await mergeService.merge({
          sourceThreadIds: [threadId],
          targetThreadId,
          organizationId: this.organizationId,
          actorUserId: this.actorUserId,
        })
        await this.markCountsStale()
        return {
          id: threadId,
          success: true,
          updatedFields: updates,
          timestamp: new Date(),
        }
      }
      if (updates.mergedIntoThreadId === null) {
        if (!this.actorUserId) {
          throw new BadRequestError('Unmerge requires an authenticated actor')
        }
        await mergeService.unmerge(threadId, this.actorUserId)
        await this.markCountsStale()
        return {
          id: threadId,
          success: true,
          updatedFields: updates,
          timestamp: new Date(),
        }
      }
    }

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
      if (updates.ticketId !== undefined) {
        const ticketInstanceId = updates.ticketId ? getInstanceId(updates.ticketId) : null
        if (ticketInstanceId) {
          const [ticket] = await this.db
            .select({
              id: schema.EntityInstance.id,
              entityDefinitionId: schema.EntityInstance.entityDefinitionId,
            })
            .from(schema.EntityInstance)
            .where(
              and(
                eq(schema.EntityInstance.id, ticketInstanceId),
                eq(schema.EntityInstance.organizationId, this.organizationId)
              )
            )
            .limit(1)
          if (!ticket) {
            throw new Error(`Ticket ${ticketInstanceId} not found`)
          }
          dbUpdates.primaryEntityInstanceId = ticketInstanceId
          dbUpdates.primaryEntityDefinitionId = ticket.entityDefinitionId
        } else {
          dbUpdates.primaryEntityInstanceId = null
          dbUpdates.primaryEntityDefinitionId = null
        }
      }

      if (Object.keys(dbUpdates).length === 0) {
        return {
          id: threadId,
          success: true,
          updatedFields: updates,
          timestamp: new Date(),
        }
      }

      // Capture pre-update inboxId so we can fan out the realtime event onto
      // both the old and new inbox channels when inboxId changes. We also
      // capture status + assigneeId so the lifecycle event emitters below
      // know whether the value actually moved.
      const [previous] = await this.db
        .select({
          inboxId: schema.Thread.inboxId,
          status: schema.Thread.status,
          assigneeId: schema.Thread.assigneeId,
          integrationId: schema.Thread.integrationId,
          metadata: schema.Thread.metadata,
        })
        .from(schema.Thread)
        .where(
          and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
        )
        .limit(1)
      // Chat visitor Participant id (null for email threads) — carried on the
      // lifecycle events below so the realtime handler skips a Thread SELECT.
      const visitorParticipantId =
        ((previous?.metadata ?? {}) as Partial<ChatThreadMetadata>).visitorParticipantId ?? null

      const result = await this.db
        .update(schema.Thread)
        .set(dbUpdates)
        .where(
          and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, this.organizationId))
        )
        .returning({
          id: schema.Thread.id,
          inboxId: schema.Thread.inboxId,
          assigneeId: schema.Thread.assigneeId,
        })

      if (result.length === 0) {
        throw new Error(`Thread ${threadId} not found`)
      }

      // Build a partial patch for the realtime event from the dbUpdates we
      // actually wrote. Mirrors the entity layer's "publish only what changed"
      // pattern in maybeUpdateDisplayValue.
      const patch: Partial<ThreadMeta> = {}
      if ('status' in dbUpdates) patch.status = dbUpdates.status
      if ('subject' in dbUpdates) patch.subject = dbUpdates.subject
      if ('assigneeId' in dbUpdates) patch.assigneeId = dbUpdates.assigneeId
      if ('inboxId' in dbUpdates) {
        patch.inboxId = dbUpdates.inboxId ? toRecordId('inbox', dbUpdates.inboxId) : null
      }
      if ('primaryEntityInstanceId' in dbUpdates) {
        patch.ticketId = dbUpdates.primaryEntityInstanceId
          ? toRecordId(
              dbUpdates.primaryEntityDefinitionId ?? 'ticket',
              dbUpdates.primaryEntityInstanceId
            )
          : null
      }
      if (Object.keys(patch).length > 0) {
        await publishThreadUpdated(
          getRealtimeService(),
          this.organizationId,
          {
            threadId,
            inboxId: result[0].inboxId ?? null,
            previousInboxId: previous?.inboxId ?? null,
            assigneeId: result[0].assigneeId ?? null,
            patch,
          },
          { excludeSocketId: this.socketId }
        )
      }

      // Lifecycle events — emit after the DB write succeeds. Each fires
      // through the same `publisher.publishLater` path used elsewhere so
      // persistence (createEventJob) + realtime fan-out (per-thread room)
      // stay in lockstep. ARCHIVED is our "done" state; un-ARCHIVING (to any
      // other status) is a reopen.
      if ('status' in dbUpdates && this.actorUserId) {
        const nextStatus = dbUpdates.status
        const prevStatus = previous?.status
        if (nextStatus === 'ARCHIVED' && prevStatus !== 'ARCHIVED') {
          await publisher.publishLater({
            type: 'thread:archived',
            data: {
              threadId,
              organizationId: this.organizationId,
              userId: this.actorUserId,
              visitorParticipantId,
            },
          })
        } else if (prevStatus === 'ARCHIVED' && nextStatus !== 'ARCHIVED') {
          await publisher.publishLater({
            type: 'thread:reopened',
            data: {
              threadId,
              organizationId: this.organizationId,
              userId: this.actorUserId,
              visitorParticipantId,
            },
          })
        }
      }
      if ('assigneeId' in dbUpdates && (previous?.assigneeId ?? null) !== dbUpdates.assigneeId) {
        await publisher.publishLater({
          type: 'thread:assignee:changed',
          data: {
            threadId,
            organizationId: this.organizationId,
            fromUserId: previous?.assigneeId ?? null,
            toUserId: dbUpdates.assigneeId,
            visitorParticipantId,
          },
        })
      }

      if ('status' in dbUpdates || 'assigneeId' in dbUpdates || 'inboxId' in dbUpdates) {
        await this.applyCountDeltasForUpdate(
          threadId,
          previous ?? { inboxId: null, status: null, assigneeId: null },
          dbUpdates
        )
      }

      if ('status' in dbUpdates && previous && previous.status !== dbUpdates.status) {
        await this.maybeEnqueueProviderStatusSync(dbUpdates.status, [
          {
            threadId,
            integrationId: previous.integrationId ?? null,
            inboxId: result[0]?.inboxId ?? null,
          },
        ])
        if (dbUpdates.status === 'ARCHIVED') {
          await this.maybeEnqueueLearnedExtraction([threadId])
        }
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
   * Exact counter deltas for a single-thread update (status / assignee /
   * inbox move). A thread is "counted" for a user when it is OPEN and unread
   * for them; the unread set is one indexed read-status query plus cached org
   * members. Never throws — a missed delta is drift that reconciliation heals.
   */
  private async applyCountDeltasForUpdate(
    threadId: string,
    prev: { inboxId: string | null; status: string | null; assigneeId: string | null },
    dbUpdates: Record<string, any>
  ): Promise<void> {
    try {
      const next = {
        inboxId: 'inboxId' in dbUpdates ? (dbUpdates.inboxId ?? null) : (prev.inboxId ?? null),
        status: 'status' in dbUpdates ? dbUpdates.status : prev.status,
        assigneeId:
          'assigneeId' in dbUpdates ? (dbUpdates.assigneeId ?? null) : (prev.assigneeId ?? null),
      }
      const prevOpen = prev.status === 'OPEN'
      const nextOpen = next.status === 'OPEN'
      const inboxChanged = (prev.inboxId ?? null) !== next.inboxId
      const assigneeChanged = (prev.assigneeId ?? null) !== next.assigneeId
      if (prevOpen === nextOpen && !inboxChanged && !assigneeChanged) return

      const readRows = await this.db
        .select({
          userId: schema.ThreadReadStatus.userId,
          isRead: schema.ThreadReadStatus.isRead,
        })
        .from(schema.ThreadReadStatus)
        .where(eq(schema.ThreadReadStatus.threadId, threadId))
      const readMap = new Map(readRows.map((r) => [r.userId, r.isRead]))

      // Lazy imports: mail-counts pulls in UnreadService; cache barrel is heavy.
      const [{ getCachedMembers }, { applyMailCountDeltas }] = await Promise.all([
        import('../cache'),
        import('./mail-counts'),
      ])
      const members = await getCachedMembers(this.organizationId)
      const unreadUserIds = members
        .map((m) => m.userId)
        .filter((userId) => readMap.get(userId) !== true)

      const deltas: { userId: string; deltas: Record<string, number> }[] = []
      for (const userId of unreadUserIds) {
        const d: Record<string, number> = {}
        if (prevOpen && prev.inboxId) d[`si:${prev.inboxId}`] = (d[`si:${prev.inboxId}`] ?? 0) - 1
        if (nextOpen && next.inboxId) d[`si:${next.inboxId}`] = (d[`si:${next.inboxId}`] ?? 0) + 1
        if (prevOpen && userId === prev.assigneeId) d.inbox = (d.inbox ?? 0) - 1
        if (nextOpen && userId === next.assigneeId) d.inbox = (d.inbox ?? 0) + 1
        if (Object.values(d).some((v) => v !== 0)) deltas.push({ userId, deltas: d })
      }
      if (deltas.length > 0) {
        await applyMailCountDeltas(this.organizationId, deltas, {
          fastReconcileUserId: this.actorUserId ?? undefined,
        })
      }
    } catch (error) {
      logger.warn('Failed to apply thread count deltas', {
        threadId,
        error: (error as Error).message,
      })
    }
  }

  /**
   * Enqueue a Gmail push for threads whose status actually changed — personal
   * gmail channels only (Front/Missive-style bidirectional sync; shared
   * inboxes keep helpdesk semantics). Skipped entirely when this mutation
   * originated from provider sync (loop guard) and for IGNORED (an Auxx-only
   * concept, never pushed). Fire-and-forget: enqueue failure logs, never
   * throws — Gmail is eventually consistent with Auxx, not transactionally
   * coupled. Chunked at 100 threads/job so bulk sweeps fan out retry-sized.
   */
  private async maybeEnqueueProviderStatusSync(
    newStatus: string,
    changed: { threadId: string; integrationId: string | null; inboxId: string | null }[]
  ): Promise<void> {
    if (this.origin === 'provider-sync' || newStatus === 'IGNORED' || changed.length === 0) return
    try {
      // Lazy import: the job module pulls in bullmq via the queue layer.
      const { enqueueProviderSyncForEligibleThreads } = await import(
        '../jobs/messages/thread-provider-status-sync-job'
      )
      await enqueueProviderSyncForEligibleThreads({
        organizationId: this.organizationId,
        threads: changed,
        kind: 'status',
      })
    } catch (error) {
      logger.error('Failed to enqueue provider status sync', {
        organizationId: this.organizationId,
        newStatus,
        threadCount: changed.length,
        error: (error as Error).message,
      })
    }
  }

  /**
   * Enqueue a learned-KB extraction for threads that just resolved
   * (transitioned to ARCHIVED). All noise gates (feature flag, message count,
   * `learnedExtractedAt` dedupe, outbound-reply check) live in the job — this
   * is a cheap fire-and-forget signal. Never throws.
   */
  private async maybeEnqueueLearnedExtraction(threadIds: string[]): Promise<void> {
    if (threadIds.length === 0) return
    try {
      // Lazy import: the job module pulls in bullmq via the queue layer.
      const { enqueueLearnedExtraction } = await import('../jobs/approvals/learned-extraction-job')
      await Promise.all(
        threadIds.map((threadId) =>
          enqueueLearnedExtraction({ organizationId: this.organizationId, threadId })
        )
      )
    } catch (error) {
      logger.warn('Failed to enqueue learned extraction', {
        organizationId: this.organizationId,
        threadCount: threadIds.length,
        error: (error as Error).message,
      })
    }
  }

  /**
   * Slow path for bulk/rare mutations (bulk update, merge, delete): mark every
   * member's counts stale and let the worker recount instead of computing
   * per-thread delta math. Never throws.
   */
  private async markCountsStale(): Promise<void> {
    try {
      const { markMailCountsStaleForOrgMembers } = await import('./mail-counts')
      await markMailCountsStaleForOrgMembers(this.organizationId)
    } catch (error) {
      logger.warn('Failed to mark counts stale', {
        organizationId: this.organizationId,
        error: (error as Error).message,
      })
    }
  }

  /**
   * Unified bulk update method for multiple threads.
   * Accepts RecordIds and applies partial updates to all.
   */
  async updateBulk(recordIds: RecordId[], updates: ThreadUpdates): Promise<{ count: number }> {
    if (!recordIds || recordIds.length === 0) return { count: 0 }

    const threadIds = recordIds.map((id) => parseRecordId(id).entityInstanceId)
    await this.assertCanActOnThreads(threadIds)

    // Merge / unmerge routing — see notes on `update` above.
    if ('mergedIntoThreadId' in updates) {
      const mergeService = new ThreadMergeService(this.db, this.organizationId, this.actorUserId)
      if (typeof updates.mergedIntoThreadId === 'string') {
        if (!this.actorUserId) {
          throw new BadRequestError('Merge requires an authenticated actor')
        }
        const targetThreadId = getInstanceId(updates.mergedIntoThreadId)
        await this.assertCanActOnThreads([targetThreadId])
        const result = await mergeService.merge({
          sourceThreadIds: threadIds,
          targetThreadId,
          organizationId: this.organizationId,
          actorUserId: this.actorUserId,
        })
        await this.markCountsStale()
        return { count: result.sourceThreadIds.length }
      }
      if (updates.mergedIntoThreadId === null) {
        if (!this.actorUserId) {
          throw new BadRequestError('Unmerge requires an authenticated actor')
        }
        for (const sourceId of threadIds) {
          await mergeService.unmerge(sourceId, this.actorUserId)
        }
        await this.markCountsStale()
        return { count: threadIds.length }
      }
    }

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
      if (updates.ticketId !== undefined) {
        const ticketInstanceId = updates.ticketId ? getInstanceId(updates.ticketId) : null
        if (ticketInstanceId) {
          const [ticket] = await this.db
            .select({
              id: schema.EntityInstance.id,
              entityDefinitionId: schema.EntityInstance.entityDefinitionId,
            })
            .from(schema.EntityInstance)
            .where(
              and(
                eq(schema.EntityInstance.id, ticketInstanceId),
                eq(schema.EntityInstance.organizationId, this.organizationId)
              )
            )
            .limit(1)
          if (!ticket) {
            throw new Error(`Ticket ${ticketInstanceId} not found`)
          }
          dbUpdates.primaryEntityInstanceId = ticketInstanceId
          dbUpdates.primaryEntityDefinitionId = ticket.entityDefinitionId
        } else {
          dbUpdates.primaryEntityInstanceId = null
          dbUpdates.primaryEntityDefinitionId = null
        }
      }

      if (Object.keys(dbUpdates).length === 0) {
        return { count: threadIds.length }
      }

      // Capture pre-update state: inboxIds for realtime fan-out onto both old
      // and new channels, status + integrationId for the provider status push
      // (enqueue only threads whose status actually changed).
      const previousRows = await this.db
        .select({
          id: schema.Thread.id,
          inboxId: schema.Thread.inboxId,
          status: schema.Thread.status,
          integrationId: schema.Thread.integrationId,
        })
        .from(schema.Thread)
        .where(
          and(
            inArray(schema.Thread.id, threadIds),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
      const prevInboxIdById = new Map(previousRows.map((r) => [r.id, r.inboxId ?? null]))

      const result = await this.db
        .update(schema.Thread)
        .set(dbUpdates)
        .where(
          and(
            inArray(schema.Thread.id, threadIds),
            eq(schema.Thread.organizationId, this.organizationId)
          )
        )
        .returning({
          id: schema.Thread.id,
          inboxId: schema.Thread.inboxId,
          assigneeId: schema.Thread.assigneeId,
        })

      const patch: Partial<ThreadMeta> = {}
      if ('status' in dbUpdates) patch.status = dbUpdates.status
      if ('assigneeId' in dbUpdates) patch.assigneeId = dbUpdates.assigneeId
      if ('inboxId' in dbUpdates) {
        patch.inboxId = dbUpdates.inboxId ? toRecordId('inbox', dbUpdates.inboxId) : null
      }
      if ('primaryEntityInstanceId' in dbUpdates) {
        patch.ticketId = dbUpdates.primaryEntityInstanceId
          ? toRecordId(
              dbUpdates.primaryEntityDefinitionId ?? 'ticket',
              dbUpdates.primaryEntityInstanceId
            )
          : null
      }
      if (Object.keys(patch).length > 0) {
        const realtime = getRealtimeService()
        await Promise.allSettled(
          result.map((row) =>
            publishThreadUpdated(
              realtime,
              this.organizationId,
              {
                threadId: row.id,
                inboxId: row.inboxId ?? null,
                previousInboxId: prevInboxIdById.get(row.id) ?? null,
                assigneeId: row.assigneeId ?? null,
                patch,
              },
              { excludeSocketId: this.socketId }
            )
          )
        )
      }

      if ('status' in dbUpdates || 'assigneeId' in dbUpdates || 'inboxId' in dbUpdates) {
        await this.markCountsStale()
      }

      if ('status' in dbUpdates) {
        const updatedInboxById = new Map(result.map((r) => [r.id, r.inboxId ?? null]))
        const changed = previousRows
          .filter((r) => updatedInboxById.has(r.id) && r.status !== dbUpdates.status)
          .map((r) => ({
            threadId: r.id,
            integrationId: r.integrationId ?? null,
            inboxId: updatedInboxById.get(r.id) ?? null,
          }))
        await this.maybeEnqueueProviderStatusSync(dbUpdates.status, changed)
        if (dbUpdates.status === 'ARCHIVED') {
          await this.maybeEnqueueLearnedExtraction(changed.map((c) => c.threadId))
        }
      }

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
    await this.assertCanActOnThreads([threadId])
    return this.deletePermanently(threadId)
  }

  /**
   * Unified bulk remove method for permanent deletion.
   * Accepts RecordIds.
   */
  async removeBulk(recordIds: RecordId[]): Promise<{ count: number }> {
    if (!recordIds || recordIds.length === 0) return { count: 0 }
    const threadIds = recordIds.map((id) => parseRecordId(id).entityInstanceId)
    await this.assertCanActOnThreads(threadIds)
    return this.bulkDeletePermanently(threadIds)
  }

  // ═══════════════════════════════════════════════════════════════
  // RETROACTIVE FILTER OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Find thread IDs where an inbound message's sender or recipient matches the entry.
   * Entry can be a full email (user@example.com) or a domain (example.com).
   */
  async findThreadIdsByParticipant(
    integrationId: string,
    entry: string,
    role: 'sender' | 'recipient'
  ): Promise<string[]> {
    const isDomain = !entry.includes('@')

    const emailMatch = (col: typeof schema.Participant.identifier) =>
      isDomain ? ilike(col, `%@${entry}`) : eq(col, entry)

    const threadFilter = and(
      eq(schema.Thread.integrationId, integrationId),
      eq(schema.Thread.organizationId, this.organizationId),
      inArray(schema.Thread.status, [...FILTERABLE_STATUSES])
    )

    if (role === 'sender') {
      // Sender = FROM participant on an inbound message
      const rows = await this.db
        .select({ id: schema.Thread.id })
        .from(schema.Thread)
        .where(
          and(
            threadFilter,
            exists(
              this.db
                .select({ x: sql`1` })
                .from(schema.Message)
                .innerJoin(schema.Participant, eq(schema.Participant.id, schema.Message.fromId))
                .where(
                  and(
                    eq(schema.Message.threadId, schema.Thread.id),
                    eq(schema.Message.isInbound, true),
                    emailMatch(schema.Participant.identifier)
                  )
                )
            )
          )
        )

      return rows.map((r) => r.id)
    }

    // Recipient = TO/CC participant on an inbound message
    const rows = await this.db
      .select({ id: schema.Thread.id })
      .from(schema.Thread)
      .where(
        and(
          threadFilter,
          exists(
            this.db
              .select({ x: sql`1` })
              .from(schema.Message)
              .innerJoin(
                schema.MessageParticipant,
                eq(schema.MessageParticipant.messageId, schema.Message.id)
              )
              .innerJoin(
                schema.Participant,
                eq(schema.Participant.id, schema.MessageParticipant.participantId)
              )
              .where(
                and(
                  eq(schema.Message.threadId, schema.Thread.id),
                  eq(schema.Message.isInbound, true),
                  inArray(schema.MessageParticipant.role, ['TO', 'CC']),
                  emailMatch(schema.Participant.identifier)
                )
              )
          )
        )
      )

    return rows.map((r) => r.id)
  }

  /**
   * Find threads where NO inbound message has a TO/CC recipient matching the allowlist.
   * Used for onlyProcessRecipients — threads sent to non-allowed addresses should be ignored.
   */
  async findThreadIdsNotMatchingRecipients(
    integrationId: string,
    allowedEntries: string[]
  ): Promise<string[]> {
    const matchConditions = allowedEntries.map((entry) => {
      const isDomain = !entry.includes('@')
      return isDomain
        ? ilike(schema.Participant.identifier, `%@${entry}`)
        : eq(schema.Participant.identifier, entry)
    })

    const rows = await this.db
      .select({ id: schema.Thread.id })
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.integrationId, integrationId),
          eq(schema.Thread.organizationId, this.organizationId),
          inArray(schema.Thread.status, [...FILTERABLE_STATUSES]),
          notExists(
            this.db
              .select({ x: sql`1` })
              .from(schema.Message)
              .innerJoin(
                schema.MessageParticipant,
                eq(schema.MessageParticipant.messageId, schema.Message.id)
              )
              .innerJoin(
                schema.Participant,
                eq(schema.Participant.id, schema.MessageParticipant.participantId)
              )
              .where(
                and(
                  eq(schema.Message.threadId, schema.Thread.id),
                  eq(schema.Message.isInbound, true),
                  inArray(schema.MessageParticipant.role, ['TO', 'CC']),
                  or(...matchConditions)
                )
              )
          )
        )
      )

    return rows.map((r) => r.id)
  }

  /**
   * Find all threads matching a filter entry and mark them as IGNORED.
   * Returns the count of updated threads.
   */
  async ignoreThreadsByFilter(
    integrationId: string,
    entry: string,
    role: 'sender' | 'recipient'
  ): Promise<{ count: number }> {
    const threadIds = await this.findThreadIdsByParticipant(integrationId, entry, role)

    if (threadIds.length === 0) return { count: 0 }

    const recordIds = threadIds.map((id) => toRecordId('thread', id))

    logger.info('Retroactively ignoring threads for filter entry', {
      entry,
      role,
      integrationId,
      matchCount: threadIds.length,
      organizationId: this.organizationId,
    })

    return this.updateBulk(recordIds, { status: 'IGNORED' })
  }

  /**
   * Count an integration's threads that currently sit in `fromInboxRecordId`.
   * Used to size the "move existing conversations?" prompt when a channel is
   * re-routed to a different inbox.
   */
  async countIntegrationThreadsInInbox(
    integrationId: string,
    fromInboxRecordId: RecordId
  ): Promise<{ count: number }> {
    const fromInstanceId = getInstanceId(fromInboxRecordId)

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.organizationId, this.organizationId),
          eq(schema.Thread.integrationId, integrationId),
          eq(schema.Thread.inboxId, fromInstanceId)
        )
      )

    return { count: row?.count ?? 0 }
  }

  /**
   * Move all of an integration's threads that currently sit in `fromInboxRecordId`
   * into `toInboxRecordId`. Used when a channel is re-routed to a different inbox
   * and the user opts to relocate existing conversations. Threads that were
   * manually moved to other inboxes are left untouched (they no longer match
   * `fromInboxRecordId`). Delegates to {@link updateBulk} so the move shares the
   * same realtime fan-out (onto both the old and new inbox channels) and count
   * invalidation as every other inbox change.
   */
  async moveIntegrationThreadsToInbox(
    integrationId: string,
    fromInboxRecordId: RecordId,
    toInboxRecordId: RecordId
  ): Promise<{ count: number }> {
    const fromInstanceId = getInstanceId(fromInboxRecordId)

    const rows = await this.db
      .select({ id: schema.Thread.id })
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.organizationId, this.organizationId),
          eq(schema.Thread.integrationId, integrationId),
          eq(schema.Thread.inboxId, fromInstanceId)
        )
      )

    if (rows.length === 0) return { count: 0 }

    const recordIds = rows.map((r) => toRecordId('thread', r.id))

    logger.info('Moving integration threads to new inbox', {
      integrationId,
      fromInboxRecordId,
      toInboxRecordId,
      matchCount: recordIds.length,
      organizationId: this.organizationId,
    })

    // Chunk so the per-thread realtime fan-out in updateBulk stays bounded on
    // channels with a large backlog.
    let count = 0
    for (let i = 0; i < recordIds.length; i += 200) {
      const chunk = recordIds.slice(i, i + 200)
      const result = await this.updateBulk(chunk, { inboxId: toInboxRecordId })
      count += result.count
    }
    return { count }
  }

  // ═══════════════════════════════════════════════════════════════
  // TAG OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Bulk tag operation — RecordId[] end-to-end, no conversion.
   * Tags are stored as RELATIONSHIP field values with systemAttribute='thread_tags'.
   *
   * Delegates to FieldValueService bulk primitives so tag writes share the same
   * inverse-sync, field-trigger, and realtime-publish path as every other
   * relationship write (no direct FieldValue writes here).
   */
  async tagThreadsBulk(
    recordIds: RecordId[],
    relatedRecordIds: RecordId[],
    operation: 'add' | 'remove' | 'set' = 'add'
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    if (!recordIds.length || !relatedRecordIds.length) {
      return { created: 0, skipped: 0, errors: [] }
    }

    await this.assertCanActOnThreads(recordIds.map((id) => parseRecordId(id).entityInstanceId))

    logger.info(`Bulk tagging threads`, {
      operation,
      threadCount: recordIds.length,
      tagCount: relatedRecordIds.length,
      organizationId: this.organizationId,
    })

    const errors: string[] = []

    try {
      const tagsField = await getOrgCache()
        .from(this.organizationId, 'customFields')
        .bySystemAttribute('thread_tags')

      if (!tagsField) {
        errors.push('Thread tags field not found for organization')
        return { created: 0, skipped: 0, errors }
      }

      const fieldId = tagsField.id
      const fieldValueService = new FieldValueService(this.organizationId, undefined, this.db)

      let created = 0
      let skipped = 0

      if (operation === 'add') {
        const result = await fieldValueService.addRelationValuesBulk({
          recordIds,
          fieldId,
          relatedRecordIds,
        })
        created = result.inserted
        skipped = result.skipped
      } else if (operation === 'remove') {
        const result = await fieldValueService.removeRelationValuesBulk({
          recordIds,
          fieldId,
          relatedRecordIds,
        })
        created = result.removed
      } else {
        // 'set' — replace existing values on each thread. No bulk set primitive yet;
        // per-entity setValueWithBuiltIn reuses inverse sync + publish logic.
        const relationshipValue = relatedRecordIds.map((recordId) => ({ recordId }))
        await Promise.all(
          recordIds.map((recordId) =>
            fieldValueService.setValueWithBuiltIn({
              recordId,
              fieldId,
              value: relationshipValue,
            })
          )
        )
        created = recordIds.length * relatedRecordIds.length
      }

      logger.info(`Bulk thread tagging completed`, { operation, created, skipped })
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
        .returning({
          id: schema.Thread.id,
          inboxId: schema.Thread.inboxId,
          assigneeId: schema.Thread.assigneeId,
        })

      if (result.length === 0) {
        logger.error('Thread not found for permanent deletion.', { threadId })
        throw new Error(`Thread ${threadId} not found for deletion.`)
      }

      await publishThreadDeleted(
        getRealtimeService(),
        this.organizationId,
        {
          threadId,
          inboxId: result[0].inboxId ?? null,
          assigneeId: result[0].assigneeId ?? null,
        },
        { excludeSocketId: this.socketId }
      )
      await this.markCountsStale()

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
        .returning({
          id: schema.Thread.id,
          inboxId: schema.Thread.inboxId,
          assigneeId: schema.Thread.assigneeId,
        })

      logger.info('Threads permanently deleted in bulk', {
        requestedCount: threadIds.length,
        deletedCount: result.length,
      })

      const realtime = getRealtimeService()
      await Promise.allSettled(
        result.map((row) =>
          publishThreadDeleted(
            realtime,
            this.organizationId,
            { threadId: row.id, inboxId: row.inboxId ?? null, assigneeId: row.assigneeId ?? null },
            { excludeSocketId: this.socketId }
          )
        )
      )
      await this.markCountsStale()

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
    // Get all messages with proper dates (ordered by sentAt ASC for first/last)
    // All messages are now "real" messages - drafts are in separate Draft table
    const messages = await this.db.query.Message.findMany({
      where: (messages, { eq, and, isNotNull }) =>
        and(eq(messages.threadId, threadId), isNotNull(messages.sentAt)),
      columns: { sentAt: true },
      orderBy: (messages, { asc }) => [asc(messages.sentAt)],
    })

    // Get the latest message with deterministic ordering for latestMessageId
    const latestMessage = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.threadId, threadId),
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
    // All messages are now "real" messages - drafts are in separate Draft table
    const messages = await this.db.query.Message.findMany({
      where: (messages, { eq }) => eq(messages.threadId, threadId),
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
