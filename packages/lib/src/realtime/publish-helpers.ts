// @auxx/lib/realtime/publish-helpers.ts

import { database, schema } from '@auxx/database'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { and, eq, isNotNull } from 'drizzle-orm'
import { maxRung } from '../permissions/capabilities/rung'
import type { Lens } from '../permissions/visibility/lens'
import type {
  ApprovalPingEvent,
  ApprovalResolvedEvent,
  DataConnectorSyncEvent,
  DataExportJobEvent,
  FieldValueUpdateEntry,
  MailSyncEvent,
  MessageMeta,
  ParticipantMeta,
  ThreadCreatedEvent,
  ThreadMeta,
  WorkflowDraftUpdatedEvent,
} from './events'
import { shapeMailEventForLens } from './mail-event-shaping'
import type { RealtimeService } from './realtime-service'
import { CHANNEL_LENSES, rooms } from './rooms'

const CHUNK_SIZE = 50

/**
 * Bucket field-value entries by the entity def they belong to.
 *
 * A `FieldValueKey` is `` `${RecordId}:${fieldRefKey}` `` and a `RecordId` is
 * `` `${entityDefinitionId}:${entityInstanceId}` ``, so the def is the segment
 * before the FIRST colon. Entries whose def can't be derived are DROPPED: they
 * have no channel to ride, and the alternative (an org-wide fallback) is the
 * leak this routing exists to close.
 */
function groupEntriesByDef(entries: FieldValueUpdateEntry[]): Map<string, FieldValueUpdateEntry[]> {
  const byDef = new Map<string, FieldValueUpdateEntry[]>()
  for (const entry of entries) {
    const { entityDefinitionId } = parseRecordId(entry.key as string as RecordId)
    if (!entityDefinitionId) continue
    const bucket = byDef.get(entityDefinitionId)
    if (bucket) bucket.push(entry)
    else byDef.set(entityDefinitionId, [entry])
  }
  return byDef
}

/**
 * Publish field value updates on the per-def record channels
 * (`rooms.orgRecords`), chunking if needed (Pusher 10KB limit).
 * Fire-and-forget — errors are logged by the provider, not thrown.
 *
 * One call routinely spans several defs (a relationship write touches both
 * sides), so entries are bucketed by def and published one message per def:
 * `FieldValueUpdateEntry.value` is the RAW stored value, and every record
 * channel is ACL'd on `canViewEntity` for its own def — a mixed frame would
 * put def A's values on def B's channel. Chunking is applied per def bucket.
 *
 * Each entry can carry any combination of `value`, `aiStatus`, and
 * `aiMetadata`. Omit `value` to publish a pure AI-state transition (e.g. the
 * stage-1 enqueue or a stage-2 error); include both to commit a successful
 * AI generation. Omit the AI fields for regular writes.
 */
export async function publishFieldValueUpdates(
  realtimeService: RealtimeService,
  organizationId: string,
  entries: FieldValueUpdateEntry[],
  options?: { excludeSocketId?: string }
) {
  if (entries.length === 0) return

  const promises: Promise<boolean>[] = []

  for (const [entityDefinitionId, defEntries] of groupEntriesByDef(entries)) {
    const roomKey = rooms.orgRecords(organizationId, entityDefinitionId)

    if (defEntries.length <= CHUNK_SIZE) {
      promises.push(
        realtimeService.publish(roomKey, 'fieldValues:updated', { entries: defEntries }, options)
      )
      continue
    }

    // Chunk into multiple messages, per def bucket.
    const totalChunks = Math.ceil(defEntries.length / CHUNK_SIZE)
    for (let i = 0; i < totalChunks; i++) {
      const chunk = defEntries.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      promises.push(
        realtimeService.publish(
          roomKey,
          'fieldValues:updated',
          { entries: chunk, chunk: { index: i, total: totalChunks } },
          options
        )
      )
    }
  }

  await Promise.allSettled(promises)
}

/**
 * Publish `records:invalidated` — one frame per touched entity def, each on
 * that def's own record channel (`rooms.orgRecords`). Used by bulk-write paths
 * (data-connector slice sync) that suppress per-record realtime to keep an open
 * grid live with a single coarse refetch per def per slice instead of thousands
 * of per-record events.
 *
 * The arg list already spans defs, so the per-def frame it always emitted is
 * now simply addressed to the matching channel.
 *
 * Fire-and-forget: errors are swallowed so a Pusher hiccup never blocks the sync.
 */
