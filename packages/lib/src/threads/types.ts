// packages/lib/src/threads/types.ts

import { InternalFilterContextType } from '../mail-query/types'
import { UrlBasedStatusFilter } from '../mail-query/filter-types'
import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'

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

/** Input payload accepted by the thread list service. */
export interface ListThreadsInput {
  userId?: string
  context:
    | {
        type: InternalFilterContextType.PERSONAL_ASSIGNED
      }
    | {
        type: InternalFilterContextType.PERSONAL_INBOX
      }
    | {
        type: InternalFilterContextType.DRAFTS
      }
    | {
        type: InternalFilterContextType.SENT
      }
    | {
        type: InternalFilterContextType.ALL_INBOXES
      }
    | {
        type: InternalFilterContextType.TAG
        id: string
      }
    | {
        type: InternalFilterContextType.VIEW
        id: string
      }
    | {
        type: InternalFilterContextType.SPECIFIC_INBOX
        id: string
      }
    | {
        type: InternalFilterContextType.ALL
      }
  statusFilter?: UrlBasedStatusFilter
  searchQuery?: string
  sort?: ThreadSortDescriptor
}

// ============================================================================
// New ID-first batch-fetch types (Phase 1 refactor)
// ============================================================================

/** Input for listing thread IDs with pagination. */
export interface ListThreadIdsInput {
  context: ListThreadsInput['context']
  userId?: string
  statusFilter?: UrlBasedStatusFilter
  filter?: ThreadFilter
  sort?: ThreadSortDescriptor
  cursor?: string
  limit?: number
}

/** Optional filters for thread list queries. */
export interface ThreadFilter {
  isUnread?: boolean
  hasAttachments?: boolean
  tagIds?: string[]
  search?: string
}

/** Paginated result containing only IDs. */
export interface PaginatedIdsResult {
  ids: string[]
  total: number
  nextCursor: string | null
}

/** Thread status enum type. */
export type ThreadStatus = 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH'

/** Integration provider enum type. */
export type IntegrationProvider = 'GMAIL' | 'OUTLOOK' | 'FACEBOOK' | 'INSTAGRAM' | 'OPENPHONE'

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
  integrationProvider: IntegrationProvider | null

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

  // External ID for chat threads (e.g., Facebook conversation ID)
  externalId: string | null

  /** Tag RecordIds (format: "entityDefinitionId:instanceId") */
  tagIds: RecordId[]

  // Read status for the requesting user
  isUnread: boolean

  /** Draft RecordIds for the requesting user on this thread (format: "draft:draftId") */
  draftIds: RecordId[]
}

/**
 * Extended thread data returned for single thread detail view.
 */
export interface ThreadDetail extends ThreadMeta {
  messageIds: string[]
}
