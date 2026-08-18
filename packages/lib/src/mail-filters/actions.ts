// packages/lib/src/mail-filters/actions.ts
// The mail-filter action executor (plan §4.3).
//
// ⚠️ INVARIANT 1 — every action reuses an EXISTING execution path. This module
// writes no thread state of its own, and NOTHING here may route through
// `UnifiedCrudHandler`, which refuses `thread`/`message` by design (no mail
// lens). Thread mutations go through `ThreadMutationService` and read state
// through `UnreadService`, which is what keeps mail counts (delta `HINCRBY`),
// realtime publishes and provider push-back correct. A "quick direct UPDATE"
// here silently drifts all three.
//
// Heavy dependencies (thread services, queues, the org cache, the workflow
// message loader) are lazy-imported at call time: a static edge would drag the
// realtime barrel and the workflow engine into every importer's graph and break
// `vi.mock` in unit tests.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getActorType, isActorId, toActorId } from '@auxx/types/actor'
import { toRecordId } from '@auxx/types/resource'
import type {
  CachedMailFilter,
  MailFilterAction,
  MailFilterRunSource,
  MailFilterUndoState,
} from './types'

const logger = createScopedLogger('mail-filters-actions')

/**
 * The two actions a RETROACTIVE run refuses to execute (§4.3 / D18).
 *
 * A backfill is "paged, logged and undoable" — an agent reply or a workflow run
 * against a months-old customer thread is none of those. Neither escape hatch is
 * idempotent (§4.3) and neither is covered by the undo blob, so paging 5000
 * threads through them is exactly the unattended bulk mutation D18 exists to
 * prevent. They are the ONE case where the live path and the backfill diverge,
 * and the divergence is stated here so it lives in exactly one place.
 *
 * Skipped, never silently dropped: the outcome lands on the `MailFilterRun` row
 * with {@link RETROACTIVE_SKIP_REASON}, and the job counts them into its summary
 * log line (invariant 10 — never silently truncate).
 */
export const RETROACTIVE_SKIPPED_ACTION_TYPES: readonly MailFilterAction['type'][] = [
  'run-agent',
  'run-workflow',
]

/** The `skipped` reason recorded for {@link RETROACTIVE_SKIPPED_ACTION_TYPES}. */
export const RETROACTIVE_SKIP_REASON =
  'not run on existing conversations — agents and workflows only run on new mail'

/** True when this action type is one a retroactive backfill refuses to run. */
export function isRetroactiveSkippedAction(type: MailFilterAction['type']): boolean {
  return RETROACTIVE_SKIPPED_ACTION_TYPES.includes(type)
}

/** The inbox a thread lives in, as far as the executor needs to know it. */
export interface MailFilterInbox {
  id: string
  /** True when the instance lives on the `personal_inbox` definition. */
  isPersonal: boolean
  /** Owner of a personal inbox; null on shared org inboxes. */
  ownerUserId: string | null
}

/** Everything an action needs about the firing, resolved once by the engine. */
export interface MailFilterActionContext {
  db: Database
  organizationId: string
  threadId: string
  messageId: string
  filter: CachedMailFilter
  /** The thread row the gate already loaded — actions never re-read it. */
  thread: {
    inboxId: string | null
    status: string | null
    assigneeId: string | null
  }
  /** The thread's inbox, from the `inboxes` org cache. Null when unresolvable. */
  inbox: MailFilterInbox | null
  /**
   * Which door fired this run. The executor reads it for exactly one decision —
   * {@link RETROACTIVE_SKIPPED_ACTION_TYPES} — so a backfill can never enqueue an
   * agent or a workflow. Everything else behaves identically on both paths.
   */
  source: MailFilterRunSource
  /**
   * The claimed `MailFilterRun.id` for this firing — carried onto the thread
   * events' `data.source.runId` so a rendered line can deep-link the run.
   */
  runId?: string
}

