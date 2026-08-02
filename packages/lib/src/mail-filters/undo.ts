// packages/lib/src/mail-filters/undo.ts
// Reverse ONE MailFilterRun from its `undo` blob (D9, §6.3/§6.5).
//
// ⚠️ INVARIANT 1 — undo reverses through the SAME execution paths the forward
// actions used: `ThreadMutationService` (SYSTEM principal) for status /
// assignee / inbox / tags, `UnreadService` for read state. A "quick direct
// UPDATE" here would drift mail counts (the delta `HINCRBY`), realtime publishes
// and the provider push-back in exactly the way the executor is written to
// avoid — and it would drift them only on the undo path, which is the half
// nobody watches.
//
// Heavy dependencies are lazy-imported at call time for the same reason
// `actions.ts` lazy-imports them: a static edge drags the realtime barrel into
// every importer's graph and breaks `vi.mock` in unit tests.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toActorId } from '@auxx/types/actor'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError, UnprocessableEntityError } from '../errors'
import { getMailFilterRunById } from './queries'
import { markMailFilterRunUndone } from './runs'
import type { MailFilterAction, MailFilterRunRow } from './types'

const logger = createScopedLogger('mail-filters-undo')

/** The reversible halves of one firing. */
export type MailFilterUndoField = 'status' | 'assignee' | 'inbox' | 'tags' | 'read'

export interface UndoMailFilterRunResult {
  /** False when the run was already reversed — a NO-OP, not a failure. */
  undone: boolean
  /** Fields actually written back (a field already at its old value is omitted). */
  restored: MailFilterUndoField[]
  /** Fields the blob covered but that could not be reversed, with a reason. */
  skipped: { field: MailFilterUndoField; reason: string }[]
}

/** `ThreadUpdates.status` — narrower than the DB enum (see `types.ts`). */
const THREAD_UPDATE_STATUSES = ['OPEN', 'ARCHIVED', 'SPAM', 'TRASH', 'IGNORED'] as const
type ThreadUpdateStatus = (typeof THREAD_UPDATE_STATUSES)[number]

function isThreadUpdateStatus(value: unknown): value is ThreadUpdateStatus {
  return typeof value === 'string' && (THREAD_UPDATE_STATUSES as readonly string[]).includes(value)
}

/**
 * Which action types actually touched a thread on this run.
 *
 * ⚠️ **Load-bearing, not an optimization.** `captureUndoState` snapshots
 * status / assignee / inbox unconditionally as soon as *any* reversible action
 * is present, and leaves `tagIds` as `[]` when no tag action ran. Replaying the
 * whole blob would therefore let an undo of a tag-only firing **delete every tag
 * on the thread**, and an undo of a status-only firing revert an assignment a
 * human made afterwards. So each field is reversed only when the run's own
 * outcomes say that action ran.
 *
 * `skipped` outcomes are excluded: a skipped action provably wrote nothing.
 * `failed` ones are NOT — a failure may have half-applied.
 */
function touchedTypes(run: MailFilterRunRow): Set<MailFilterAction['type']> {
  return new Set(run.outcomes.filter((o) => o.status !== 'skipped').map((o) => o.type))
}

/**
 * Reverse one firing: status, assignee, inbox, tags and read state, then stamp
 * `undoneAt`.
 *
 * Three behaviours the caller must not paper over:
 *
 * - **A no-op once `undoneAt` is set.** Returns `ok({ undone: false })`, never an
 *   error — a second Undo click is a double-click, not a fault. `undoneAt` is
 *   stamped through {@link markMailFilterRunUndone}, whose `WHERE undoneAt IS
 *   NULL` makes the stamp itself idempotent, so a concurrent second reversal
 *   also lands here rather than re-stamping a newer timestamp.
 * - **A NULL `undo` blob is "NOT REVERSIBLE", never "nothing to reverse".** The
 *   claim row is inserted *before* execution and `undo` is written by the
 *   post-execution UPDATE (§3), so a run that died mid-execution has a `status`
 *   and no blob — the one case where the thread most likely DID change and we
 *   cannot say how. That returns a 422 with a clear message; silently reporting
 *   success would tell the user their mail was restored when it was not.
 * - **`undo.read` is scalar**, so it only round-trips while `set-read` stays
 *   personal-inbox-only (§4.3). Read state is per-user (`ThreadReadStatus` is
 *   unique on `(threadId, userId)`), so there is no shared-inbox read state this
 *   shape could restore — and the executor refuses `set-read` there for the same
 *   reason. If `set-read` is ever widened to shared inboxes, this blob shape has
 *   to change with it.
 *
 * **Undo stays available for the life of the run row**, which
 * `run-retention-job.ts` bounds (60 days, the record-rules precedent). The
 * retention window and the undo horizon are the same number.
 *
 * Zero permission checks (house rule): the router authorizes on the filter's
 * inbox before calling.
 */