export async function publishRecordsInvalidated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { entityDefinitionIds: string[] },
  options?: { excludeSocketId?: string }
) {
  if (args.entityDefinitionIds.length === 0) return

  await Promise.allSettled(
    args.entityDefinitionIds.map((entityDefinitionId) =>
      realtimeService.publish(
        rooms.orgRecords(organizationId, entityDefinitionId),
        'records:invalidated',
        { entityDefinitionId },
        options
      )
    )
  )
}

/**
 * Publish `dataConnector:sync` on the org channel — the live connector-sync status
 * signal (see `DataConnectorSyncEvent`). Coarse + org-wide like `records:invalidated`.
 * No `excludeSocketId`: sync runs in the worker (no originating browser socket), so
 * every open tab — including the one that clicked "Sync now" — should light up.
 *
 * Fire-and-forget: errors swallowed so a Pusher hiccup never blocks the sync job.
 */
export async function publishDataConnectorSync(
  realtimeService: RealtimeService,
  organizationId: string,
  data: DataConnectorSyncEvent['data']
) {
  await realtimeService
    .publish(rooms.orgPresence(organizationId), 'dataConnector:sync', data)
    .catch(() => {})
}

/**
 * Publish `dataExport:job` on the org channel — the live CSV-export progress
 * signal (see `DataExportJobEvent`). Coarse + org-wide like `publishDataConnectorSync`.
 * No `excludeSocketId`: exports run in the worker (no originating browser socket),
 * so every open tab lights up.
 *
 * Fire-and-forget: errors swallowed so a Pusher hiccup never blocks the export job.
 */
export async function publishDataExportJob(
  realtimeService: RealtimeService,
  organizationId: string,
  data: DataExportJobEvent['data']
) {
  await realtimeService
    .publish(rooms.orgPresence(organizationId), 'dataExport:job', data)
    .catch(() => {})
}

/**
 * Publish `resource:created` / `resource:updated` / `resource:deleted` on the org
 * channel — a coarse "the resource list changed" nudge (see `ResourceDefChangedEvent`).
 * Like `publishDataConnectorSync`, no `excludeSocketId`: connector provisioning runs in
 * the worker (no originating socket), and a redundant invalidate on the acting client
 * is harmless — so every caller (UI service + worker) stays uniform.
 *
 * Fire-and-forget: errors swallowed so a Pusher hiccup never blocks the write.
 */
export async function publishResourceDefChanged(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { entityDefinitionId: string; kind: 'created' | 'updated' | 'deleted' }
) {
  await realtimeService
    .publish(rooms.orgPresence(organizationId), `resource:${args.kind}`, {
      entityDefinitionId: args.entityDefinitionId,
    })
    .catch(() => {})
}

// ════════════════════════════════════════════════════════════════════════════
// Mail publish helpers
// ════════════════════════════════════════════════════════════════════════════

interface MailPublishOptions {
  excludeSocketId?: string
}

/**
 * Per-thread routing facts for a mail publish (mail-permissions §6.2/§6.3).
 * `assigneeId` powers the per-user full-payload fanout to the assignee (who
 * may lack the inbox channel entirely); callers that don't have it handy pass
 * `undefined` and skip that fanout leg.
 */
interface MailThreadTarget {
  threadId: string
  inboxId: string | null
  /** Publish on the previous inbox's channels too when the thread moved. */
  previousInboxId?: string | null
  /** `undefined` = unknown (skip assignee fanout); `null` = unassigned. */
  assigneeId?: string | null
}

/**
 * Per-user grantee audience for one thread: explicit thread grants plus
 * contact-derived grants from the cached reverse index (§3.1). The contact
 * leg needs the thread's participant contact ids — one indexed point query,
 * run only when the org has contact grants at all (almost always none).
 * Best-effort: any failure returns what was resolved so far.
 */
