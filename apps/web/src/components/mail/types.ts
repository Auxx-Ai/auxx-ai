// apps/web/src/components/mail/types.ts

import type { RouterOutputs } from '~/trpc/react'
import type { ApiSearchFilter, ActorIdObject } from '@auxx/lib/mail-query/client'

export const VALID_STATUS_SLUGS = [
  'open',
  'done',
  'trash',
  'spam',
  'assigned',
  'unassigned',
  'all',
  'resolved', // Alias for 'done'
] as const
export type StatusSlug = (typeof VALID_STATUS_SLUGS)[number] | string
export const contextTypes = [
  'all_inboxes',
  'specific_inbox',
  'personal_inbox',
  'personal_assigned',
  'tag',
  'view',
  'drafts',
  'sent',
  'all',
]
export type ContextType = (typeof contextTypes)[number]
export type ThreadsFilterInput = {
  // Context - Represents the primary view/scope
  contextType:
    | 'personal_assigned' // /mail/assigned/*
    | 'personal_inbox' // /mail/inbox/*
    | 'drafts' // /mail/drafts
    | 'sent' // /mail/sent
    | 'tag' // /mail/tags/[id]/*
    | 'view' // /mail/views/[id]/*
    | 'all_inboxes' // /mail/inboxes/all/*
    | 'specific_inbox' // /mail/inboxes/[id]/*
    | 'all' // /mail/all/*
    | string // e.g., 'personal_assigned', 'tag', 'specific_inbox', etc.
  contextId?: string // Required for tag, view, specific_inbox
  /** Current user's ActorId for personal_inbox/personal_assigned client filtering */
  actorId?: ActorIdObject
  // Status - Represents the refinement based on the last URL segment
  statusSlug?: 'open' | 'done' | 'assigned' | 'unassigned'
  /** @deprecated Use filter instead */
  searchQuery?: string
  /** Structured API filter (preferred over searchQuery) */
  filter?: ApiSearchFilter
  // Sorting options
  sortBy?: 'newest' | 'oldest' | 'sender' | 'subject'
  sortDirection?: 'asc' | 'desc'
}
export type Message = RouterOutputs['thread']['getById']['messages'][number]
