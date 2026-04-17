// packages/lib/src/ingest/delete-messages.ts

import { schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
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

  await ctx.db.delete(schema.Message).where(inArray(schema.Message.id, messageIds))

  ctx.logger.info('Deleted messages by external IDs', {
    integrationId: args.integrationId,
    deletedCount: messageIds.length,
    affectedThreads: affectedThreadIds.length,
  })

  for (const threadId of affectedThreadIds) {
    if (!threadId) continue

    const [remaining] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.Message)
      .where(eq(schema.Message.threadId, threadId))

    if (remaining.count === 0) {
      await ctx.db.delete(schema.Thread).where(eq(schema.Thread.id, threadId))
      ctx.logger.debug('Deleted empty thread after message removal', { threadId })
    } else {
      await updateThreadMetadataEfficient(ctx, threadId)
    }
  }

  return messageIds.length
}
