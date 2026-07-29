// packages/lib/src/email/labels/thread-label-mutations.ts

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { guard } from './guard'
import { createLabelProvider } from './label-provider-factory'
import { requireLabel } from './label-queries'
import type { ThreadLabelParams } from './types'

/**
 * `LabelsOnThread` writes — applying and removing a label on a conversation.
 *
 * These are **mail actions, not channel config**, so the router gates them on the
 * mail authority (`inboxesView` + `assertCanActOnThreads`) rather than
 * `channelsManage`. Nothing in this file checks permissions; the only guards are
 * identity ones — both the label and the thread are resolved org-scoped, which
 * neither operation did before.
 *
 * ## Why these return `Result<void>` and not `boolean`
 *
 * `LabelRepo` wrapped both writes in `try { … } catch { return false }`. That
 * made a FK violation, a dropped connection and "the label is already on the
 * thread" indistinguishable — the router turned all three into
 * `{ success: false }` and the UI could only shrug. Now:
 *
 * - the insert uses `onConflictDoNothing()`, so "already applied" is a genuine
 *   success and needs no error at all;
 * - the delete reports through the `Result`, so a real DB failure surfaces as a
 *   failure instead of being swallowed.
 *
 * A delete that matches no row is intentionally still `ok`: the caller asked for
 * the label to be absent and it is absent.
 */

/** Resolve the thread within the org, or 404. */
async function requireThread(db: Database, organizationId: string, threadId: string) {
  const [thread] = await db
    .select({ id: schema.Thread.id })
    .from(schema.Thread)
    .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
    .limit(1)

  if (!thread) throw new NotFoundError('Thread not found')
  return thread
}

/**
 * Apply a label to a thread in the provider, then record the link.
 *
 * Provider-first for the same reason as `createLabel`: the mailbox is the source
 * of truth, and a link row pointing at a label the provider never applied would
 * be a lie the user can see in Gmail.
 */
export async function addLabelToThread(
  db: Database,
  organizationId: string,
  params: ThreadLabelParams
): Promise<Result<void, Error>> {
  const { labelId, threadId, integrationType, integrationId } = params

  return guard(
    async () => {
      const label = await requireLabel(db, organizationId, labelId)
      await requireThread(db, organizationId, threadId)

      const provider = await createLabelProvider(organizationId, integrationId, integrationType)
      await provider.addLabelToThread(label.labelId, threadId)

      await db.insert(schema.LabelsOnThread).values({ labelId, threadId }).onConflictDoNothing()
    },
    'Error adding label to thread',
    { labelId, threadId }
  )
}

/** Remove a label from a thread in the provider, then drop the link row. */
export async function removeLabelFromThread(
  db: Database,
  organizationId: string,
  params: ThreadLabelParams
): Promise<Result<void, Error>> {
  const { labelId, threadId, integrationType, integrationId } = params

  return guard(
    async () => {
      const label = await requireLabel(db, organizationId, labelId)
      await requireThread(db, organizationId, threadId)

      const provider = await createLabelProvider(organizationId, integrationId, integrationType)
      await provider.removeLabelFromThread(label.labelId, threadId)

      await db
        .delete(schema.LabelsOnThread)
        .where(
          and(
            eq(schema.LabelsOnThread.threadId, threadId),
            eq(schema.LabelsOnThread.labelId, labelId)
          )
        )
    },
    'Error removing label from thread',
    { labelId, threadId }
  )
}
