// packages/lib/src/threads/thread-action-access.ts

import type { Database } from '@auxx/database'
import { ForbiddenError } from '../errors'
import type { MailViewer } from '../permissions/visibility/context'
import { isSystemViewer } from '../permissions/visibility/context'
import { getThreadLensBatch } from '../permissions/visibility/thread-lens'

/**
 * The per-thread write gate (mail-permissions §7): **every** target thread must
 * be at `full` lens for the viewer.
 *
 * With plan 40's thread-authority axis dropped (§1.1 / §10 decision 2), this is
 * not merely one check among several — it is the **entirety** of per-thread
 * action authorization. v2 supplies the coarse front door (`inboxes: Read`) and
 * the inbox floor; everything finer is this function. Seeing a thread at `full`
 * lens IS the permission to reply, tag, assign, merge or delete it.
 *
 * Three properties callers depend on, all deliberate:
 *
 *  - **Bulk ops reject partial-visibility sets outright.** No silent partial
 *    apply: if one id in the batch is invisible, nothing is written.
 *  - **Invisible ids fail exactly like nonexistent ones.** `getThreadLensBatch`
 *    resolves an unknown id to `none`, so the error cannot be used as an
 *    existence oracle for another org's threads.
 *  - **It must run BEFORE any other check, and before any mutation is
 *    composed.** That ordering is what makes self-escalation impossible: a
 *    viewer at `metadata` cannot set `assigneeId` to themselves to acquire the
 *    `full` lens that assignment confers (`effective-lens.ts`). Move this below
 *    the payload handling and that hole reopens.
 *
 * SYSTEM viewers skip — ingest, automation, sequences and workflows act as the
 * org and read no member capabilities.
 *
 * Extracted from `ThreadMutationService` (which now delegates here) so the
 * generic **field-value** write path can assert the SAME gate on a thread host
 * rather than re-implementing it — plan 40 §5.5, following the
 * `workflow-run-stop-access.ts` precedent. Two copies of this predicate drifting
 * apart is precisely the bug §5.5 exists to fix.
 */
export async function assertCanActOnThreads(
  db: Database,
  organizationId: string,
  viewer: MailViewer,
  threadIds: string[]
): Promise<void> {
  if (threadIds.length === 0 || isSystemViewer(viewer)) return
  const lenses = await getThreadLensBatch(db, organizationId, viewer, threadIds)
  const blocked = threadIds.filter((id) => lenses.get(id) !== 'full')
  if (blocked.length > 0) {
    throw new ForbiddenError(
      threadIds.length === 1
        ? 'You do not have full access to this thread.'
        : `You do not have full access to ${blocked.length} of the selected threads.`
    )
  }
}