async function resolveThreadGrantAudience(
  organizationId: string,
  threadId: string
): Promise<Map<string, Lens>> {
  const audience = new Map<string, Lens>()
  try {
    // Lazy import — cache invalidation lazily imports realtime, so the
    // realtime module must not statically import the cache barrel back.
    const { getOrgCache } = await import('../cache')
    const index = await getOrgCache().get(organizationId, 'mailGrantIndex')
    for (const entry of index.threads[threadId] ?? []) {
      audience.set(entry.userId, maxRung(audience.get(entry.userId) ?? 'none', entry.lens))
    }
    if (Object.keys(index.contacts).length > 0) {
      const rows = await database
        .select({ entityInstanceId: schema.ThreadParticipant.entityInstanceId })
        .from(schema.ThreadParticipant)
        .where(
          and(
            eq(schema.ThreadParticipant.threadId, threadId),
            isNotNull(schema.ThreadParticipant.entityInstanceId)
          )
        )
      for (const row of rows) {
        for (const entry of index.contacts[row.entityInstanceId as string] ?? []) {
          audience.set(entry.userId, maxRung(audience.get(entry.userId) ?? 'none', entry.lens))
        }
      }
    }
  } catch {
    // Fanout is a UX nicety on top of the enforced read path — never throw.
  }
  return audience
}

/**
 * Publish one mail event for a thread (§6.2/§6.3):
 *
 * - Inbox channels: one redacted variant per lens
 *   (`org-{org}-inbox-{id}-{metadata|subject|full}`). A null inbox publishes
 *   to the admin-only `none` channel at `full` only.
 * - Per-user fanout: the assignee gets the full payload on their user
 *   channel (they may lack the inbox channel); thread/contact grantees get
 *   the payload redacted to their granted lens.
 *
 * Fire-and-forget: errors are swallowed by `Promise.allSettled`.
 */
async function publishMailThreadEvent(
  realtimeService: RealtimeService,
  organizationId: string,
  target: MailThreadTarget,
  event: MailSyncEvent,
  options?: MailPublishOptions
) {
  const tasks: Promise<boolean>[] = []

  const inboxIds = new Set<string | null>([target.inboxId])
  if (target.previousInboxId !== undefined && target.previousInboxId !== target.inboxId) {
    inboxIds.add(target.previousInboxId ?? null)
  }
  for (const inboxId of inboxIds) {
    const lenses = inboxId === null ? (['read'] as const) : CHANNEL_LENSES
    for (const lens of lenses) {
      const shaped = shapeMailEventForLens(event, lens)
      if (!shaped) continue
      tasks.push(
        realtimeService.publish(
          rooms.orgInbox(organizationId, inboxId ?? 'none', lens),
          shaped.event,
          shaped.data,
          options
        )
      )
    }
  }

  const audience = await resolveThreadGrantAudience(organizationId, target.threadId)
  if (target.assigneeId) audience.set(target.assigneeId, 'read')
  for (const [userId, lens] of audience) {
    const shaped = shapeMailEventForLens(event, lens)
    if (!shaped) continue
    tasks.push(realtimeService.publish(rooms.user(userId), shaped.event, shaped.data, options))
  }

  await Promise.allSettled(tasks)
}

/**
 * Publish `thread:created` on the thread's inbox channels (every lens
 * variant) + the per-user grantee fanout. `inboxId` is the raw
 * EntityInstance id (or null for triage → admin-only `none` channel).
 */
export async function publishThreadCreated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: {
    threadId: string
    inboxId: string | null
    inboxRecordId?: string | null
    assigneeId?: string | null
  },
  options?: MailPublishOptions
) {
  await publishMailThreadEvent(
    realtimeService,
    organizationId,
    args,
    {
      event: 'thread:created',
      data: {
        threadId: args.threadId,
        inboxId: (args.inboxRecordId ?? null) as ThreadCreatedEvent['data']['inboxId'],
      },
    },
    options
  )
}

/**
 * Publish `thread:updated` with a partial patch on the thread's inbox
 * channels — redacted per lens variant (§6.2: the patch goes through the
 * `redactThreadPatch` allowlist, so lower channels never carry subject /
 * unread / unclassified fields) — plus the per-user grantee fanout.
 *
 * Pass `previousInboxId` when a thread's inboxId changes — the helper
 * publishes on both the old and new channels so users on each side see the
 * transition (FE drops the row from the old via filter, fetches on the new).
 */
export async function publishThreadUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: MailThreadTarget & { patch: Partial<ThreadMeta> },
  options?: MailPublishOptions
) {
  await publishMailThreadEvent(
    realtimeService,
    organizationId,
    args,
    {
      event: 'thread:updated',
      data: { threadId: args.threadId, patch: { id: args.threadId, ...args.patch } },
    },
    options
  )
}

