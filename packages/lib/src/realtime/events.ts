// @auxx/lib/realtime/events.ts

import type { FieldValueKey } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import type { ThreadMergeData } from '../threads/types'

/** Stored field value — matches the client store's StoredFieldValue shape. */
export type StoredFieldValue = unknown

/** Persistent AI generation state published alongside a FieldValue. */
export type AiStatus = 'generating' | 'result' | 'error'

/**
 * Client-visible AI metadata. Mirrors the server-side bag that lives in
 * `FieldValue.valueJson`. All fields optional because each state populates a
 * different subset (generating: { jobId, requestedAt }; result: { model,
 * generatedAt, inputHash, tokens }; error: { errorMessage, failedAt }).
 */
export interface AiValueMetadata {
  model?: string
  generatedAt?: string
  inputHash?: string
  tokens?: { prompt: number; completion: number }
  jobId?: string
  errorMessage?: string
  failedAt?: string
  requestedAt?: string
}

/**
 * One entry in a fieldValues:updated payload.
 * - `value` absent means "don't touch the value in the store"
 * - `aiStatus`/`aiMetadata` absent means "don't touch the AI marker"
 * - `aiStatus: null` / `aiMetadata: null` explicitly clear the marker
 */
export interface FieldValueUpdateEntry {
  key: FieldValueKey
  value?: StoredFieldValue
  aiStatus?: AiStatus | null
  aiMetadata?: AiValueMetadata | null
}

/** All resource sync events sent over the org channel. */
export type ResourceSyncEvent =
  | FieldValuesUpdatedEvent
  | RecordCreatedEvent
  | RecordUpdatedEvent
  | RecordDeletedEvent
  | RecordArchivedEvent
  | RecordsInvalidatedEvent
  | ResourceDefChangedEvent
  | DataConnectorSyncEvent
  | DataExportJobEvent

/** Field values changed (from mutations, triggers, cost recalc, etc.) */
export interface FieldValuesUpdatedEvent {
  event: 'fieldValues:updated'
  data: {
    entries: FieldValueUpdateEntry[]
    chunk?: { index: number; total: number }
  }
}

/**
 * Record metadata for lifecycle events.
 *
 * All denormalized columns optional so partial updates stay cheap — the
 * field-value mutation layer emits `record:updated` with only the column
 * it just changed (see `maybeUpdateDisplayValue`). Missing != null; the
 * front-end should merge only fields that are present.
 */
export interface RecordMeta {
  id: string
  recordId: RecordId
  displayName?: string
  secondaryDisplayValue?: string | null
  /** URL or encoded visual ref — see `EntityInstance.avatarUrl` doc-comment. */
  avatarUrl?: string | null
  createdAt?: string
  updatedAt?: string
}

/** A new record was created. */
export interface RecordCreatedEvent {
  event: 'record:created'
  data: {
    entityDefinitionId: string
    record: RecordMeta
    fieldValues?: Array<{ key: FieldValueKey; value: StoredFieldValue }>
  }
}

/**
 * A record's denormalized columns changed (displayName, secondaryDisplayValue,
 * avatarUrl, updatedAt). Fires from two places:
 *   - `maybeUpdateDisplayValue` (field-value mutation layer) — whenever a
 *     field write causes a denormalized column to change. Payload carries
 *     only the changed column plus updatedAt.
 *   - `updateEntityAvatarIfApplicable` (thumbnail-job callback) — when the
 *     avatar-128 preset resolves to a CDN URL after a FILE-ref write.
 * Field-value changes themselves still go through fieldValues:updated.
 */
export interface RecordUpdatedEvent {
  event: 'record:updated'
  data: {
    entityDefinitionId: string
    record: RecordMeta
  }
}

/** A record was hard-deleted. */
export interface RecordDeletedEvent {
  event: 'record:deleted'
  data: {
    recordId: RecordId
    entityDefinitionId: string
  }
}

/** A record was archived (soft-deleted). */
export interface RecordArchivedEvent {
  event: 'record:archived'
  data: {
    recordId: RecordId
    entityDefinitionId: string
  }
}

/**
 * Coarse "refresh this entity def" signal. Emitted ONCE per touched def per
 * bulk-write slice (data-connector sync) in place of the thousands of per-record
 * `record:created` / `fieldValues:updated` events those writes suppress. The
 * client invalidates the def's visible list + `listFiltered` query — a single
 * refetch that re-pulls records + field values — instead of the per-record
 * firehose that 403s Pusher at backfill scale.
 */
export interface RecordsInvalidatedEvent {
  event: 'records:invalidated'
  data: {
    entityDefinitionId: string
  }
}

/**
 * An entity DEFINITION (resource) was created / renamed / removed — fires from
 * every server path that creates/updates/deletes a def (UI `EntityDefinitionService`
 * AND background connector provisioning). Coarse + invalidation-only, mirroring
 * `records:invalidated`: the resource list is small and cheap, so the client
 * refetches it rather than merging a payload. Three names (not one `kind` field)
 * keep the client `switch` uniform with the record events. Payload is minimal —
 * add `apiSlug`/`singular` later only if a consumer needs an optimistic insert.
 */
