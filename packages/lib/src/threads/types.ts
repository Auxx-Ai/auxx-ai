// packages/lib/src/threads/types.ts

import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import type { ConditionGroup } from '../conditions/types'

/** Allowed fields that can be used when sorting thread lists. */
export type ThreadSortField = 'lastMessageAt' | 'subject' | 'sender'

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
export type ThreadStatus = 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH'

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

  /** Ticket EntityInstance ID this thread is linked to, or null */
  ticketId: RecordId | null

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
}

/**
 * Extended thread data returned for single thread detail view.
 */
export interface ThreadDetail extends ThreadMeta {
  messageIds: string[]
}