/**
 * Publish `counts:changed` on a user's room — a refresh ping for sidebar
 * counts. Payload carries only the userId; the client refetches
 * `thread.getCounts` (one Redis roundtrip) on receipt.
 */
export async function publishCountsChanged(realtimeService: RealtimeService, userId: string) {
  await realtimeService.publish(rooms.user(userId), 'counts:changed', { userId }).catch(() => {})
}

/**
 * Publish `capabilities:changed` — a signal to the client `CapabilitiesProvider`
 * to refetch `permissions.myCapabilities` and swap its key set (permissions plan
 * §7.2). UX-only: server enforcement never trusts the client copy, so a missed
 * event just degrades to "stale until reload".
 *
 * Target a single user (`{ userId }` → their private room) when the affected
 * member is known — e.g. a user grant or a single member's role/seat change; use
 * the org-wide event (`{ orgId }` → the org events room) when a role/group grant
 * can shift many members' composed sets.
 *
 * Fire-and-forget: errors swallowed so a Pusher hiccup never blocks the write.
 */
export async function publishCapabilitiesChanged(
  realtimeService: RealtimeService,
  target: { userId: string } | { orgId: string }
) {
  if ('userId' in target) {
    await realtimeService
      .publish(rooms.user(target.userId), 'capabilities:changed', { userId: target.userId })
      .catch(() => {})
    return
  }
  await realtimeService
    .publish(rooms.orgEvents(target.orgId), 'capabilities:changed', { orgId: target.orgId })
    .catch(() => {})
}

/** Publish `thread:deleted` on the inbox channels + grantee fanout. */
export async function publishThreadDeleted(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { threadId: string; inboxId: string | null; assigneeId?: string | null },
  options?: MailPublishOptions
) {
  await publishMailThreadEvent(
    realtimeService,
    organizationId,
    args,
    { event: 'thread:deleted', data: { threadId: args.threadId } },
    options
  )
}

/**
 * Publish `message:created` on the thread's inbox channels. Messages are
 * invisible below `subject`, so the `metadata` variant is skipped (§6.2).
 */
export async function publishMessageCreated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { messageId: string; threadId: string; inboxId: string | null; assigneeId?: string | null },
  options?: MailPublishOptions
) {
  await publishMailThreadEvent(
    realtimeService,
    organizationId,
    args,
    { event: 'message:created', data: { messageId: args.messageId, threadId: args.threadId } },
    options
  )
}

/**
 * Publish `message:updated` with a partial patch on the thread's inbox
 * channels — content fields are dropped from the `subject` variant and the
 * event is skipped at `metadata` (§6.2).
 */
export async function publishMessageUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: {
    messageId: string
    threadId: string
    inboxId: string | null
    assigneeId?: string | null
    patch: Partial<MessageMeta>
  },
  options?: MailPublishOptions
) {
  await publishMailThreadEvent(
    realtimeService,
    organizationId,
    args,
    {
      event: 'message:updated',
      data: {
        messageId: args.messageId,
        threadId: args.threadId,
        patch: { id: args.messageId, threadId: args.threadId, ...args.patch },
      },
    },
    options
  )
}

/** Publish `message:deleted` on the thread's inbox channels (`subject`+). */
export async function publishMessageDeleted(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { messageId: string; threadId: string; inboxId: string | null; assigneeId?: string | null },
  options?: MailPublishOptions
) {
  await publishMailThreadEvent(
    realtimeService,
    organizationId,
    args,
    { event: 'message:deleted', data: { messageId: args.messageId, threadId: args.threadId } },
    options
  )
}

/**
 * Publish `participant:updated` on the triggering thread's inbox channels
 * (all lens variants — participants are metadata-tier). Moved off the
 * org-wide channel in mail-permissions Phase 3 so members with no access to
 * the inbox stop receiving contact-activity signals. `inboxId` undefined /
 * null routes to the admin-only `none` channel.
 */
export async function publishParticipantUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { participantId: string; patch: Partial<ParticipantMeta>; inboxId?: string | null },
  options?: MailPublishOptions
) {
  const payload = {
    participantId: args.participantId,
    patch: { id: args.participantId, ...args.patch },
  }
  const inboxId = args.inboxId ?? null
  const lenses = inboxId === null ? (['read'] as const) : CHANNEL_LENSES
  await Promise.allSettled(
    lenses.map((lens) =>
      realtimeService.publish(
        rooms.orgInbox(organizationId, inboxId ?? 'none', lens),
        'participant:updated',
        payload,
        options
      )
    )
  )
}

