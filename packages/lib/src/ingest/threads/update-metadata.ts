// packages/lib/src/ingest/threads/update-metadata.ts

import { schema } from '@auxx/database'
import { eq, sql } from 'drizzle-orm'
import { getRealtimeService, publishThreadUpdated } from '../../realtime'
import type { IngestContext } from '../context'

/**
 * Single-query recompute of Thread.messageCount / firstMessageAt / lastMessageAt
 * / latestMessageId / participantCount for a thread. Non-critical — errors are
 * logged and swallowed so ingest can continue.
 *
 * After the recompute, re-reads the affected columns and publishes a
 * `thread:updated` patch on the inbox channel so other tabs see the metadata
 * change without waiting for a refetch. During a sync batch the publish is
 * suppressed — the orchestrator's `inbox:syncCompleted` event causes the FE
 * to refresh the thread list (and lazily reload thread metadata) at the end.
 */
export async function updateThreadMetadataEfficient(
  ctx: IngestContext,
  threadId: string
): Promise<void> {
  try {
    await ctx.db.execute(sql`
      UPDATE "Thread" t
      SET
        "messageCount" = COALESCE((
          SELECT COUNT(*)
          FROM "Message"
          WHERE "threadId" = ${threadId}
            AND "sentAt" IS NOT NULL
        ), 0),
        "firstMessageAt" = (
          SELECT MIN("sentAt")
          FROM "Message"
          WHERE "threadId" = ${threadId}
            AND "sentAt" IS NOT NULL
        ),
        "lastMessageAt" = (
          SELECT MAX("sentAt")
          FROM "Message"
          WHERE "threadId" = ${threadId}
            AND "sentAt" IS NOT NULL
        ),
        "latestMessageId" = (
          SELECT id
          FROM "Message"
          WHERE "threadId" = ${threadId}
          ORDER BY "receivedAt" DESC NULLS LAST,
                   "sentAt" DESC NULLS LAST,
                   id DESC
          LIMIT 1
        ),
        "participantCount" = COALESCE((
          SELECT COUNT(DISTINCT "participantId")
          FROM "MessageParticipant" mp
          JOIN "Message" m ON mp."messageId" = m.id
          WHERE m."threadId" = ${threadId}
            AND mp."participantId" IS NOT NULL
        ), 0)
      WHERE t.id = ${threadId}
    `)
    ctx.logger.debug('Efficiently updated thread metadata', { threadId })

    const [row] = await ctx.db
      .select({
        inboxId: schema.Thread.inboxId,
        messageCount: schema.Thread.messageCount,
        participantCount: schema.Thread.participantCount,
        firstMessageAt: schema.Thread.firstMessageAt,
        lastMessageAt: schema.Thread.lastMessageAt,
        latestMessageId: schema.Thread.latestMessageId,
      })
      .from(schema.Thread)
      .where(eq(schema.Thread.id, threadId))
      .limit(1)

    if (!row) return

    const patch = {
      messageCount: row.messageCount ?? undefined,
      participantCount: row.participantCount ?? undefined,
      firstMessageAt: row.firstMessageAt ? row.firstMessageAt.toISOString() : null,
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      latestMessageId: row.latestMessageId ?? null,
    }

    if (ctx.inSyncBatch) {
      ctx.touchedInboxIds.add(row.inboxId ?? null)
      return
    }

    await publishThreadUpdated(
      getRealtimeService(),
      ctx.organizationId,
      {
        threadId,
        inboxId: row.inboxId ?? null,
        patch,
      },
      { excludeSocketId: ctx.socketId }
    )
  } catch (error) {
    ctx.logger.error('Failed to update thread metadata efficiently', { threadId, error })
  }
}
