// packages/lib/src/threads/thread-merge.service.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import type { ThreadEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { BadRequestError, ConflictError, NotFoundError } from '../errors'
import { ThreadEventType, TimelineActorType, TimelineEntityType } from '../timeline/event-types'

const logger = createScopedLogger('thread-merge-service')

/** Unmerge TTL: 24 hours after `mergedAt`. */
const UNMERGE_TTL_MS = 24 * 60 * 60 * 1000

export interface MergeThreadsInput {
  sourceThreadIds: string[]
  targetThreadId: string
  organizationId: string
  actorUserId: string
}

export interface MergeThreadsResult {
  batchId: string
  targetThreadId: string
  sourceThreadIds: string[]
  movedMessageCount: number
  movedCommentCount: number
  unmergeableUntil: Date
}

interface PerSourceMoveSnapshot {
  sourceThreadId: string
  movedMessageIds: string[]
  movedCommentIds: string[]
  movedCommentReferenceIds: string[]
  movedDraftIds: string[]
  movedScheduledMessageIds: string[]
  movedAiSuggestionIds: string[]
  movedReadStatusIds: string[]
  movedParticipantIds: string[]
  movedLabelIds: string[]
  movedEntityLinkIds: string[]
  movedFieldValueIds: string[]
  movedEventIds: string[]
  sourceSubject: string
  previousStatus: ThreadEntity['status']
  previousAssigneeId: string | null
  previousInboxId: string | null
  previousPrimaryEntityInstanceId: string | null
  previousPrimaryEntityDefinitionId: string | null
}

interface MovePresence {
  messages: boolean
  comments: boolean
  commentReferences: boolean
  drafts: boolean
  scheduled: boolean
  aiSuggestions: boolean
  readStatus: boolean
  participants: boolean
  entityLinks: boolean
  labels: boolean
  fieldValues: boolean
  events: boolean
}

/** Reduce per-source snapshots to a "does any source have rows in X?" map. */
function aggregatePresence(snapshots: PerSourceMoveSnapshot[]): MovePresence {
  const any = (pick: (s: PerSourceMoveSnapshot) => unknown[]) =>
    snapshots.some((s) => pick(s).length > 0)
  return {
    messages: any((s) => s.movedMessageIds),
    comments: any((s) => s.movedCommentIds),
    commentReferences: any((s) => s.movedCommentReferenceIds),
    drafts: any((s) => s.movedDraftIds),
    scheduled: any((s) => s.movedScheduledMessageIds),
    aiSuggestions: any((s) => s.movedAiSuggestionIds),
    readStatus: any((s) => s.movedReadStatusIds),
    participants: any((s) => s.movedParticipantIds),
    entityLinks: any((s) => s.movedEntityLinkIds),
    labels: any((s) => s.movedLabelIds),
    fieldValues: any((s) => s.movedFieldValueIds),
    events: any((s) => s.movedEventIds),
  }
}

/**
 * Soft, reversible thread merge service. Sources stay in the database with a
 * `mergedIntoThreadId` pointer; all content moves to the target. Sources are
 * hidden from list views by the global `mergedAt IS NULL` filter on the read
 * path. Unmerge is supported per-source within 24h via the IDs persisted in
 * the `thread:merged_from` timeline event on the target.
 */
export class ThreadMergeService {
  constructor(
    private readonly db: Database,
    private readonly organizationId: string,
    private readonly actorUserId?: string
  ) {}

