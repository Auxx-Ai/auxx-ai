// @auxx/lib/realtime/publish-helpers.ts

import type {
  DataConnectorSyncEvent,
  DataExportJobEvent,
  FieldValueUpdateEntry,
  MailSyncEvent,
  MessageMeta,
  ParticipantMeta,
  ThreadMeta,
} from './events'
import type { RealtimeService } from './realtime-service'
import { rooms } from './rooms'

const CHUNK_SIZE = 50

/**
 * Publish field value updates to the org channel, chunking if needed (Pusher 10KB limit).
 * Fire-and-forget — errors are logged by the provider, not thrown.
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

  const roomKey = rooms.orgPresence(organizationId)

  if (entries.length <= CHUNK_SIZE) {
    await realtimeService.publish(roomKey, 'fieldValues:updated', { entries }, options)
    return
  }

  // Chunk into multiple messages
  const totalChunks = Math.ceil(entries.length / CHUNK_SIZE)
  const promises: Promise<boolean>[] = []

  for (let i = 0; i < totalChunks; i++) {
    const chunk = entries.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    promises.push(
      realtimeService.publish(
        roomKey,
        'fieldValues:updated',
        { entries: chunk, chunk: { index: i, total: totalChunks } },
        options
      )
    )
  }

  await Promise.allSettled(promises)
}

/**
 * Publish `records:invalidated` on the org channel — one frame per touched
 * entity def. Used by bulk-write paths (data-connector slice sync) that suppress
 * per-record realtime to keep an open grid live with a single coarse refetch per
 * def per slice instead of thousands of per-record events.
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

  const roomKey = rooms.orgPresence(organizationId)
  await Promise.allSettled(
    args.entityDefinitionIds.map((entityDefinitionId) =>
      realtimeService.publish(roomKey, 'records:invalidated', { entityDefinitionId }, options)
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

/** Resolve a nullable inboxId to its registry slug. `null` → `'none'`. */
function inboxRoom(organizationId: string, inboxId: string | null): string {
  return rooms.orgInbox(organizationId, inboxId ?? 'none')
}

/**
 * Publish `thread:created` on the inbox channel for the given thread.
 * `inboxId` is the raw EntityInstance id (or null for triage).
 */
export async function publishThreadCreated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { threadId: string; inboxId: string | null; inboxRecordId?: string | null },
  options?: MailPublishOptions
) {
  await realtimeService
    .publish(
      inboxRoom(organizationId, args.inboxId),
      'thread:created',
      { threadId: args.threadId, inboxId: args.inboxRecordId ?? null },
      options
    )
    .catch(() => {})
}

/**
 * Publish `thread:updated` with a partial patch on the inbox channel.
 * Pass `previousInboxId` when a thread's inboxId changes — the helper will
 * publish on both the old and new channels so users on each side see the
 * transition (FE drops the row from the old via filter, fetches on the new).
 */
export async function publishThreadUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: {
    threadId: string
    inboxId: string | null
    previousInboxId?: string | null
    patch: Partial<ThreadMeta>
  },
  options?: MailPublishOptions
) {
  const payload = { threadId: args.threadId, patch: { id: args.threadId, ...args.patch } }
  const targets = new Set<string | null>([args.inboxId])
  if (args.previousInboxId !== undefined && args.previousInboxId !== args.inboxId) {
    targets.add(args.previousInboxId ?? null)
  }
  await Promise.allSettled(
    Array.from(targets).map((inboxId) =>
      realtimeService.publish(
        inboxRoom(organizationId, inboxId),
        'thread:updated',
        payload,
        options
      )
    )
  )
}

/** Publish `thread:deleted` on the inbox channel. */
export async function publishThreadDeleted(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { threadId: string; inboxId: string | null },
  options?: MailPublishOptions
) {
  await realtimeService
    .publish(
      inboxRoom(organizationId, args.inboxId),
      'thread:deleted',
      { threadId: args.threadId },
      options
    )
    .catch(() => {})
}

