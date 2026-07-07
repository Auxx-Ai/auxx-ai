// packages/lib/src/threads/types.ts

import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import type { ConditionGroup } from '../conditions/types'

/** Allowed fields that can be used when sorting thread lists. */
export type ThreadSortField = 'lastMessageAt' | 'subject' | 'sender'

/**
 * Denormalized merge state stored on `Thread.mergeData`.
 *
 * Mutually exclusive: a thread is either a `target` (other threads merged
 * into it) OR a `source` (it was merged into another), never both. The
 * flatten-on-merge invariant prevents intermediate nodes from existing —
 * after every merge, sources/descendants point directly at the final
 * target and `sources[]` contains the full transitive ancestry.
 */
export interface ThreadMergeData {
  /**
   * Target-side: present when other threads have been merged INTO this one.
   * Flattened — always holds the full transitive ancestry, not just direct
   * sources.
   */
  sources?: ThreadMergeSourceEntry[]
  /**
   * Source-side: present when this thread was merged INTO another. Always
   * points at the CURRENT final target after every flatten pass.
   */
  target?: ThreadMergeTargetEntry
}

/** One entry in `ThreadMergeData.sources[]`. */
export interface ThreadMergeSourceEntry {
  threadId: string
  /** Subject snapshot taken at merge time. */
  subject: string
  /** ISO timestamp — when this thread entered the chain. */
  mergedAt: string
  mergedById: string
  /** Batch this thread joined in. */
  batchId: string
  /** Snapshot count of messages moved off this source. */
  messageCount: number
}

/** Source-side merge pointer stored on `Thread.mergeData.target`. */
export interface ThreadMergeTargetEntry {
  threadId: string
  /** Target subject snapshot taken at merge time. */
  subject: string
  /** ISO timestamp — when this thread was originally merged. */
  mergedAt: string
  mergedById: string
  batchId: string
}

/** Describes the field and direction requested when sorting threads. */
export interface ThreadSortDescriptor {
  field: ThreadSortField
  direction: 'asc' | 'desc'
}

/** Mapping of inbox/user unread counts keyed by scope. */
export type UserUnreadCounts = {
  [inboxId: string]: number
} & {
  inbox?: number
  assigned?: number
}

/**
 * Full counts response for mail sidebar.
 * Includes personal inbox, drafts, shared inboxes, and view counts.
 */
export interface FullCountsResponse {
  /** Unread threads assigned to user with OPEN status */
  inbox: number
  /** All drafts created by user (from Draft table) */
  drafts: number
  /** Per-inbox unread counts keyed by inbox ID */
  sharedInboxes: Record<string, number>
  /** Per-view unread counts keyed by view ID */
  views: Record<string, number>
}

// ============================================================================
// New ID-first batch-fetch types (Phase 1 refactor)
// ============================================================================

/** Input for listing thread IDs with pagination. */
export interface ListThreadIdsInput {
  /** Condition-based filter (ConditionGroup[]) */
  filter: ConditionGroup[]
  /** Sort options */
  sort?: ThreadSortDescriptor
  /** Pagination cursor */
  cursor?: string
  /** Page size (max 100) */
  limit?: number
  /** User ID - required for DRAFTS context to fetch user's standalone drafts */
  userId?: string
}

/** Optional filters for thread list queries. */
export interface ThreadFilter {
  isUnread?: boolean
  hasAttachments?: boolean
  tagIds?: string[]
  search?: string
}

/** Paginated result containing record IDs (may include threads and standalone drafts). */
export interface PaginatedIdsResult {
  /** RecordIds in format "entityType:instanceId" (e.g., "thread:abc123" or "draft:xyz789") */
  ids: RecordId[]
  total: number
  nextCursor: string | null
}

/** Thread status enum type. */
export type ThreadStatus = 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH' | 'IGNORED'

/** Integration provider enum type. */
export type ChannelProvider = 'GMAIL' | 'OUTLOOK' | 'FACEBOOK' | 'INSTAGRAM' | 'OPENPHONE'

/**
 * Core thread metadata for batch fetching.
 * Contains minimal data needed for list display - frontend resolves related entities separately.
 */
export interface ThreadMeta {
  id: string
  subject: string
  status: ThreadStatus
  lastMessageAt: string // ISO date
  firstMessageAt: string | null
  messageCount: number
  participantCount: number

  // Foreign keys (IDs only - frontend resolves via separate stores)
  integrationId: string
  integrationProvider: ChannelProvider | null
  /** True when the thread belongs to an example (seeded) integration that can't actually send. */
  integrationIsExample: boolean

