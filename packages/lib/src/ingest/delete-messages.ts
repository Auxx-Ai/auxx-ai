// packages/lib/src/ingest/delete-messages.ts

import { schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getRealtimeService, publishMessageDeleted, publishThreadDeleted } from '../realtime'
import type { IngestContext } from './context'
import { updateThreadMetadataEfficient } from './threads/update-metadata'

/**
 * Delete messages by provider external IDs (scoped to an integration).
 * Cascades handle MessageParticipant; thread metadata is recomputed for
 * any affected threads, and empty threads are removed.
 *
 * Returns the number of messages deleted.
 */
export async function deleteMessagesByExternalIds(
  ctx: IngestContext,
  args: { integrationId: string; externalIds: string[] }
): Promise<number> {
  if (args.externalIds.length === 0) return 0

  const messages = await ctx.db
    .select({ id: schema.Message.id, threadId: schema.Message.threadId })
    .from(schema.Message)
    .where(
      and(
        eq(schema.Message.integrationId, args.integrationId),
        inArray(schema.Message.externalId, args.externalIds)
      )
    )

  if (messages.length === 0) return 0

  const messageIds = messages.map((m) => m.id)
  const affectedThreadIds = [...new Set(messages.map((m) => m.threadId).filter(Boolean))]

  // Capture inboxIds before delete so we can route realtime events.
  const threadInboxRows = affectedThreadIds.length
    ? await ctx.db
        .select({ id: schema.Thread.id, inboxId: schema.Thread.inboxId })
        .from(schema.Thread)
        .where(inArray(schema.Thread.id, affectedThreadIds as string[]))
    : []
  const inboxIdByThread = new Map<string, string | null>()
  for (const row of threadInboxRows) {
    inboxIdByThread.set(row.id, row.inboxId ?? null)
  }

  await ctx.db.delete(schema.Message).where(inArray(schema.Message.id, messageIds))

  ctx.logger.info('Deleted messages by external IDs', {
    integrationId: args.integrationId,
    deletedCount: messageIds.length,
    affectedThreads: affectedThreadIds.length,
  })

  const realtime = getRealtimeService()

  // Publish message:deleted for each removed message. During a sync batch,
  // suppress per-message events and just mark affected inboxes as touched —
  // the orchestrator's `inbox:syncCompleted` triggers a thread-list refresh
  // at the end of the batch instead.
  if (ctx.inSyncBatch) {
    for (const msg of messages) {
      if (!msg.threadId) continue
      ctx.touchedInboxIds.add(inboxIdByThread.get(msg.threadId) ?? null)
    }
  } else {
    for (const msg of messages) {
      if (!msg.threadId) continue
      await publishMessageDeleted(
        realtime,
        ctx.organizationId,
        {
          messageId: msg.id,
          threadId: msg.threadId,
          inboxId: inboxIdByThread.get(msg.threadId) ?? null,
        },
        { excludeSocketId: ctx.socketId }
      )
    }
  }

  for (const threadId of affectedThreadIds) {
    if (!threadId) continue

    const [remaining] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.Message)
      .where(eq(schema.Message.threadId, threadId))

    if (remaining.count === 0) {
      await ctx.db.delete(schema.Thread).where(eq(schema.Thread.id, threadId))
      ctx.logger.debug('Deleted empty thread after message removal', { threadId })

      const inboxId = inboxIdByThread.get(threadId) ?? null
      if (ctx.inSyncBatch) {
        ctx.touchedInboxIds.add(inboxId)
      } else {
        await publishThreadDeleted(
          realtime,
          ctx.organizationId,
          { threadId, inboxId },
          { excludeSocketId: ctx.socketId }
        )
      }
    } else {
      await updateThreadMetadataEfficient(ctx, threadId)
    }
  }

  return messageIds.length
}