export interface ResourceDefChangedEvent {
  event: 'resource:created' | 'resource:updated' | 'resource:deleted'
  data: { entityDefinitionId: string }
}

/**
 * Live data-connector sync signal on the org channel. Lets the connector detail
 * view move WITHOUT the 4s `getStatus` poll (and lights up webhook/scheduled runs
 * the poll never armed for). The payload mirrors the realtime-relevant subset of
 * `getStatus` so the client can patch the cached query directly on the hot
 * `progress` path; lifecycle edges (`run-started` / `run-finished`) refetch the
 * authoritative shape (new run row, freshness, schedule, resyncPending).
 *
 * `kind` is purely a client routing hint — `progress` patches in place, the two
 * lifecycle kinds invalidate. Fields are raw DB column values (free-text status /
 * trigger) the client normalizes, matching how `getStatus` returns them.
 */
export interface DataConnectorSyncEvent {
  event: 'dataConnector:sync'
  data: {
    connectorId: string
    kind: 'run-started' | 'progress' | 'run-finished'
    /** Connector lifecycle status: 'syncing' | 'provisioning' | 'live' | 'error' | 'paused' | … */
    connectorStatus: string
    /** ISO; advances on a successful finalize. Null when never synced. */
    lastSyncedAt: string | null
    /** Latest run snapshot (the connector's newest `DataConnectorRun`). */
    runId?: string
    runStatus?: string
    phase?: 'backfill' | 'steady' | null
    trigger?: string
    /** Live aggregate records-seen across all streams (sum of per-stream state). */
    recordsSeen: number
    created: number
    updated: number
    perStream: {
      streamKey: string
      recordsSeen: number
      phase: 'backfill' | 'steady'
      done: boolean
    }[]
  }
}

/**
 * Live CSV-export progress signal on the org channel. A background export job
 * (see `packages/lib/src/jobs/export`) emits `started` once, throttled `progress`
 * frames as it pages through records, and `finished` on completion/failure.
 *
 * `kind` is a client routing hint: `progress` patches the cached `dataExport.getById`
 * counters in place; `started` / `finished` invalidate it to pull the authoritative
 * row (status, fileName, size). Payload is kept small (<10KB) for Pusher/Soketi.
 */
