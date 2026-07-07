// packages/lib/src/permissions/visibility/thread-lens.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { MailViewer, ThreadVisibilityInput } from './context'
import { isSystemViewer } from './context'
import { effectiveLens } from './effective-lens'
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