/**
 * Outcome of one action. `skipped` carries a reason so the run row explains
 * itself (`set-read` on a shared inbox is the common one) rather than showing a
 * bare status the UI cannot caption.
 */
export type MailFilterActionResult = { status: 'ok' } | { status: 'skipped'; reason: string }

const OK: MailFilterActionResult = { status: 'ok' }
const skip = (reason: string): MailFilterActionResult => ({ status: 'skipped', reason })

/** `ThreadMutationService` bound to the SYSTEM principal (§4.2 / §4.4). */
async function threadService(ctx: MailFilterActionContext) {
  const [{ ThreadMutationService }, { SYSTEM_VISIBILITY }] = await Promise.all([
    import('../threads/thread-mutation.service'),
    import('../permissions/visibility/context'),
  ])
  // No socketId (nothing to self-echo-suppress) and no human actor — the
  // FILTER is the actor (thread-events §5.5): lifecycle events carry
  // `data.source: { kind: 'mail_filter', … }` with a null actorId, and the
  // MailFilterRun row remains the audit trail.
  return new ThreadMutationService(
    ctx.organizationId,
    ctx.db,
    undefined,
    {
      kind: 'mail_filter',
      id: ctx.filter.id,
      ...(ctx.runId ? { runId: ctx.runId } : {}),
      name: ctx.filter.name,
    },
    SYSTEM_VISIBILITY
  )
}

/** The thread's own RecordId, for the `RecordId`-shaped service API. */
function threadRecordId(ctx: MailFilterActionContext) {
  return toRecordId('thread', ctx.threadId)
}

/**
 * Capture the pre-action thread state so one firing can be reversed (§6.3).
 *
 * ⚠️ Called by the engine BEFORE any action runs. Capturing it afterwards would
 * store the post-action state and make Undo a no-op that looks like it worked.
 *
 * Only the parts a matched action can actually change are read, so a
 * status-only filter never pays for a tag query. `read` is scalar and therefore
 * only meaningful while `set-read` stays personal-inbox-only — a shared-inbox
 * read flip could not round-trip through this shape.
 */
export async function captureUndoState(
  ctx: MailFilterActionContext,
  actions: MailFilterAction[]
): Promise<MailFilterUndoState | null> {
  const types = new Set(actions.map((a) => a.type))
  const reversible =
    types.has('set-status') ||
    types.has('assign') ||
    types.has('move-inbox') ||
    types.has('add-tag') ||
    types.has('remove-tag') ||
    types.has('set-read')
  // Nothing reversible (e.g. only `suppress-automations` / `run-workflow`) —
  // null is what disables the Undo button rather than offering one that does
  // nothing.
  if (!reversible) return null

  let tagIds: string[] = []
  if (types.has('add-tag') || types.has('remove-tag')) {
    const { getThreadTagIds } = await import('../field-values/relationship-queries')
    tagIds = await getThreadTagIds(ctx.db, ctx.threadId, ctx.organizationId)
  }

  let read: boolean | null = null
  if (types.has('set-read') && ctx.inbox?.isPersonal && ctx.inbox.ownerUserId) {
    const { schema } = await import('@auxx/database')
    const { and, eq } = await import('drizzle-orm')
    const [row] = await ctx.db
      .select({ isRead: schema.ThreadReadStatus.isRead })
      .from(schema.ThreadReadStatus)
      .where(
        and(
          eq(schema.ThreadReadStatus.threadId, ctx.threadId),
          eq(schema.ThreadReadStatus.userId, ctx.inbox.ownerUserId)
        )
      )
      .limit(1)
    // No row means "never read" — the same thing `setReadStatus` treats as unread.
    read = row?.isRead ?? false
  }

  return {
    status: ctx.thread.status,
    assigneeId: ctx.thread.assigneeId,
    inboxId: ctx.thread.inboxId,
    tagIds,
    read,
  }
}

/**
 * Execute one action against one thread.
 *
 * Throws on failure — the engine catches and records `'failed'` on the run row
 * (continue-and-report: one failed action never blocks the rest).
 */