export interface DataExportJobEvent {
  event: 'dataExport:job'
  data: {
    exportJobId: string
    kind: 'started' | 'progress' | 'finished'
    /** Terminal/lifecycle status: 'processing' | 'completed' | 'failed' | 'canceled'. */
    status?: string
    /** Rows processed so far (progress frames). */
    processed?: number
    /** Total matching rows (known after the first page). */
    total?: number
    /** Output file name (finished frames). */
    fileName?: string
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Mail sync events (thread / message / participant)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Partial-by-design thread metadata for mail realtime patches.
 * Missing keys mean "don't touch", `null` means "clear".
 */
export interface ThreadMeta {
  id: string
  inboxId?: RecordId | null
  status?: 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH' | 'IGNORED'
  subject?: string
  assigneeId?: string | null
  ticketId?: RecordId | null
  isUnread?: boolean
  /** Per-user unread fanout: when present, FE filters to current user before applying */
  userId?: string
  messageCount?: number
  participantCount?: number
  firstMessageAt?: string | null
  lastMessageAt?: string | null
  latestMessageId?: string | null
  updatedAt?: string
  /** Chat-only: AI vs human handoff state. Drives the take-over button UI. */
  handoffState?: 'ai' | 'human'
  /**
   * Channel-specific extras (`Thread.metadata` JSONB). Patch semantics: omit =
   * unchanged; `null` = clear; object = full replacement. Chat threads carry
   * `ChatThreadMetadata`; other channels may carry `{ importance }`.
   */
  metadata?: Record<string, unknown> | null
  /** Soft-merge pointer — target Thread RecordId or null when unmerged/target. */
  mergedIntoThreadId?: RecordId | null
  /**
   * Full replacement of the denormalized merge state (same semantics as
   * `metadata`). Null clears the entry; object replaces it whole.
   */
  mergeData?: ThreadMergeData | null
}

/**
 * Attachment shape used inside realtime message patches. Mirrors the
 * client-side `AttachmentMeta` so a `message:updated` patch can fully replace
 * a message's attachments array (e.g. swapping optimistic file-ids for the
 * server-side `Attachment.id`s).
 */
export interface AttachmentMeta {
  id: string
  name: string
  mimeType: string | null
  size: number | null
  url: string | null
  inline: boolean
  contentId: string | null
}

/**
 * Partial-by-design message metadata for mail realtime patches.
 */
export interface MessageMeta {
  id: string
  threadId: string
  subject?: string | null
  snippet?: string | null
  sentAt?: string | null
  receivedAt?: string | null
  isInbound?: boolean
  hasAttachments?: boolean
  attachments?: AttachmentMeta[]
  fromId?: string | null
  sendStatus?: 'PENDING' | 'SENT' | 'FAILED' | null
  providerError?: string | null
  attempts?: number
  updatedAt?: string
}

/**
 * Partial-by-design participant metadata for mail realtime patches.
 */
export interface ParticipantMeta {
  id: string
  displayName?: string
  name?: string | null
  avatarUrl?: string | null
  hasReceivedMessage?: boolean
  lastSentMessageAt?: string | null
  isInternal?: boolean
}

/** A new thread was created. Payload carries threadId + inboxId for routing. */
export interface ThreadCreatedEvent {
  event: 'thread:created'
  data: {
    threadId: string
    inboxId: RecordId | null
  }
}

/** Thread metadata changed. Carries inline partial patch. */
export interface ThreadUpdatedEvent {
  event: 'thread:updated'
  data: {
    threadId: string
    patch: Partial<ThreadMeta>
  }
}

/** Thread was hard-deleted. */
export interface ThreadDeletedEvent {
  event: 'thread:deleted'
  data: {
    threadId: string
  }
}

/** A new message was created on a thread. */
export interface MessageCreatedEvent {
  event: 'message:created'
  data: {
    messageId: string
    threadId: string
  }
}

/** Message metadata changed. */
export interface MessageUpdatedEvent {
  event: 'message:updated'
  data: {
    messageId: string
    threadId: string
    patch: Partial<MessageMeta>
  }
}

/** Message was deleted. */
export interface MessageDeletedEvent {
  event: 'message:deleted'
  data: {
    messageId: string
    threadId: string
  }
}

/** Participant metadata changed (org channel). */
export interface ParticipantUpdatedEvent {
  event: 'participant:updated'
  data: {
    participantId: string
    patch: Partial<ParticipantMeta>
  }
}

/** Initial-sync / polling-sync flush — bundles many events into a single frame. */
export interface MailBatchEvent {
  event: 'mail:batch'
  data: {
    events: MailSyncEvent[]
  }
}

/**
 * Signals the end of a server-side sync cycle that touched the inbox. Per-message
 * realtime publishes are suppressed during sync (otherwise a backfill of N
 * messages fans out into N events → N `getByIds` mutations → rate limit).
 * The client invalidates `thread.listIds` for the inbox on receipt; subsequent
 * thread / message data is loaded lazily on demand.
 */
export interface InboxSyncCompletedEvent {
  event: 'inbox:syncCompleted'
  data: {
    /** Raw EntityInstance id of the inbox, or null for the triage (`none`) channel. */
    inboxId: string | null
  }
}

/** Union of all mail sync events. */
export type MailSyncEvent =
  | ThreadCreatedEvent
  | ThreadUpdatedEvent
  | ThreadDeletedEvent
  | MessageCreatedEvent
  | MessageUpdatedEvent
  | MessageDeletedEvent
  | ParticipantUpdatedEvent
  | MailBatchEvent
  | InboxSyncCompletedEvent

// ════════════════════════════════════════════════════════════════════════════
// Agent admin events (org channel)
// ════════════════════════════════════════════════════════════════════════════

/**
 * An agent's admin-view fields changed (prompt / toolsets / knowledge /
 * identity / triggers / archive state). Fires from every server path that
 * already calls `onCacheEvent('agent.created' | 'agent.updated' |
 * 'agent.archived', …)`. The client uses this only as a refresh signal;
 * the payload carries nothing the rail needs to apply directly.
 */
export interface AgentUpdatedEvent {
  event: 'agent:updated'
  data: { agentId: string }
}

/**
 * A procedure's draft or admin fields changed server-side outside the editor's
 * own save path (today: Kopilot authoring tools — create / set body / criteria).
 * Refresh signal only; the payload carries nothing the client applies directly.
 */
export interface ProcedureUpdatedEvent {
  event: 'procedure:updated'
  data: { procedureId: string; agentId: string }
}

/**
 * An agent's simulation (eval) cases changed server-side — a case was created,
 * updated, or deleted (today: the Kopilot `create_eval_case` /
 * `update_eval_case_mock` tools, or the case editor). The Simulations tab uses
 * this purely as a refresh signal to re-list `eval.list` for the agent; the
 * payload carries only the agent id to scope which tab refetches.
 */
export interface EvalCaseChangedEvent {
  event: 'eval:case-changed'
  data: { agentId: string }
}

/**
 * A saved table view changed server-side — created, edited, made default, or
 * deleted (today: the Kopilot record-view tools). Refresh signal only: the
 * records page re-lists `tableView.listAll` and re-seeds the dynamic-table
 * store. `tableId` scopes which table changed; `kind` is for debugging.
 */
export interface TableViewChangedEvent {
  event: 'tableView:changed'
  data: { tableId?: string; kind: 'created' | 'updated' | 'defaultChanged' | 'deleted' }
}
