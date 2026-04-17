// packages/lib/src/ingest/threads/get.ts

import type { MessageEntity as Message, ThreadEntity as Thread } from '@auxx/database/types'
import type { IngestContext } from '../context'

/**
 * Load all messages in a thread with participant details. Used by the
 * web app to render a thread view — order by sentAt ascending.
 */
export async function getThreadMessages(ctx: IngestContext, threadId: string): Promise<Message[]> {
  try {
    const messages = await ctx.db.query.Message.findMany({
      where: (messages, { eq }) => eq(messages.threadId, threadId),
      orderBy: (messages, { asc }) => [asc(messages.sentAt)],
      with: {
        from: true,
        replyTo: true,
        participants: {
          orderBy: (participants, { asc }) => [asc(participants.role)],
          with: { participant: true },
        },
        attachments: true,
      },
    })
    return messages as Message[]
  } catch (error) {
    ctx.logger.error('Error getting thread messages:', { error, threadId })
    throw error
  }
}

/** Fetch a single thread scoped to an organization, with minimal relations. */
export async function getThread(
  ctx: IngestContext,
  args: { threadId: string; organizationId: string }
): Promise<Thread | null> {
  try {
    const thread = await ctx.db.query.Thread.findFirst({
      where: (threads, { and, eq }) =>
        and(eq(threads.id, args.threadId), eq(threads.organizationId, args.organizationId)),
      with: {
        labels: { with: { label: true } },
        assignee: true,
        integration: true,
        messages: {
          orderBy: (messages, { desc }) => [desc(messages.sentAt)],
          limit: 1,
          with: { from: true },
        },
      },
    })
    return thread as Thread | null
  } catch (error) {
    ctx.logger.error('Error getting thread:', { error, threadId: args.threadId })
    throw error
  }
}