export async function undoMailFilterRun(
  db: Database,
  organizationId: string,
  runId: string
): Promise<Result<UndoMailFilterRunResult, Error>> {
  const runResult = await getMailFilterRunById(db, organizationId, runId)
  if (runResult.isErr()) return err(runResult.error)
  const run = runResult.value

  if (run.undoneAt) {
    return ok({ undone: false, restored: [], skipped: [] })
  }
  if (!run.undo) {
    return err(
      new UnprocessableEntityError(
        'This filter run cannot be undone — it never recorded what the conversation looked like beforehand.'
      )
    )
  }

  const undo = run.undo
  const touched = touchedTypes(run)
  const restored: MailFilterUndoField[] = []
  const skipped: { field: MailFilterUndoField; reason: string }[] = []

  const [thread] = await db
    .select({
      id: schema.Thread.id,
      status: schema.Thread.status,
      assigneeId: schema.Thread.assigneeId,
      inboxId: schema.Thread.inboxId,
    })
    .from(schema.Thread)
    .where(
      and(eq(schema.Thread.id, run.threadId), eq(schema.Thread.organizationId, organizationId))
    )
    .limit(1)

  if (!thread) {
    return err(new NotFoundError('The conversation this filter run touched no longer exists.'))
  }

  // ── status / assignee / inbox — one `ThreadMutationService.update` ─────────
  // Only fields that BOTH an action wrote and that still differ from the stored
  // value: a no-diff write would still fire lifecycle events and realtime for a
  // change nobody made.
  const updates: {
    status?: ThreadUpdateStatus
    assigneeId?: ReturnType<typeof toActorId> | null
    inboxId?: ReturnType<typeof toRecordId> | null
  } = {}

  if (touched.has('set-status')) {
    if (!isThreadUpdateStatus(undo.status)) {
      skipped.push({ field: 'status', reason: `cannot restore status '${undo.status}'` })
    } else if (thread.status !== undo.status) {
      updates.status = undo.status
      restored.push('status')
    }
  }

  if (touched.has('assign') && thread.assigneeId !== undo.assigneeId) {
    updates.assigneeId = undo.assigneeId ? toActorId('user', undo.assigneeId) : null
    restored.push('assignee')
  }

  if (touched.has('move-inbox') && thread.inboxId !== undo.inboxId) {
    if (undo.inboxId) {
      // `ThreadUpdates.inboxId` is a RecordId whose DEF differs for `inbox` vs
      // `personal_inbox`; a bare instance id mints a RecordId no def owns.
      const { toInboxRecordId } = await import('../inbox-record-ids')
      updates.inboxId = await toInboxRecordId(organizationId, undo.inboxId)
    } else {
      updates.inboxId = null
    }
    restored.push('inbox')
  }

  const { ThreadMutationService } = await import('../threads/thread-mutation.service')
  const { SYSTEM_VISIBILITY } = await import('../permissions/visibility/context')
  const service = new ThreadMutationService(
    organizationId,
    db,
    undefined,
    undefined,
    SYSTEM_VISIBILITY
  )
  const threadRecordId = toRecordId('thread', run.threadId)

  if (Object.keys(updates).length > 0) {
    await service.update(threadRecordId, updates)
  }

  // ── tags — diff against what the thread carries NOW ────────────────────────
  if (touched.has('add-tag') || touched.has('remove-tag')) {
    const [{ getThreadTagIds }, { requireCachedEntityDefId }] = await Promise.all([
      import('../field-values/relationship-queries'),
      import('../cache'),
    ])
    const current = await getThreadTagIds(db, run.threadId, organizationId)
    const target = undo.tagIds
    const toAdd = target.filter((id) => !current.includes(id))
    const toRemove = current.filter((id) => !target.includes(id))

    if (toAdd.length > 0 || toRemove.length > 0) {
      const [threadDefId, tagDefId] = await Promise.all([
        requireCachedEntityDefId(organizationId, 'thread'),
        requireCachedEntityDefId(organizationId, 'tag'),
      ])
      const host = [toRecordId(threadDefId, run.threadId)]
      // `tagThreadsBulk('set')` early-returns on an empty tag list, so the empty
      // target ("the thread had no tags") has to be expressed as a remove.
      if (toAdd.length > 0) {
        await service.tagThreadsBulk(
          host,
          toAdd.map((id) => toRecordId(tagDefId, id)),
          'add'
        )
      }
      if (toRemove.length > 0) {
        await service.tagThreadsBulk(
          host,
          toRemove.map((id) => toRecordId(tagDefId, id)),
          'remove'
        )
      }
      restored.push('tags')
    }
  }

  // ── read state — personal inboxes only, by construction ────────────────────
  if (touched.has('set-read')) {
    if (undo.read === null) {
      skipped.push({ field: 'read', reason: 'no read state was captured' })
    } else {
      const { getOrgCache } = await import('../cache')
      const inboxes = await getOrgCache().get(organizationId, 'inboxes')
      // The inbox the thread was in when the filter fired — `move-inbox` may
      // have moved it since, and read state belongs to the ORIGINAL owner.
      const inbox = inboxes.find((row) => row.id === (undo.inboxId ?? thread.inboxId))
      if (!inbox?.isPersonal || !inbox.ownerUserId) {
        skipped.push({
          field: 'read',
          reason: 'read state is per-user and only restorable on a personal inbox',
        })
      } else {
        const [{ UnreadService }, { SYSTEM_VISIBILITY: SYSTEM }] = await Promise.all([
          import('../threads/unread-service'),
          import('../permissions/visibility/context'),
        ])
        const unread = new UnreadService(organizationId, inbox.ownerUserId, SYSTEM)
        await unread.setReadStatus([run.threadId], undo.read, inbox.ownerUserId)
        restored.push('read')
      }
    }
  }

  // Stamp LAST: the thread state is reversed first, so a crash in between leaves
  // an un-stamped run the user can retry rather than a stamped one they cannot.
  const stamped = await markMailFilterRunUndone(db, organizationId, runId)
  if (!stamped) {
    logger.info('Mail-filter run was already undone by a concurrent reversal', {
      organizationId,
      runId,
    })
    return ok({ undone: false, restored, skipped })
  }

  logger.info('Reversed a mail-filter run', {
    organizationId,
    runId,
    filterId: run.filterId,
    threadId: run.threadId,
    restored,
    skipped,
  })

  return ok({ undone: true, restored, skipped })
}