/** Publish `message:created` on the inbox channel. */
export async function publishMessageCreated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { messageId: string; threadId: string; inboxId: string | null },
  options?: MailPublishOptions
) {
  await realtimeService
    .publish(
      inboxRoom(organizationId, args.inboxId),
      'message:created',
      { messageId: args.messageId, threadId: args.threadId },
      options
    )
    .catch(() => {})
}

/** Publish `message:updated` with a partial patch on the inbox channel. */
export async function publishMessageUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: {
    messageId: string
    threadId: string
    inboxId: string | null
    patch: Partial<MessageMeta>
  },
  options?: MailPublishOptions
) {
  await realtimeService
    .publish(
      inboxRoom(organizationId, args.inboxId),
      'message:updated',
      {
        messageId: args.messageId,
        threadId: args.threadId,
        patch: { id: args.messageId, threadId: args.threadId, ...args.patch },
      },
      options
    )
    .catch(() => {})
}

/** Publish `message:deleted` on the inbox channel. */
export async function publishMessageDeleted(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { messageId: string; threadId: string; inboxId: string | null },
  options?: MailPublishOptions
) {
  await realtimeService
    .publish(
      inboxRoom(organizationId, args.inboxId),
      'message:deleted',
      { messageId: args.messageId, threadId: args.threadId },
      options
    )
    .catch(() => {})
}

/**
 * Publish `participant:updated` on the org channel. Participants aren't
 * inbox-scoped (a contact can be on threads across many inboxes) so this
 * stays org-wide for v1.
 */
export async function publishParticipantUpdated(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { participantId: string; patch: Partial<ParticipantMeta> },
  options?: MailPublishOptions
) {
  await realtimeService
    .publish(
      rooms.orgPresence(organizationId),
      'participant:updated',
      {
        participantId: args.participantId,
        patch: { id: args.participantId, ...args.patch },
      },
      options
    )
    .catch(() => {})
}

/**
 * Signal the end of a server-side sync cycle that touched a given inbox. The
 * client listens and invalidates `thread.listIds` for the inbox — per-message
 * events are suppressed during sync to avoid the realtime → getByIds fan-out
 * that trips the tRPC mutation rate limit.
 */
export async function publishInboxSyncCompleted(
  realtimeService: RealtimeService,
  organizationId: string,
  args: { inboxId: string | null },
  options?: MailPublishOptions
) {
  await realtimeService
    .publish(
      inboxRoom(organizationId, args.inboxId),
      'inbox:syncCompleted',
      { inboxId: args.inboxId },
      options
    )
    .catch(() => {})
}

/**
 * Flush a list of mail events as one or more `mail:batch` frames on the inbox
 * channel. Used by ingest's initial-sync / polling-sync paths to coalesce
 * many events into a small number of frames. Events are chunked at
 * `CHUNK_SIZE` (50) per frame to stay under Pusher's 10KB limit.
 *
 * Events of mixed inboxId may be passed — they are bucketed and flushed per
 * inbox. Use `inboxId = null` for triage (unassigned).
 */
export async function flushMailBatch(
  realtimeService: RealtimeService,
  organizationId: string,
  events: Array<{ inboxId: string | null; event: MailSyncEvent }>,
  options?: MailPublishOptions
) {
  if (events.length === 0) return

  const buckets = new Map<string, MailSyncEvent[]>()
  for (const { inboxId, event } of events) {
    const slug = inboxId ?? 'none'
    if (!buckets.has(slug)) buckets.set(slug, [])
    buckets.get(slug)!.push(event)
  }

  const promises: Promise<boolean>[] = []
  for (const [slug, list] of buckets) {
    const roomKey = rooms.orgInbox(organizationId, slug)
    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const chunk = list.slice(i, i + CHUNK_SIZE)
      promises.push(realtimeService.publish(roomKey, 'mail:batch', { events: chunk }, options))
    }
  }
  await Promise.allSettled(promises)
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