export async function executeMailFilterAction(
  action: MailFilterAction,
  ctx: MailFilterActionContext
): Promise<MailFilterActionResult> {
  // ⚠️ The ONE place the backfill diverges from the live path (D18). Checked
  // before the switch so a new escape-hatch action is covered by adding it to
  // `RETROACTIVE_SKIPPED_ACTION_TYPES`, not by remembering a second call site.
  if (ctx.source === 'retroactive' && isRetroactiveSkippedAction(action.type)) {
    return skip(RETROACTIVE_SKIP_REASON)
  }

  switch (action.type) {
    case 'set-status': {
      const service = await threadService(ctx)
      await service.update(threadRecordId(ctx), { status: action.status })
      return OK
    }

    case 'add-tag':
    case 'remove-tag': {
      if (action.tagIds.length === 0) return skip('no tags configured')
      const [{ requireCachedEntityDefId }, service] = await Promise.all([
        import('../cache'),
        threadService(ctx),
      ])
      const [threadDefId, tagDefId] = await Promise.all([
        requireCachedEntityDefId(ctx.organizationId, 'thread'),
        requireCachedEntityDefId(ctx.organizationId, 'tag'),
      ])
      await service.tagThreadsBulk(
        [toRecordId(threadDefId, ctx.threadId)],
        action.tagIds.map((id) => toRecordId(tagDefId, id)),
        action.type === 'add-tag' ? 'add' : 'remove'
      )
      return OK
    }

    case 'assign': {
      // ⚠️ USERS ONLY. `Thread.assigneeId` is `text().references(() => User.id)`
      // and `ThreadMutationService.update` writes `parseActorId(...).id` straight
      // into it — there is no group expansion anywhere on that path, so a
      // `group:…` assignee is an FK violation (23503), not an assignment. The
      // catalog picker is `target: 'user'` for that reason; this skip is the
      // fail-closed backstop for a value written before it was.
      const assigneeId = isActorId(action.assigneeId)
        ? action.assigneeId
        : toActorId('user', action.assigneeId)
      if (getActorType(assigneeId) !== 'user') {
        return skip('assignment supports members only, not groups')
      }
      const service = await threadService(ctx)
      await service.update(threadRecordId(ctx), { assigneeId })
      return OK
    }

    case 'move-inbox': {
      if (action.inboxId === ctx.thread.inboxId) return skip('thread is already in that inbox')

      // §4.3 / §4.4: `move-inbox` is the ONE action that crosses the containment
      // boundary, so the destination is re-checked HERE, at fire time — rights
      // and inboxes change after a filter is written and it must fail closed.
      //
      // What is re-checkable as SYSTEM is existence + org scope: the destination
      // must still be a live inbox in this org. The AUTHOR's write rights on it
      // cannot be re-derived here (the engine has no user, and the run carries
      // no author), so that half stays with the authoring gate (§5.1), which
      // re-asserts on every edit. A deleted or foreign inbox skips rather than
      // writing an id nothing owns.
      const { getOrgCache } = await import('../cache')
      const inboxes = await getOrgCache().get(ctx.organizationId, 'inboxes')
      const destination = inboxes.find((inbox) => inbox.id === action.inboxId)
      if (!destination) return skip('destination inbox no longer exists in this organization')

      const [{ toInboxRecordId }, service] = await Promise.all([
        import('../inbox-record-ids'),
        threadService(ctx),
      ])
      // `ThreadUpdates.inboxId` is a RecordId and the DEF differs for `inbox` vs
      // `personal_inbox` — a bare instance id is wrong and mints a RecordId
      // whose def no longer owns the row.
      await service.update(threadRecordId(ctx), {
        inboxId: await toInboxRecordId(ctx.organizationId, action.inboxId),
      })
      return OK
    }

    case 'set-read': {
      // ⚠️ PERSONAL INBOXES ONLY in v1 (§4.3). Read state is per-user
      // (`ThreadReadStatus` is unique on `(threadId, userId)`) and
      // `UnreadService` is constructed with a userId. On a personal inbox the
      // principal is the owner, unambiguously. On a SHARED inbox it is
      // undecided — every member holding the lens, or nobody? — and
      // `MailFilterRun.undo`'s scalar `read` could not round-trip a per-user set
      // anyway. Skipped with a reason rather than guessed.
      if (!ctx.inbox?.isPersonal) {
        return skip('mark read/unread applies to personal inboxes only')
      }
      if (!ctx.inbox.ownerUserId) {
        return skip('personal inbox has no owner to mark read for')
      }
      const [{ UnreadService }, { SYSTEM_VISIBILITY }] = await Promise.all([
        import('../threads/unread-service'),
        import('../permissions/visibility/context'),
      ])
      const service = new UnreadService(
        ctx.organizationId,
        ctx.inbox.ownerUserId,
        SYSTEM_VISIBILITY
      )
      // The only action with an OUTBOUND provider side effect — it pushes the
      // Gmail `UNREAD` label back.
      await service.setReadStatus([ctx.threadId], action.read, ctx.inbox.ownerUserId)
      return OK
    }

    case 'suppress-automations':
      // No side effect by design — the engine reads this action off the matched
      // filter and turns it into the gate's suppress list (§3).
      return OK

    case 'run-workflow': {
      // ⚠️ The QUEUE is reused, not the dispatcher. `triggerMessageWorkflows`
      // broadcasts to EVERY published workflow matching MESSAGE_RECEIVED; a
      // filter action targets ONE named `workflowAppId` — the opposite shape.
      // So the `executeMessageTrigger` payload is built directly.
      const { getOrgCache } = await import('../cache')
      const app = await getOrgCache()
        .from(ctx.organizationId, 'workflowApps')
        .byAppId(action.workflowAppId)
      if (!app?.publishedWorkflow) return skip('workflow is not published or is disabled')

      // A further DB hop INSIDE the gate — counted against the §3 latency
      // budget, and only paid when a `run-workflow` action actually matched.
      const { loadProcessedMessage } = await import(
        '../workflow-engine/nodes/trigger-nodes/message-loader'
      )
      const messageData = await loadProcessedMessage(ctx.messageId, ctx.organizationId)
      if (!messageData) return skip('message not found')

      const [{ getQueue }, { Queues }] = await Promise.all([
        import('../jobs/queues'),
        import('../jobs/queues/types'),
      ])
      await getQueue(Queues.workflowDelayQueue).add('executeMessageTrigger', {
        workflowAppId: app.id,
        workflowId: app.publishedWorkflow.id,
        organizationId: ctx.organizationId,
        messageData,
        messageId: ctx.messageId,
        threadId: ctx.threadId,
        triggeredAt: new Date().toISOString(),
      })
      return OK
    }

    case 'run-agent': {
      // `agentTriggerId` points at a trigger row ON the agent — that queue has
      // no "just run agent X" entry point, which is why the action type carries
      // both ids.
      const [{ getQueue }, { Queues }] = await Promise.all([
        import('../jobs/queues'),
        import('../jobs/queues/types'),
      ])
      await getQueue(Queues.scheduledTriggerQueue).add('executeAgentEventTrigger', {
        agentTriggerId: action.agentTriggerId,
        agentId: action.agentId,
        organizationId: ctx.organizationId,
        eventType: 'message:received',
        recordId: threadRecordId(ctx),
        resourceData: {
          threadId: ctx.threadId,
          messageId: ctx.messageId,
          organizationId: ctx.organizationId,
          mailFilterId: ctx.filter.id,
        },
        firedAt: new Date().toISOString(),
      })
      return OK
    }

    default: {
      // Exhaustiveness: a new action variant must land a case above rather than
      // silently no-op'ing on the fire path.
      const exhaustive: never = action
      logger.error('Unknown mail-filter action — skipped', { action: exhaustive })
      return skip('unknown action type')
    }
  }
}