  async merge(input: MergeThreadsInput): Promise<MergeThreadsResult> {
    const batchId = generateId()
    const now = new Date()

    const result = await this.db.transaction(async (tx) => {
      // 0. Resolve final target by following merge pointers. The user may
      // pick a thread that's itself already merged (e.g. an out-of-date list
      // view, or chained merges); silently redirect to the ultimate target
      // rather than 409-ing. Cap the walk to detect cycles or runaway depth.
      const finalTargetId = await this.resolveFinalTarget(tx, input.targetThreadId)

      const dedupedSources = Array.from(new Set(input.sourceThreadIds)).filter(
        (id) => id !== finalTargetId
      )
      if (dedupedSources.length === 0) {
        throw new BadRequestError('Merge requires at least one source thread')
      }

      logger.info('Starting thread merge', {
        batchId,
        organizationId: input.organizationId,
        targetThreadId: finalTargetId,
        requestedTargetThreadId: input.targetThreadId,
        sourceCount: dedupedSources.length,
        actorUserId: input.actorUserId,
      })

      // 1. Lock all involved threads to prevent concurrent merges / sync writes.
      const allIds = [finalTargetId, ...dedupedSources]
      const lockedRows = await tx
        .select()
        .from(schema.Thread)
        .where(
          and(
            inArray(schema.Thread.id, allIds),
            eq(schema.Thread.organizationId, input.organizationId)
          )
        )
        .for('update')

      const byId = new Map(lockedRows.map((row) => [row.id, row]))
      const target = byId.get(finalTargetId)
      if (!target) {
        throw new NotFoundError(`Target thread ${finalTargetId} not found`)
      }
      if (target.mergedAt) {
        // Lost a race — the resolved target got merged between resolve and
        // lock. Surface as conflict rather than silently doing the wrong thing.
        throw new ConflictError('Target thread is itself merged into another thread')
      }

      const sources: ThreadEntity[] = []
      const skippedAlreadyMerged: string[] = []
      for (const id of dedupedSources) {
        const src = byId.get(id)
        if (!src) {
          throw new NotFoundError(`Source thread ${id} not found`)
        }
        if (src.mergedAt) {
          // Tolerate stale selections (e.g. a thread already merged by a
          // prior action that the FE still had in its checkbox set). Skip it
          // rather than aborting the entire batch.
          skippedAlreadyMerged.push(id)
          continue
        }
        sources.push(src)
      }
      if (skippedAlreadyMerged.length > 0) {
        logger.info('Skipping already-merged sources', {
          batchId,
          skipped: skippedAlreadyMerged,
        })
      }
      if (sources.length === 0) {
        // Every requested source was already merged — nothing to do.
        return {
          batchId,
          targetThreadId: target.id,
          sourceThreadIds: [],
          movedMessageCount: 0,
          movedCommentCount: 0,
          unmergeableUntil: new Date(now.getTime() + UNMERGE_TTL_MS),
        }
      }
      // Stable order for deterministic conflict resolution (earliest created wins).
      sources.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      const sourceIds = sources.map((s) => s.id)
      const targetId = target.id

      // 2. Capture per-source move snapshots so we can unmerge later.
      const snapshots = await this.captureSnapshots(tx, sources)

      // 3. Run the moves (bulk WHERE threadId IN (sourceIds)). Pre-dedupes
      //    handle unique-index collisions in `moveAll` itself; the post-move
      //    AI-suggestion sweep marks stale bundles. Skip the AI-suggestion
      //    sweep when no source touched suggestions.
      const presence = aggregatePresence(snapshots)
      await this.moveAll(tx, sourceIds, targetId, presence)
      if (presence.aiSuggestions) {
        await this.dedupeAiSuggestions(tx, targetId)
      }

      // 5. Resolve scalar column conflicts on the target row.
      const scalarOverrides = await this.resolveScalarConflicts(tx, target, sources)

      // 6. Audit events: one MERGED_INTO per source, one MERGED_FROM per source on target.
      await this.insertMergeEvents(tx, {
        batchId,
        targetThreadId: targetId,
        snapshots,
        actorUserId: input.actorUserId,
        occurredAt: now,
        scalarOverrides,
      })

      // 7. Stamp the merge pointer on every source.
      await tx
        .update(schema.Thread)
        .set({
          mergedIntoThreadId: targetId,
          mergedAt: now,
          mergedById: input.actorUserId,
        })
        .where(inArray(schema.Thread.id, sourceIds))

      // 8. Recompute denormalized target metadata in one pass.
      await this.recomputeTargetMetadata(tx, targetId)

      const movedMessageCount = snapshots.reduce((sum, s) => sum + s.movedMessageIds.length, 0)
      const movedCommentCount = snapshots.reduce((sum, s) => sum + s.movedCommentIds.length, 0)

      return {
        batchId,
        targetThreadId: targetId,
        sourceThreadIds: sourceIds,
        movedMessageCount,
        movedCommentCount,
        unmergeableUntil: new Date(now.getTime() + UNMERGE_TTL_MS),
      }
    })

    logger.info('Thread merge complete', {
      batchId,
      targetThreadId: result.targetThreadId,
      sourceCount: result.sourceThreadIds.length,
      movedMessageCount: result.movedMessageCount,
      movedCommentCount: result.movedCommentCount,
    })

    return result
  }