/**
 * Signal the end of a server-side sync cycle that touched a given inbox — on
 * every lens variant (it carries no content; every viewer refreshes their
 * redacted list). The client invalidates `thread.listIds` on receipt;
 * per-message events are suppressed during sync to avoid the realtime →
 * getByIds fan-out that trips the tRPC mutation rate limit.
 */
export async function publishInboxSyncCompleted(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { inboxId: string | null },
  options?: MailPublishOptions
) {
  const lenses = args.inboxId === null ? (['read'] as const) : CHANNEL_LENSES
  await Promise.allSettled(
    lenses.map((lens) =>
      realtimeService.publish(
        rooms.orgInbox(organizationId, args.inboxId ?? 'none', lens),
        'inbox:syncCompleted',
        { inboxId: args.inboxId },
        options
      )
    )
  )
}

/**
 * Flush a list of mail events as one or more `mail:batch` frames per inbox
 * lens channel. Used by ingest's initial-sync / polling-sync paths to
 * coalesce many events into a small number of frames. Each event is shaped
 * per lens (§6.2) before chunking at `CHUNK_SIZE` (50) per frame to stay
 * under Pusher's 10KB limit.
 *
 * Events of mixed inboxId may be passed — they are bucketed and flushed per
 * inbox. Use `inboxId = null` for triage (admin-only `none` channel, `full`
 * variant only). No per-user grantee fanout here — batch flushes are backfill
 * traffic; grantees recover via list refetch (accepted Phase 3 gap).
 */
export async function flushMailBatch(
  realtimeService: RealtimeService,
  organizationId: string,
  events: Array<{ inboxId: string | null; event: MailSyncEvent }>,
  options?: MailPublishOptions
) {
  if (events.length === 0) return

  const buckets = new Map<string | null, MailSyncEvent[]>()
  for (const { inboxId, event } of events) {
    const key = inboxId ?? null
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(event)
  }

  const promises: Promise<boolean>[] = []
  for (const [inboxId, list] of buckets) {
    const lenses = inboxId === null ? (['read'] as const) : CHANNEL_LENSES
    for (const lens of lenses) {
      const shaped = list
        .map((event) => shapeMailEventForLens(event, lens))
        .filter((event): event is MailSyncEvent => event !== null)
      if (shaped.length === 0) continue
      const roomKey = rooms.orgInbox(organizationId, inboxId ?? 'none', lens)
      for (let i = 0; i < shaped.length; i += CHUNK_SIZE) {
        const chunk = shaped.slice(i, i + CHUNK_SIZE)
        promises.push(realtimeService.publish(roomKey, 'mail:batch', { events: chunk }, options))
      }
    }
  }
  await Promise.allSettled(promises)
}

// ════════════════════════════════════════════════════════════════════════════
// Workflow approval helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Ping each assignee's private room that a workflow approval wants them
 * (plans/today/05-bell-and-feed-dedupe.md §5). Used for both the first request
 * and every reminder — the client invalidates its counts either way, so a
 * re-ping on an already-counted request is harmless.
 *
 * Confirmations are assignee-scoped, so this fans out over `rooms.user` rather
 * than the org room; no unassigned audience exists for them.
 *
 * Fire-and-forget: errors are swallowed so a Pusher hiccup never fails the
 * workflow run or the reminder job.
 */
export async function publishApprovalPing(
  realtimeService: RealtimeService,
  userIds: string[],
  data: ApprovalPingEvent['data']
) {
  if (userIds.length === 0) return
  await Promise.allSettled(
    userIds.map((userId) =>
      realtimeService.publish(rooms.user(userId), 'approval', data).catch(() => {})
    )
  )
}

/**
 * Tell each assignee that an approval left the pending set — decided,
 * cancelled, timed out, or cleaned up with its run. Same fan-out and the same
 * fire-and-forget contract as {@link publishApprovalPing}.
 */
