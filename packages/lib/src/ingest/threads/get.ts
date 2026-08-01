// packages/lib/src/ingest/threads/get.ts

import type { ThreadEntity as Thread } from '@auxx/database/types'
import type { IngestContext } from '../context'

// `getThreadMessages` used to live here. It requested an `attachments` relation
// that `messageRelations` does not declare — attachments moved to the polymorphic
// canonical `Attachment` table keyed by `(entityType, entityId)`, so there is no
// relation to name. Drizzle resolved it to `undefined` and threw
// `Cannot read properties of undefined (reading 'referencedTable')` on every call.
// It had no callers (not even through its `EmailStorage` wrapper), which is why
// nothing ever surfaced it. Deleted rather than repaired. Read message
// attachments via `MessageQueryService` / `MessageAttachmentService`, which query
// `Attachment` joined to `MediaAsset` directly.

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
