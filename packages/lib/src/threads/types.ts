// packages/lib/src/threads/types.ts

import type { MessageAttachmentInfo } from '../messages/attachment-transformers'
import { InternalFilterContextType } from '../mail-query/types'
import { UrlBasedStatusFilter } from '../mail-query/filter-types'

/** Allowed fields that can be used when sorting thread lists. */
export type ThreadSortField = 'lastMessageAt' | 'subject' | 'sender'

/** Describes the field and direction requested when sorting threads. */
export interface ThreadSortDescriptor {
  field: ThreadSortField
  direction: 'asc' | 'desc'
}

/** Minimal representation of a tag that is attached to a thread. */
export interface ThreadTagSummary {
  id: string
  title: string
  color?: string | null
  emoji?: string | null
}

/** Represents a user or participant associated with a message or comment. */
export interface ThreadActorSummary {
  id?: string
  name?: string | null
  displayName?: string | null
  identifier?: string | null
  image?: string | null
}

/** Represents a participant entry for the summarized latest message. */
export interface ThreadParticipantSummary {
  role: string
  participant: ThreadActorSummary
}

/** Lightweight representation of the latest message for list responses. */
export interface ThreadMessageSummary {
  id: string
  threadId: string
  subject?: string | null
  snippet?: string | null
  textHtml?: string | null
  textPlain?: string | null
  sentAt?: Date | null
  lastAttemptAt?: Date | null
  createdAt: Date
  isInbound: boolean
  organizationId: string
  from?: ThreadActorSummary | null
  replyTo?: ThreadActorSummary | null
  participants?: ThreadParticipantSummary[]
}

/** Lightweight representation of the latest comment for list responses. */
export interface ThreadCommentSummary {
  id: string
  threadId: string
  content: string
  createdAt: Date
  createdBy: ThreadActorSummary
}

/**
 * Thread row returned by list queries. Includes lightweight relations required by the UI.
 */
export interface ThreadListItem {
  id: string
  subject: string
  organizationId: string
  status: string
  lastMessageAt?: Date | null
  firstMessageAt?: Date | null
  messageCount: number
  participantCount: number
  assigneeId?: string | null
  createdAt: Date
  assignee?: any
  inbox?: any
  isUnread?: boolean
  latestMessage?: ThreadMessageSummary | null
  messages?: ThreadMessageSummary[]
  latestComment?: ThreadCommentSummary | null
  tags?: ThreadTagSummary[]
}

/** Mapping of inbox/user unread counts keyed by scope. */
export type UserUnreadCounts = {
  [inboxId: string]: number
} & {
  inbox?: number
  assigned?: number
}

/** Represents a draft message returned by the detailed thread query. */
export interface DraftMessageType {
  id: string
  subject?: string | null
  snippet?: string | null
  sentAt?: Date | null
  sendStatus?: string | null
  providerError?: string | null
  attempts?: number | null
  lastAttemptAt?: Date | null
  draftMode: string
  createdById?: string | null
  createdAt: Date
  isInbound: boolean
  participants?: any[]
  from?: any
  replyTo?: any
  signature?: any
  attachments?: MessageAttachmentInfo[]
}

/** Detailed thread response returned by getThreadById. */
export interface ThreadWithDetails {
  id: string
  subject: string
  organizationId: string
  status: string
  lastMessageAt?: Date | null
  firstMessageAt?: Date | null
  messageCount: number
  participantCount: number
  assigneeId?: string | null
  createdAt: Date
  labels?: any[]
  tags?: any[]
  assignee?: any
  inbox?: any
  comments?: any[]
  messages: DraftMessageType[]
  isUnread?: boolean
  draftMessage: DraftMessageType | null
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

/** Paginated result returned by listThreads. */
export interface PaginatedThreadsResult {
  items: ThreadListItem[]
  nextCursor: string | null
  totalCount?: number
}