  /** Unmerge ONE source from its current target. Other sources stay merged. */
  async unmerge(sourceThreadId: string, actorUserId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const source = await this.loadSourceForUnmerge(tx, sourceThreadId)
      const event = await this.loadMergedIntoEvent(tx, sourceThreadId)
      const targetId = source.mergedIntoThreadId
      if (!targetId) {
        throw new ConflictError('Source thread has no merge pointer to unmerge')
      }

      // Target must still exist and itself not be merged.
      const [target] = await tx
        .select()
        .from(schema.Thread)
        .where(
          and(eq(schema.Thread.id, targetId), eq(schema.Thread.organizationId, this.organizationId))
        )
        .for('update')
      if (!target) {
        throw new NotFoundError(`Merge target ${targetId} no longer exists`)
      }
      if (target.mergedAt) {
        throw new ConflictError('Cannot unmerge: target was itself merged')
      }

      const data = (event.eventData ?? {}) as Record<string, unknown>
      await this.reverseSourceMoves(tx, sourceThreadId, data)

      // Recompute metadata on both threads.
      await this.recomputeTargetMetadata(tx, targetId)
      await this.recomputeTargetMetadata(tx, sourceThreadId)

      // Clear merge pointer on the source.
      await tx
        .update(schema.Thread)
        .set({ mergedIntoThreadId: null, mergedAt: null, mergedById: null })
        .where(eq(schema.Thread.id, sourceThreadId))

      // Delete this source's merge events on the source and the target.
      await tx
        .delete(schema.TimelineEvent)
        .where(
          and(
            eq(schema.TimelineEvent.organizationId, this.organizationId),
            eq(schema.TimelineEvent.entityType, TimelineEntityType.THREAD),
            eq(schema.TimelineEvent.entityId, sourceThreadId),
            eq(schema.TimelineEvent.eventType, ThreadEventType.MERGED_INTO)
          )
        )
      await tx
        .delete(schema.TimelineEvent)
        .where(
          and(
            eq(schema.TimelineEvent.organizationId, this.organizationId),
            eq(schema.TimelineEvent.entityType, TimelineEntityType.THREAD),
            eq(schema.TimelineEvent.entityId, targetId),
            eq(schema.TimelineEvent.eventType, ThreadEventType.MERGED_FROM),
            eq(schema.TimelineEvent.relatedEntityId, sourceThreadId)
          )
        )

      logger.info('Thread unmerge complete', {
        sourceThreadId,
        targetThreadId: targetId,
        actorUserId,
      })
    })
  }

  /** Unmerge every source in a batch in one transaction. */
  async unmergeBatch(batchId: string, actorUserId: string): Promise<void> {
    const events = await this.db
      .select()
      .from(schema.TimelineEvent)
      .where(
        and(
          eq(schema.TimelineEvent.organizationId, this.organizationId),
          eq(schema.TimelineEvent.eventType, ThreadEventType.MERGED_INTO),
          sql`${schema.TimelineEvent.eventData} ->> 'batchId' = ${batchId}`
        )
      )

    if (events.length === 0) {
      throw new NotFoundError(`No merge batch ${batchId} found`)
    }

    for (const ev of events) {
      await this.unmerge(ev.entityId, actorUserId)
    }
  }

  async getMergeTarget(sourceThreadId: string): Promise<ThreadEntity | null> {
    const [src] = await this.db
      .select()
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.id, sourceThreadId),
          eq(schema.Thread.organizationId, this.organizationId)
        )
      )
    if (!src?.mergedIntoThreadId) return null
    const [target] = await this.db
      .select()
      .from(schema.Thread)
      .where(
        and(
          eq(schema.Thread.id, src.mergedIntoThreadId),
          eq(schema.Thread.organizationId, this.organizationId)
        )
      )
    return target ?? null
  }

  // ═══════════════════════════════════════════════════════════════
  // Internal helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Walk the `mergedIntoThreadId` chain from `startId` until we hit a thread
   * that isn't itself merged. Caps the walk at 10 hops and detects cycles so
   * a corrupted pointer chain can't hang the transaction.
   */
  private async resolveFinalTarget(tx: Transaction, startId: string): Promise<string> {
    const visited = new Set<string>()
    let current = startId
    for (let i = 0; i < 10; i++) {
      if (visited.has(current)) {
        throw new ConflictError(`Merge pointer cycle detected at ${current}`)
      }
      visited.add(current)
      const [row] = await tx
        .select({
          mergedAt: schema.Thread.mergedAt,
          mergedIntoThreadId: schema.Thread.mergedIntoThreadId,
        })
        .from(schema.Thread)
        .where(
          and(eq(schema.Thread.id, current), eq(schema.Thread.organizationId, this.organizationId))
        )
      if (!row) {
        throw new NotFoundError(`Target thread ${current} not found`)
      }
      if (!row.mergedAt || !row.mergedIntoThreadId) return current
      current = row.mergedIntoThreadId
    }
    throw new ConflictError('Merge pointer chain too deep')
  }

  private async captureSnapshots(
    tx: Transaction,
    sources: ThreadEntity[]
  ): Promise<PerSourceMoveSnapshot[]> {
    const sourceIds = sources.map((s) => s.id)
    const sourceIdsSql = sql.join(
      sourceIds.map((id) => sql`${id}`),
      sql.raw(', ')
    )

    const [
      messages,
      comments,
      drafts,
      scheduled,
      suggestions,
      reads,
      participants,
      links,
      labels,
      fieldValues,
      events,
      refs,
    ] = await Promise.all([
      tx
        .select({ id: schema.Message.id, threadId: schema.Message.threadId })
        .from(schema.Message)
        .where(inArray(schema.Message.threadId, sourceIds)),
      tx
        .select({ id: schema.Comment.id, threadId: schema.Comment.entityId })
        .from(schema.Comment)
        .where(
          and(
            eq(schema.Comment.entityDefinitionId, 'thread'),
            inArray(schema.Comment.entityId, sourceIds)
          )
        ),
      tx
        .select({ id: schema.Draft.id, threadId: schema.Draft.threadId })
        .from(schema.Draft)
        .where(inArray(schema.Draft.threadId, sourceIds)),
      tx
        .select({ id: schema.ScheduledMessage.id, threadId: schema.ScheduledMessage.threadId })
        .from(schema.ScheduledMessage)
        .where(inArray(schema.ScheduledMessage.threadId, sourceIds)),
      tx
        .select({ id: schema.AiSuggestion.id, threadId: schema.AiSuggestion.threadId })
        .from(schema.AiSuggestion)
        .where(inArray(schema.AiSuggestion.threadId, sourceIds)),
      tx
        .select({ id: schema.ThreadReadStatus.id, threadId: schema.ThreadReadStatus.threadId })
        .from(schema.ThreadReadStatus)
        .where(inArray(schema.ThreadReadStatus.threadId, sourceIds)),
      tx
        .select({ id: schema.ThreadParticipant.id, threadId: schema.ThreadParticipant.threadId })
        .from(schema.ThreadParticipant)
        .where(inArray(schema.ThreadParticipant.threadId, sourceIds)),
      tx
        .select({ id: schema.ThreadEntityLink.id, threadId: schema.ThreadEntityLink.threadId })
        .from(schema.ThreadEntityLink)
        .where(inArray(schema.ThreadEntityLink.threadId, sourceIds)),
      tx
        .select({
          threadId: schema.LabelsOnThread.threadId,
          labelId: schema.LabelsOnThread.labelId,
        })
        .from(schema.LabelsOnThread)
        .where(inArray(schema.LabelsOnThread.threadId, sourceIds)),
      tx
        .select({ id: schema.FieldValue.id, threadId: schema.FieldValue.entityId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.entityDefinitionId, 'thread'),
            inArray(schema.FieldValue.entityId, sourceIds)
          )
        ),
      tx
        .select({
          id: schema.Event.id,
          threadId: sql<string>`${schema.Event.data} ->> 'threadId'`.as('threadId'),
        })
        .from(schema.Event)
        .where(sql`${schema.Event.data} ->> 'threadId' IN (${sourceIdsSql})`),
      tx
        .select({
          id: schema.CommentReference.id,
          threadId: schema.CommentReference.entityInstanceId,
        })
        .from(schema.CommentReference)
        .where(
          and(
            eq(schema.CommentReference.entityDefinitionId, 'thread'),
            inArray(schema.CommentReference.entityInstanceId, sourceIds)
          )
        ),
    ])

    const snapshots = new Map<string, PerSourceMoveSnapshot>()
    for (const src of sources) {
      snapshots.set(src.id, {
        sourceThreadId: src.id,
        movedMessageIds: [],
        movedCommentIds: [],
        movedDraftIds: [],
        movedScheduledMessageIds: [],
        movedAiSuggestionIds: [],
        movedReadStatusIds: [],
        movedParticipantIds: [],
        movedEntityLinkIds: [],
        movedLabelIds: [],
        movedFieldValueIds: [],
        movedEventIds: [],
        movedCommentReferenceIds: [],
        sourceSubject: src.subject,
        previousStatus: src.status,
        previousAssigneeId: src.assigneeId,
        previousInboxId: src.inboxId,
        previousPrimaryEntityInstanceId: src.primaryEntityInstanceId,
        previousPrimaryEntityDefinitionId: src.primaryEntityDefinitionId,
      })
    }

    const bucket = <Row extends { threadId: string | null }>(
      rows: Row[],
      key: keyof PerSourceMoveSnapshot,
      pick: (row: Row) => string
    ) => {
      for (const row of rows) {
        if (!row.threadId) continue
        const snap = snapshots.get(row.threadId)
        if (!snap) continue
        ;(snap[key] as string[]).push(pick(row))
      }
    }

    bucket(messages, 'movedMessageIds', (r) => r.id)
    bucket(comments, 'movedCommentIds', (r) => r.id)
    bucket(drafts, 'movedDraftIds', (r) => r.id)
    bucket(scheduled, 'movedScheduledMessageIds', (r) => r.id)
    bucket(suggestions, 'movedAiSuggestionIds', (r) => r.id)
    bucket(reads, 'movedReadStatusIds', (r) => r.id)
    bucket(participants, 'movedParticipantIds', (r) => r.id)
    bucket(links, 'movedEntityLinkIds', (r) => r.id)
    bucket(labels, 'movedLabelIds', (r) => r.labelId)
    bucket(fieldValues, 'movedFieldValueIds', (r) => r.id)
    bucket(events, 'movedEventIds', (r) => r.id)
    bucket(refs, 'movedCommentReferenceIds', (r) => r.id)

    // biome-ignore lint/style/noNonNullAssertion: snapshots populated for every source above
    return sources.map((s) => snapshots.get(s.id)!)
  }

  private async moveAll(
    tx: Transaction,
    sourceIds: string[],
    targetId: string,
    presence: MovePresence
  ): Promise<void> {
    const sourceIdsSql = sql.join(
      sourceIds.map((id) => sql`${id}`),
      sql.raw(', ')
    )

    if (presence.messages) {
      await tx
        .update(schema.Message)
        .set({ threadId: targetId })
        .where(inArray(schema.Message.threadId, sourceIds))
    }

    if (presence.comments) {
      await tx
        .update(schema.Comment)
        .set({ entityId: targetId })
        .where(
          and(
            eq(schema.Comment.entityDefinitionId, 'thread'),
            inArray(schema.Comment.entityId, sourceIds)
          )
        )
    }

    if (presence.commentReferences) {
      await tx
        .update(schema.CommentReference)
        .set({ entityInstanceId: targetId })
        .where(
          and(
            eq(schema.CommentReference.entityDefinitionId, 'thread'),
            inArray(schema.CommentReference.entityInstanceId, sourceIds)
          )
        )
    }

    // ThreadReadStatus: unique on (threadId, userId). Roll the latest
    // lastReadAt forward onto the target row (across both the target and any
    // source row for the same user), then drop the source rows that would
    // collide. Across multiple sources, keep the row with the latest
    // lastReadAt (lowest id breaks ties) so the survivor carries the freshest
    // state when it's repointed to the target.
    if (presence.readStatus) {
      await tx.execute(sql`
        UPDATE "ThreadReadStatus" t
        SET "lastReadAt" = GREATEST(t."lastReadAt", s.max_last_read)
        FROM (
          SELECT "userId", MAX("lastReadAt") AS max_last_read
          FROM "ThreadReadStatus"
          WHERE "threadId" IN (${sourceIdsSql})
          GROUP BY "userId"
        ) s
        WHERE t."threadId" = ${targetId}
          AND t."userId" = s."userId"
      `)
      await tx.execute(sql`
        DELETE FROM "ThreadReadStatus" s
        USING "ThreadReadStatus" t
        WHERE s."threadId" IN (${sourceIdsSql})
          AND t."threadId" = ${targetId}
          AND s."userId" = t."userId"
      `)
      await tx.execute(sql`
        DELETE FROM "ThreadReadStatus" a
        USING "ThreadReadStatus" b
        WHERE a."threadId" IN (${sourceIdsSql})
          AND b."threadId" IN (${sourceIdsSql})
          AND a."userId" = b."userId"
          AND (
            COALESCE(a."lastReadAt", to_timestamp(0)) < COALESCE(b."lastReadAt", to_timestamp(0))
            OR (
              COALESCE(a."lastReadAt", to_timestamp(0)) = COALESCE(b."lastReadAt", to_timestamp(0))
              AND a.id > b.id
            )
          )
      `)
      await tx
        .update(schema.ThreadReadStatus)
        .set({ threadId: targetId })
        .where(inArray(schema.ThreadReadStatus.threadId, sourceIds))
    }

    // ThreadParticipant: unique on (threadId, email). Aggregate every source
    // participant by email into a single target row in one upsert (sum
    // messageCount, min firstMessageAt, max lastMessageAt, OR isInternal),
    // folding into the existing target row on conflict. gen_random_uuid for
    // the id of net-new target rows; the inserted row sits on `targetId`, so
    // the follow-up DELETE on sourceIds won't touch it.
    if (presence.participants) {
      await tx.execute(sql`
        INSERT INTO "ThreadParticipant" (
          id, "threadId", "email", "name", "isInternal",
          "messageCount", "firstMessageAt", "lastMessageAt"
        )
        SELECT
          gen_random_uuid()::text,
          ${targetId},
          "email",
          (array_agg("name") FILTER (WHERE "name" IS NOT NULL))[1],
          BOOL_OR("isInternal"),
          SUM("messageCount")::int,
          MIN("firstMessageAt"),
          MAX("lastMessageAt")
        FROM "ThreadParticipant"
        WHERE "threadId" IN (${sourceIdsSql})
        GROUP BY "email"
        ON CONFLICT ("threadId", "email") DO UPDATE SET
          "name" = COALESCE("ThreadParticipant"."name", EXCLUDED."name"),
          "isInternal" = "ThreadParticipant"."isInternal" OR EXCLUDED."isInternal",
          "messageCount" = "ThreadParticipant"."messageCount" + EXCLUDED."messageCount",
          "firstMessageAt" = LEAST("ThreadParticipant"."firstMessageAt", EXCLUDED."firstMessageAt"),
          "lastMessageAt" = GREATEST("ThreadParticipant"."lastMessageAt", EXCLUDED."lastMessageAt")
      `)
      await tx
        .delete(schema.ThreadParticipant)
        .where(inArray(schema.ThreadParticipant.threadId, sourceIds))
    }

    if (presence.drafts) {
      await tx
        .update(schema.Draft)
        .set({ threadId: targetId })
        .where(inArray(schema.Draft.threadId, sourceIds))
    }

    if (presence.scheduled) {
      await tx
        .update(schema.ScheduledMessage)
        .set({ threadId: targetId })
        .where(inArray(schema.ScheduledMessage.threadId, sourceIds))
    }

    if (presence.aiSuggestions) {
      await tx
        .update(schema.AiSuggestion)
        .set({ threadId: targetId })
        .where(inArray(schema.AiSuggestion.threadId, sourceIds))
    }

    // ThreadEntityLink: partial unique on (threadId, entityInstanceId)
    // WHERE unlinkedAt IS NULL — only active rows can collide.
    if (presence.entityLinks) {
      await tx.execute(sql`
        DELETE FROM "ThreadEntityLink" s
        USING "ThreadEntityLink" t
        WHERE s."threadId" IN (${sourceIdsSql})
          AND t."threadId" = ${targetId}
          AND s."entityInstanceId" = t."entityInstanceId"
          AND s."unlinkedAt" IS NULL
          AND t."unlinkedAt" IS NULL
      `)
      await tx.execute(sql`
        DELETE FROM "ThreadEntityLink" a
        USING "ThreadEntityLink" b
        WHERE a."threadId" IN (${sourceIdsSql})
          AND b."threadId" IN (${sourceIdsSql})
          AND a."entityInstanceId" = b."entityInstanceId"
          AND a."unlinkedAt" IS NULL
          AND b."unlinkedAt" IS NULL
          AND a.id > b.id
      `)
      await tx
        .update(schema.ThreadEntityLink)
        .set({ threadId: targetId })
        .where(inArray(schema.ThreadEntityLink.threadId, sourceIds))
    }

    // FieldValue: rebind the entityId for any 'thread' scoped values.
    if (presence.fieldValues) {
      await tx
        .update(schema.FieldValue)
        .set({ entityId: targetId })
        .where(
          and(
            eq(schema.FieldValue.entityDefinitionId, 'thread'),
            inArray(schema.FieldValue.entityId, sourceIds)
          )
        )
    }

    // Labels: union into target via ON CONFLICT, then drop source rows.
    if (presence.labels) {
      await tx.execute(sql`
        INSERT INTO "LabelsOnThread" ("threadId", "labelId")
        SELECT ${targetId}, "labelId"
        FROM "LabelsOnThread"
        WHERE "threadId" IN (${sourceIdsSql})
        ON CONFLICT DO NOTHING
      `)
      await tx
        .delete(schema.LabelsOnThread)
        .where(inArray(schema.LabelsOnThread.threadId, sourceIds))
    }

    // Event rows reference threadId only inside the JSON `data` blob — repoint there.
    if (presence.events) {
      await tx.execute(sql`
        UPDATE "Event"
        SET "data" = jsonb_set("data", '{threadId}', to_jsonb(${targetId}::text), false)
        WHERE "data" ->> 'threadId' IN (${sourceIdsSql})
      `)
    }
  }

  private async dedupeAiSuggestions(tx: Transaction, targetId: string): Promise<void> {
    // Keep the FRESH bundle with the latest computedForActivityAt; mark the rest STALE.
    await tx.execute(sql`
      UPDATE "AiSuggestion"
      SET status = 'STALE'
      WHERE "threadId" = ${targetId}
        AND status = 'FRESH'
        AND id NOT IN (
          SELECT id FROM "AiSuggestion"
          WHERE "threadId" = ${targetId} AND status = 'FRESH'
          ORDER BY "computedForActivityAt" DESC NULLS LAST, id DESC
          LIMIT 1
        )
    `)
  }

  private async resolveScalarConflicts(
    tx: Transaction,
    target: ThreadEntity,
    sources: ThreadEntity[]
  ): Promise<Record<string, Record<string, { from: unknown; to: unknown }>>> {
    const updates: Record<string, unknown> = {}
    const perSourceOverrides: Record<string, Record<string, { from: unknown; to: unknown }>> = {}

    // Target wins for scalars; fall back to earliest source with a non-null value.
    if (target.assigneeId === null) {
      const fallback = sources.find((s) => s.assigneeId)
      if (fallback?.assigneeId) updates.assigneeId = fallback.assigneeId
    }
    if (target.primaryEntityInstanceId === null) {
      const fallback = sources.find((s) => s.primaryEntityInstanceId)
      if (fallback?.primaryEntityInstanceId) {
        updates.primaryEntityInstanceId = fallback.primaryEntityInstanceId
        updates.primaryEntityDefinitionId = fallback.primaryEntityDefinitionId
      }
    }

    // Record what each source had to lose so the timeline event can show "we kept X over Y".
    for (const src of sources) {
      const overrides: Record<string, { from: unknown; to: unknown }> = {}
      if (src.assigneeId && target.assigneeId && src.assigneeId !== target.assigneeId) {
        overrides.assigneeId = { from: src.assigneeId, to: target.assigneeId }
      }
      if (src.status !== target.status) {
        overrides.status = { from: src.status, to: target.status }
      }
      if (src.inboxId && target.inboxId && src.inboxId !== target.inboxId) {
        overrides.inboxId = { from: src.inboxId, to: target.inboxId }
      }
      if (Object.keys(overrides).length > 0) {
        perSourceOverrides[src.id] = overrides
      }
    }

    if (Object.keys(updates).length > 0) {
      await tx.update(schema.Thread).set(updates).where(eq(schema.Thread.id, target.id))
    }
    return perSourceOverrides
  }

  private async insertMergeEvents(
    tx: Transaction,
    args: {
      batchId: string
      targetThreadId: string
      snapshots: PerSourceMoveSnapshot[]
      actorUserId: string
      occurredAt: Date
      scalarOverrides: Record<string, Record<string, { from: unknown; to: unknown }>>
    }
  ): Promise<void> {
    const { batchId, targetThreadId, snapshots, actorUserId, occurredAt, scalarOverrides } = args
    if (snapshots.length === 0) return

    const rows = snapshots.flatMap((source) => {
      const baseData = {
        batchId,
        sourceSubject: source.sourceSubject,
        movedMessageCount: source.movedMessageIds.length,
        movedCommentCount: source.movedCommentIds.length,
        movedMessageIds: source.movedMessageIds,
        movedCommentIds: source.movedCommentIds,
        movedCommentReferenceIds: source.movedCommentReferenceIds,
        movedDraftIds: source.movedDraftIds,
        movedScheduledMessageIds: source.movedScheduledMessageIds,
        movedAiSuggestionIds: source.movedAiSuggestionIds,
        movedReadStatusIds: source.movedReadStatusIds,
        movedParticipantIds: source.movedParticipantIds,
        movedEntityLinkIds: source.movedEntityLinkIds,
        movedLabelIds: source.movedLabelIds,
        movedFieldValueIds: source.movedFieldValueIds,
        movedEventIds: source.movedEventIds,
        previousStatus: source.previousStatus,
        previousAssigneeId: source.previousAssigneeId,
        previousInboxId: source.previousInboxId,
        previousPrimaryEntityInstanceId: source.previousPrimaryEntityInstanceId,
        previousPrimaryEntityDefinitionId: source.previousPrimaryEntityDefinitionId,
        overriddenFieldChanges: scalarOverrides[source.sourceThreadId] ?? {},
      }
      return [
        {
          eventType: ThreadEventType.MERGED_INTO,
          startedAt: occurredAt,
          entityType: TimelineEntityType.THREAD,
          entityId: source.sourceThreadId,
          relatedEntityType: TimelineEntityType.THREAD,
          relatedEntityId: targetThreadId,
          actorType: TimelineActorType.USER,
          actorId: actorUserId,
          eventData: baseData,
          organizationId: this.organizationId,
          updatedAt: occurredAt,
        },
        {
          eventType: ThreadEventType.MERGED_FROM,
          startedAt: occurredAt,
          entityType: TimelineEntityType.THREAD,
          entityId: targetThreadId,
          relatedEntityType: TimelineEntityType.THREAD,
          relatedEntityId: source.sourceThreadId,
          actorType: TimelineActorType.USER,
          actorId: actorUserId,
          eventData: baseData,
          organizationId: this.organizationId,
          updatedAt: occurredAt,
        },
      ]
    })

    await tx.insert(schema.TimelineEvent).values(rows)
  }

  private async loadSourceForUnmerge(tx: Transaction, sourceId: string): Promise<ThreadEntity> {
    const [src] = await tx
      .select()
      .from(schema.Thread)
      .where(
        and(eq(schema.Thread.id, sourceId), eq(schema.Thread.organizationId, this.organizationId))
      )
      .for('update')
    if (!src) {
      throw new NotFoundError(`Source thread ${sourceId} not found`)
    }
    if (!src.mergedAt || !src.mergedIntoThreadId) {
      throw new ConflictError('Source thread is not merged')
    }
    if (src.mergedAt.getTime() + UNMERGE_TTL_MS < Date.now()) {
      throw new ConflictError('Unmerge window has expired')
    }
    return src
  }

  private async loadMergedIntoEvent(
    tx: Transaction,
    sourceId: string
  ): Promise<{ eventData: unknown }> {
    const [event] = await tx
      .select({ eventData: schema.TimelineEvent.eventData })
      .from(schema.TimelineEvent)
      .where(
        and(
          eq(schema.TimelineEvent.organizationId, this.organizationId),
          eq(schema.TimelineEvent.entityType, TimelineEntityType.THREAD),
          eq(schema.TimelineEvent.entityId, sourceId),
          eq(schema.TimelineEvent.eventType, ThreadEventType.MERGED_INTO)
        )
      )
      .orderBy(sql`${schema.TimelineEvent.startedAt} DESC`)
      .limit(1)
    if (!event) {
      throw new ConflictError('Missing merge event — cannot unmerge')
    }
    return event
  }

  private async reverseSourceMoves(
    tx: Transaction,
    sourceId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const ids = (key: string): string[] => {
      const v = data[key]
      return Array.isArray(v) ? (v as string[]) : []
    }

    const messageIds = ids('movedMessageIds')
    if (messageIds.length > 0) {
      await tx
        .update(schema.Message)
        .set({ threadId: sourceId })
        .where(inArray(schema.Message.id, messageIds))
    }

    const commentIds = ids('movedCommentIds')
    if (commentIds.length > 0) {
      await tx
        .update(schema.Comment)
        .set({ entityId: sourceId })
        .where(
          and(
            inArray(schema.Comment.id, commentIds),
            eq(schema.Comment.entityDefinitionId, 'thread')
          )
        )
    }

    const refIds = ids('movedCommentReferenceIds')
    if (refIds.length > 0) {
      await tx
        .update(schema.CommentReference)
        .set({ entityInstanceId: sourceId })
        .where(
          and(
            inArray(schema.CommentReference.id, refIds),
            eq(schema.CommentReference.entityDefinitionId, 'thread')
          )
        )
    }

    const draftIds = ids('movedDraftIds')
    if (draftIds.length > 0) {
      await tx
        .update(schema.Draft)
        .set({ threadId: sourceId })
        .where(inArray(schema.Draft.id, draftIds))
    }

    const scheduledIds = ids('movedScheduledMessageIds')
    if (scheduledIds.length > 0) {
      await tx
        .update(schema.ScheduledMessage)
        .set({ threadId: sourceId })
        .where(inArray(schema.ScheduledMessage.id, scheduledIds))
    }

    const suggestionIds = ids('movedAiSuggestionIds')
    if (suggestionIds.length > 0) {
      await tx
        .update(schema.AiSuggestion)
        .set({ threadId: sourceId })
        .where(inArray(schema.AiSuggestion.id, suggestionIds))
    }

    const readIds = ids('movedReadStatusIds')
    if (readIds.length > 0) {
      // dedupe pass may have dropped some rows; the survivors carry the highest
      // lastReadAt for each user. Best-effort restore the surviving rows.
      await tx
        .update(schema.ThreadReadStatus)
        .set({ threadId: sourceId })
        .where(inArray(schema.ThreadReadStatus.id, readIds))
    }

    const participantIds = ids('movedParticipantIds')
    if (participantIds.length > 0) {
      await tx
        .update(schema.ThreadParticipant)
        .set({ threadId: sourceId })
        .where(inArray(schema.ThreadParticipant.id, participantIds))
    }

    const entityLinkIds = ids('movedEntityLinkIds')
    if (entityLinkIds.length > 0) {
      await tx
        .update(schema.ThreadEntityLink)
        .set({ threadId: sourceId })
        .where(inArray(schema.ThreadEntityLink.id, entityLinkIds))
    }

    const fieldValueIds = ids('movedFieldValueIds')
    if (fieldValueIds.length > 0) {
      await tx
        .update(schema.FieldValue)
        .set({ entityId: sourceId })
        .where(inArray(schema.FieldValue.id, fieldValueIds))
    }

    const labelIds = ids('movedLabelIds')
    if (labelIds.length > 0) {
      // Restore label rows on the source; ON CONFLICT keeps idempotency.
      for (const labelId of labelIds) {
        await tx.execute(sql`
          INSERT INTO "LabelsOnThread" ("threadId", "labelId")
          VALUES (${sourceId}, ${labelId})
          ON CONFLICT DO NOTHING
        `)
      }
    }

    const eventIds = ids('movedEventIds')
    if (eventIds.length > 0) {
      const eventIdsSql = sql.join(
        eventIds.map((id) => sql`${id}`),
        sql.raw(', ')
      )
      await tx.execute(sql`
        UPDATE "Event"
        SET "data" = jsonb_set("data", '{threadId}', to_jsonb(${sourceId}::text), false)
        WHERE id IN (${eventIdsSql})
      `)
    }
  }

  private async recomputeTargetMetadata(tx: Transaction, threadId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE "Thread" t
      SET
        "messageCount" = COALESCE((
          SELECT COUNT(*)
          FROM "Message"
          WHERE "threadId" = ${threadId} AND "sentAt" IS NOT NULL
        ), 0),
        "firstMessageAt" = (
          SELECT MIN("sentAt") FROM "Message"
          WHERE "threadId" = ${threadId} AND "sentAt" IS NOT NULL
        ),
        "lastMessageAt" = (
          SELECT MAX("sentAt") FROM "Message"
          WHERE "threadId" = ${threadId} AND "sentAt" IS NOT NULL
        ),
        "latestMessageId" = (
          SELECT id FROM "Message"
          WHERE "threadId" = ${threadId}
          ORDER BY "receivedAt" DESC NULLS LAST,
                   "sentAt" DESC NULLS LAST,
                   id DESC
          LIMIT 1
        ),
        "latestCommentId" = (
          SELECT id FROM "Comment"
          WHERE "entityId" = ${threadId}
            AND "entityDefinitionId" = 'thread'
            AND "deletedAt" IS NULL
          ORDER BY "createdAt" DESC, id DESC
          LIMIT 1
        ),
        "participantCount" = COALESCE((
          SELECT COUNT(*) FROM "ThreadParticipant"
          WHERE "threadId" = ${threadId}
        ), 0)
      WHERE t.id = ${threadId}
    `)
  }
}