  /**
   * Assignee as branded ActorId string (e.g., "user:abc123").
   * Null if thread is unassigned.
   * Use parseActorId() from @auxx/types/actor to extract type and raw ID.
   */
  assigneeId: ActorId | null

  // Denormalized for performance (avoid extra fetches for list display)
  latestMessageId: string | null
  latestCommentId: string | null

  /** Inbox RecordId (format: "entityDefinitionId:instanceId") or null if unassigned */
  inboxId: RecordId | null

  /**
   * @deprecated Use `primaryEntity` instead. Surfaced for backwards compat:
   * non-null only when the thread's primary entity happens to be a Ticket.
   */
  ticketId: RecordId | null

  /**
   * Primary EntityInstance linked to this thread (deal, ticket, lead, …) or
   * null. Replaces the legacy ticket-only `ticketId` on the storage side.
   */
  primaryEntity: RecordId | null

  // External ID for chat threads (e.g., Facebook conversation ID)
  externalId: string | null

  /** Tag RecordIds (format: "entityDefinitionId:instanceId") */
  tagIds: RecordId[]

  // Read status for the requesting user
  isUnread: boolean

  /** Draft RecordIds for the requesting user on this thread (format: "draft:draftId") */
  draftIds: RecordId[]

  /** Number of pending scheduled messages on this thread */
  scheduledMessageCount: number

  /**
   * Whether the AI agent or a human is currently driving replies on this
   * thread. Chat-only signal; email threads always read `'ai'` (no agent run
   * happens regardless). Drives the take-over / return-to-AI buttons.
   */
  handoffState: 'ai' | 'human'

  /**
   * Channel-specific extras stored on `Thread.metadata` (JSONB). Chat threads
   * carry `ChatThreadMetadata` here; other channels may carry `{ importance }`
   * or be null. Loose shape — not enforced at the DB level.
   */
  metadata: Record<string, unknown> | null

  /**
   * Soft-merge pointer: target Thread RecordId when this thread has been
   * merged into another. Null when this thread is a target or unmerged.
   */
  mergedIntoThreadId: RecordId | null

  /**
   * Denormalized merge state. Carries `target` when this thread is merged
   * into another; `sources[]` (full flattened ancestry) when other threads
   * have been merged into this one. Null when the thread is neither.
   */
  mergeData: ThreadMergeData | null

  /**
   * The requesting viewer's effective lens on this thread (mail-permissions
   * §4). The batch evaluator computes it anyway; exposing it powers the FE's
   * redacted rendering (`LensBadge`, placeholder rows) without a second
   * request. Never `'none'` — such threads are dropped from the batch.
   */
  myLens: 'metadata' | 'subject' | 'full'

  /**
   * True when the thread has explicit instance grants (shares). Operational
   * metadata (metadata tier) — drives the list rows' share indicator and the
   * header button's avatar cluster hint.
   */
  hasShares: boolean
}

/**
 * Extended thread data returned for single thread detail view.
 */
export interface ThreadDetail extends ThreadMeta {
  messageIds: string[]
}

/**
 * Shape of `Thread.metadata` for chat-channel threads.
 *
 * Stored loosely in JSON; not enforced at the DB level. The `claimedVisitor*`
 * fields are unverified (v1) and not read by the AI.
 */
export interface ChatThreadMetadata {
  channel: 'chat'
  /** The chat integration id (DB column is still `integrationId`). */
  channelId: string
  /** Participant id of the chat-widget visitor; encoded on the Thread so the
   *  outbound provider can look it up without querying messages. */
  visitorParticipantId: string
  visit?: {
    userAgent?: string
    ipAddress?: string
    referrer?: string
    url?: string
    /** City resolved from the request IP via `@auxx/lib/geo`. */
    city?: string
    /** First-level subdivision (US state, Canadian province, etc.). */
    region?: string
    /** Country name. */
    country?: string
    /** IANA timezone, e.g. `America/Los_Angeles`. */
    timezone?: string
  }
  claimedVisitorEmail?: string
  claimedVisitorName?: string
  /** Embedder-supplied external id (e.g. customer id in the host app). Unverified in v1. */
  claimedExternalId?: string
  /**
   * Friendly handle derived from the visitor's session identifier (e.g.
   * `Chat user #354b`). Frozen at thread-creation time so the sidebar can
   * render it without an extra Participant fetch.
   */
  visitorLabel?: string
}
