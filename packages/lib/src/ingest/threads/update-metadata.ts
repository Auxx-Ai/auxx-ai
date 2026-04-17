// packages/lib/src/ingest/threads/update-metadata.ts

import { sql } from 'drizzle-orm'
import type { IngestContext } from '../context'

/**
 * Single-query recompute of Thread.messageCount / firstMessageAt / lastMessageAt
 * / latestMessageId / participantCount for a thread. Non-critical — errors are
 * logged and swallowed so ingest can continue.
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
  } catch (error) {
    ctx.logger.error('Failed to update thread metadata efficiently', { threadId, error })
  }
}