export async function publishApprovalResolved(
  realtimeService: RealtimeService,
  userIds: string[],
  data: ApprovalResolvedEvent['data']
) {
  if (userIds.length === 0) return
  await Promise.allSettled(
    userIds.map((userId) =>
      realtimeService.publish(rooms.user(userId), 'approval:resolved', data).catch(() => {})
    )
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Agent admin helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Publish `agent:updated` on the org channel. Fires from every server-side
 * agent write so the detail-page rail invalidates `api.agent.getById` /
 * `api.agent.list` without any tool-output side channel.
 *
 * Fire-and-forget: errors are swallowed
 * so a Pusher hiccup never blocks the underlying agent mutation.
 */
export async function publishAgentUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { agentId: string },
  options?: { excludeSocketId?: string }
) {
  await realtimeService
    .publish(rooms.orgPresence(organizationId), 'agent:updated', { agentId: args.agentId }, options)
    .catch(() => {})
}

/**
 * Publish `procedure:updated` on the org channel. Fires from server-side
 * procedure writes that happen OUTSIDE the editor's own save path (today: the
 * Kopilot authoring tools) so an open editor refreshes its meta and re-seeds
 * the draft doc. The editor's own tRPC autosave must NOT emit this — it would
 * invalidate the author's in-flight editing.
 *
 * Fire-and-forget: errors are swallowed
 * so a Pusher hiccup never blocks the underlying procedure write.
 */
export async function publishProcedureUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { procedureId: string; agentId: string },
  options?: { excludeSocketId?: string }
) {
  await realtimeService
    .publish(
      rooms.orgPresence(organizationId),
      'procedure:updated',
      { procedureId: args.procedureId, agentId: args.agentId },
      options
    )
    .catch(() => {})
}

/**
 * Publish `eval:case-changed` on the org channel. Fires when a simulation case
 * is created / updated / deleted server-side so the Simulations tab re-lists
 * `eval.list` for the agent. The editor's own tRPC writes pass `excludeSocketId`
 * (the drawer already self-invalidates); the Kopilot tools omit it (server-
 * origin) so the author's own tab refreshes — exactly the persona-prompt path.
 *
 * Fire-and-forget: errors are swallowed
 * so a Pusher hiccup never blocks the underlying case write.
 */
export async function publishEvalCaseChanged(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { agentId: string },
  options?: { excludeSocketId?: string }
) {
  await realtimeService
    .publish(
      rooms.orgPresence(organizationId),
      'eval:case-changed',
      { agentId: args.agentId },
      options
    )
    .catch(() => {})
}

/**
 * Publish `tableView:changed` on the org channel. Fires from server-side saved-
 * view writes (today: the Kopilot record-view tools — create / update / set-
 * default) so the records page re-lists `tableView.listAll` and re-seeds the
 * dynamic-table store without any tool-output fetch in the kopilot SSE hook.
 * Kopilot tools omit `excludeSocketId` (server-origin) so the author's own table
 * refreshes too.
 *
 * Fire-and-forget: errors are swallowed so a Pusher hiccup never blocks the
 * underlying view write.
 */
export async function publishTableViewChanged(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { tableId?: string; kind: 'created' | 'updated' | 'defaultChanged' | 'deleted' },
  options?: { excludeSocketId?: string }
) {
  await realtimeService
    .publish(
      rooms.orgPresence(organizationId),
      'tableView:changed',
      { tableId: args.tableId, kind: args.kind },
      options
    )
    .catch(() => {})
}

/**
 * Publish `workflow:draft-updated` on the org channel. Fires AFTER a
 * successful graph-edit persist (Kopilot mutations, turn revert) so an open
 * builder canvas refetches the draft. Signal only — clients never apply the
 * payload directly (`feedback_builder_ui_refresh_via_realtime`). The canvas's
 * own save path must NOT emit this: it would invalidate the author's in-flight
 * editing.
 *
 * Fire-and-forget: errors are swallowed so a Pusher hiccup never blocks the
 * underlying draft write.
 */
export async function publishWorkflowDraftUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: WorkflowDraftUpdatedEvent['data'],
  options?: { excludeSocketId?: string }
) {
  await realtimeService
    .publish(
      rooms.orgPresence(organizationId),
      'workflow:draft-updated',
      {
        workflowAppId: args.workflowAppId,
        ...(args.nodeIds ? { nodeIds: args.nodeIds } : {}),
        reason: args.reason,
      },
      options
    )
    .catch(() => {})
}
