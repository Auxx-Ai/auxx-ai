// packages/lib/src/ingest/archive-messages.ts

import { schema } from '@auxx/database'
import { ThreadStatus } from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { SYSTEM_VISIBILITY } from '../permissions/visibility/context'
import { ThreadMutationService } from '../threads/thread-mutation.service'
import type { ThreadStatus as MailThreadStatus } from '../threads/types'
import { UnreadService } from '../threads/unread-service'
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
 * Core of the Gmail-label → thread-status bridge for personal channels: flip
 * threads currently in one of `from` statuses to `to`. Label events are
 * thread-level actions here — messages are kept, unlike the shared-channel
 * archive-deletes path. Routes through {@link ThreadMutationService} (SYSTEM
 * viewer, `origin: 'provider-sync'`) so realtime + count deltas fire but
 * nothing is pushed back to the provider (loop guard).
 *
 * Returns the number of threads updated.
 */
async function setThreadStatusByMessageExternalIds(
  ctx: IngestContext,
  args: {
    integrationId: string
    externalIds: string[]
    from: MailThreadStatus[]
    to: MailThreadStatus
  }
): Promise<number> {
  const threadIds = await resolveThreadIds(ctx, args.integrationId, args.externalIds)
  if (threadIds.length === 0) return 0

  const matching = await ctx.db
    .select({ id: schema.Thread.id })
    .from(schema.Thread)
    .where(and(inArray(schema.Thread.id, threadIds), inArray(schema.Thread.status, args.from)))
  if (matching.length === 0) return 0

  const svc = new ThreadMutationService(
    ctx.organizationId,
    ctx.db,
    ctx.socketId,
    undefined,
    SYSTEM_VISIBILITY,
    { origin: 'provider-sync' }
  )
  for (const t of matching) {
    await svc.update(toRecordId('thread', t.id), { status: args.to })
  }
  ctx.logger.info('Updated thread status from Gmail label event', {
    integrationId: args.integrationId,
    to: args.to,
    updatedCount: matching.length,
  })
  return matching.length
}

/**
 * Mark threads ARCHIVED (our "Done" state) for personal-channel messages whose
 * Gmail INBOX label was removed. Only flips threads currently OPEN — leaves
 * TRASH/SPAM/already-Done untouched.
 */
export async function archiveThreadsByMessageExternalIds(
  ctx: IngestContext,
  args: { integrationId: string; externalIds: string[] }
): Promise<number> {
  return setThreadStatusByMessageExternalIds(ctx, {
    ...args,
    from: [ThreadStatus.OPEN],
    to: 'ARCHIVED',
  })
}

/**
 * Reopen personal-channel threads when a message's Gmail INBOX label is
 * (re)added — the inverse of {@link archiveThreadsByMessageExternalIds}. Also
 * covers Gmail-side untrash / not-spam: Gmail restores the prior labels, so
 * the INBOX add is the signal we see.
 */
export async function reopenThreadsByMessageExternalIds(
  ctx: IngestContext,
  args: { integrationId: string; externalIds: string[] }
): Promise<number> {
  return setThreadStatusByMessageExternalIds(ctx, {
    ...args,
    from: [ThreadStatus.ARCHIVED, ThreadStatus.TRASH, ThreadStatus.SPAM],
    to: 'OPEN',
  })
}

/** Gmail-side trash (TRASH label added) → thread TRASH, personal channels. */
export async function trashThreadsByMessageExternalIds(
  ctx: IngestContext,
  args: { integrationId: string; externalIds: string[] }
): Promise<number> {
  return setThreadStatusByMessageExternalIds(ctx, {
    ...args,
    from: [ThreadStatus.OPEN, ThreadStatus.ARCHIVED],
    to: 'TRASH',
  })
}

/** Gmail-side spam (SPAM label added) → thread SPAM, personal channels. */
export async function markThreadsSpamByMessageExternalIds(
  ctx: IngestContext,
  args: { integrationId: string; externalIds: string[] }
): Promise<number> {
  return setThreadStatusByMessageExternalIds(ctx, {
    ...args,
    from: [ThreadStatus.OPEN, ThreadStatus.ARCHIVED],
    to: 'SPAM',
  })
}

/**
 * Mirror Gmail UNREAD label events onto the mailbox owner's read state for
 * personal-channel threads. Routes through {@link UnreadService} with
 * `origin: 'provider-sync'` so counts + realtime fire but nothing is pushed
 * back to Gmail (loop guard).
 *
 * Returns the number of threads updated.
 */
export async function setThreadReadStateByMessageExternalIds(
  ctx: IngestContext,
  args: { integrationId: string; externalIds: string[]; isRead: boolean; ownerUserId: string }
): Promise<number> {
  const threadIds = await resolveThreadIds(ctx, args.integrationId, args.externalIds)
  if (threadIds.length === 0) return 0

  const svc = new UnreadService(
    ctx.organizationId,
    args.ownerUserId,
    SYSTEM_VISIBILITY,
    ctx.socketId,
    { origin: 'provider-sync' }
  )
  await svc.setReadStatus(threadIds, args.isRead, args.ownerUserId)
  ctx.logger.info('Updated thread read state from Gmail UNREAD-label event', {
    integrationId: args.integrationId,
    isRead: args.isRead,
    threadCount: threadIds.length,
  })
  return threadIds.length
}
