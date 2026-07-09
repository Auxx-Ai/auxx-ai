// packages/lib/src/ingest/archive-messages.ts

import { schema } from '@auxx/database'
import { ThreadStatus } from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { SYSTEM_VISIBILITY } from '../permissions/visibility/context'
import { ThreadMutationService } from '../threads/thread-mutation.service'
import type { IngestContext } from './context'

/** Distinct thread ids for a set of provider message external ids. */
async function resolveThreadIds(
  ctx: IngestContext,
  integrationId: string,
  externalIds: string[]
): Promise<string[]> {
  if (externalIds.length === 0) return []
  const rows = await ctx.db
    .select({ threadId: schema.Message.threadId })
    .from(schema.Message)
    .where(
      and(
        eq(schema.Message.integrationId, integrationId),
        inArray(schema.Message.externalId, externalIds)
      )
    )
  return [...new Set(rows.map((r) => r.threadId).filter((id): id is string => !!id))]
}

/**
 * Mark threads ARCHIVED (our "Done" state) for personal-channel messages whose
 * Gmail INBOX label was removed. Archive is treated as a thread-level action —
 * we don't delete the messages the way shared channels do. Reuses
 * {@link ThreadMutationService} (SYSTEM viewer) so realtime + count deltas fire.
 * Only flips threads currently OPEN — leaves TRASH/SPAM/already-Done untouched.
 *
 * Returns the number of threads archived.
 */
export async function archiveThreadsByMessageExternalIds(
  ctx: IngestContext,
  args: { integrationId: string; externalIds: string[] }
): Promise<number> {
  const threadIds = await resolveThreadIds(ctx, args.integrationId, args.externalIds)
  if (threadIds.length === 0) return 0

  const openThreads = await ctx.db
    .select({ id: schema.Thread.id })
    .from(schema.Thread)
    .where(and(inArray(schema.Thread.id, threadIds), eq(schema.Thread.status, ThreadStatus.OPEN)))
  if (openThreads.length === 0) return 0

  const svc = new ThreadMutationService(
    ctx.organizationId,
    ctx.db,
    ctx.socketId,
    undefined,
    SYSTEM_VISIBILITY
  )
  for (const t of openThreads) {
    await svc.update(toRecordId('thread', t.id), { status: 'ARCHIVED' })
  }
  ctx.logger.info('Archived threads from Gmail INBOX-label removal', {
    integrationId: args.integrationId,
    archivedCount: openThreads.length,
  })
  return openThreads.length
}

/**
 * Reopen ARCHIVED personal-channel threads when a message's Gmail INBOX label
 * is (re)added — the inverse of {@link archiveThreadsByMessageExternalIds}.
 * Only touches threads currently ARCHIVED.
 *
 * Returns the number of threads reopened.
 */
export async function reopenThreadsByMessageExternalIds(
  ctx: IngestContext,
  args: { integrationId: string; externalIds: string[] }
): Promise<number> {
  const threadIds = await resolveThreadIds(ctx, args.integrationId, args.externalIds)
  if (threadIds.length === 0) return 0

  const archivedThreads = await ctx.db
    .select({ id: schema.Thread.id })
    .from(schema.Thread)
    .where(
      and(inArray(schema.Thread.id, threadIds), eq(schema.Thread.status, ThreadStatus.ARCHIVED))
    )
  if (archivedThreads.length === 0) return 0

  const svc = new ThreadMutationService(
    ctx.organizationId,
    ctx.db,
    ctx.socketId,
    undefined,
    SYSTEM_VISIBILITY
  )
  for (const t of archivedThreads) {
    await svc.update(toRecordId('thread', t.id), { status: 'OPEN' })
  }
  ctx.logger.info('Reopened threads from Gmail INBOX-label add', {
    integrationId: args.integrationId,
    reopenedCount: archivedThreads.length,
  })
  return archivedThreads.length
}
