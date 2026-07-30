// packages/lib/src/permissions/visibility/thread-lens.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { MailViewer, ThreadVisibilityInput, UserMailVisibility } from './context'
import { isAutomationViewer, isSystemViewer } from './context'
import { automationLens, effectiveLens } from './effective-lens'
import type { Lens } from './lens'

/**
 * The viewer's effective lens on a set of threads — the shared single-row /
 * small-batch gate for message reads, write checks, and link validation
 * (§5.2/§7). One thread-row query plus, only when the viewer holds contact
 * grants, one ThreadParticipant query. SYSTEM → `full` for every id; ids that
 * don't exist in this org evaluate to `none` (invisible ≍ nonexistent).
 *
 * List paths do NOT use this — they evaluate on rows they already loaded
 * (`effectiveLensBatch`) or filter in SQL (`buildMailVisibilityPredicate`).
 */
export async function getThreadLensBatch(
  db: Database,
  organizationId: string,
  viewer: MailViewer,
  threadIds: string[]
): Promise<Map<string, Lens>> {
  const lenses = new Map<string, Lens>()
  if (threadIds.length === 0) return lenses

  if (isSystemViewer(viewer)) {
    for (const id of threadIds) lenses.set(id, 'full')
    return lenses
  }

  // Automation (§8.2): full except personal inboxes. With no personal inboxes
  // the exclusion is empty — skip the row query like SYSTEM.
  if (isAutomationViewer(viewer)) {
    if (Object.keys(viewer.personalInboxIds).length === 0) {
      for (const id of threadIds) lenses.set(id, 'full')
      return lenses
    }
    const rows = await db
      .select({ id: schema.Thread.id, inboxId: schema.Thread.inboxId })
      .from(schema.Thread)
      .where(
        and(inArray(schema.Thread.id, threadIds), eq(schema.Thread.organizationId, organizationId))
      )
    for (const t of rows) {
      lenses.set(
        t.id,
        automationLens(viewer, {
          threadId: t.id,
          inboxId: t.inboxId ?? null,
          assigneeId: null,
          primaryEntityInstanceId: null,
          participantContactIds: [],
        })
      )
    }
    return lenses
  }

  const threads = await db
    .select({
      id: schema.Thread.id,
      inboxId: schema.Thread.inboxId,
      assigneeId: schema.Thread.assigneeId,
      primaryEntityInstanceId: schema.Thread.primaryEntityInstanceId,
    })
    .from(schema.Thread)
    .where(
      and(inArray(schema.Thread.id, threadIds), eq(schema.Thread.organizationId, organizationId))
    )

  const contactsByThread = new Map<string, string[]>()
  if (Object.keys(viewer.contactGrants).length > 0 && threads.length > 0) {
    const rows = await db
      .select({
        threadId: schema.ThreadParticipant.threadId,
        entityInstanceId: schema.ThreadParticipant.entityInstanceId,
      })
      .from(schema.ThreadParticipant)
      .where(
        and(
          inArray(
            schema.ThreadParticipant.threadId,
            threads.map((t) => t.id)
          ),
          isNotNull(schema.ThreadParticipant.entityInstanceId)
        )
      )
    for (const row of rows) {
      if (!row.entityInstanceId) continue
      const arr = contactsByThread.get(row.threadId) ?? []
      arr.push(row.entityInstanceId)
      contactsByThread.set(row.threadId, arr)
    }
  }

  for (const t of threads) {
    const input: ThreadVisibilityInput = {
      threadId: t.id,
      inboxId: t.inboxId ?? null,
      assigneeId: t.assigneeId ?? null,
      primaryEntityInstanceId: t.primaryEntityInstanceId ?? null,
      participantContactIds: contactsByThread.get(t.id) ?? [],
    }
    lenses.set(t.id, effectiveLens(viewer, input))
  }
  return lenses
}

/** Single-thread convenience over {@link getThreadLensBatch}. */
export async function getThreadLens(
  db: Database,
  organizationId: string,
  viewer: MailViewer,
  threadId: string
): Promise<Lens> {
  const lenses = await getThreadLensBatch(db, organizationId, viewer, [threadId])
  return lenses.get(threadId) ?? 'none'
}

/** The thread columns {@link getLoadedThreadLens} needs from a caller. */
export interface LoadedThreadFacts {
  threadId: string
  inboxId: string | null
  assigneeId: string | null
  primaryEntityInstanceId: string | null
}

/**
 * A human viewer's effective lens on a thread the caller has ALREADY loaded
 * org-scoped — {@link getThreadLens} minus its thread-row query.
 *
 * Exists because two callers legitimately need the lens for a row they are
 * already holding, and going back through `getThreadLens` re-selected it: the
 * access-request lane loads the thread once for its authority context, and
 * `assertCanManageMailSharing`'s thread branch is then handed that same context.
 * Between them the decision path read one `Thread` row three times.
 *
 * Keeps the `ThreadParticipant` query CONDITIONAL on the viewer actually holding
 * contact grants, which is the rule `getThreadLensBatch` owns — the whole point of
 * putting this beside it rather than in either caller is that the two cannot
 * drift on when participants matter.
 *
 * Human viewers only (`UserMailVisibility`, not `MailViewer`): the SYSTEM and
 * automation branches exist to SKIP the row read, so they have nothing to gain
 * from a preloaded row and both callers here resolve a real member.
 */
export async function getLoadedThreadLens(
  db: Database,
  viewer: UserMailVisibility,
  thread: LoadedThreadFacts
): Promise<Lens> {
  let participantContactIds: string[] = []
  if (Object.keys(viewer.contactGrants).length > 0) {
    const rows = await db
      .select({ entityInstanceId: schema.ThreadParticipant.entityInstanceId })
      .from(schema.ThreadParticipant)
      .where(
        and(
          eq(schema.ThreadParticipant.threadId, thread.threadId),
          isNotNull(schema.ThreadParticipant.entityInstanceId)
        )
      )
    participantContactIds = rows
      .map((r) => r.entityInstanceId)
      .filter((id): id is string => id !== null)
  }
  return effectiveLens(viewer, {
    threadId: thread.threadId,
    inboxId: thread.inboxId,
    assigneeId: thread.assigneeId,
    primaryEntityInstanceId: thread.primaryEntityInstanceId,
    participantContactIds,
  })
}
