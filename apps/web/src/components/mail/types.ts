// apps/web/src/components/mail/types.ts

import type { ConditionGroup } from '@auxx/lib/conditions'
import type { MessageType } from './email-editor/types'

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

/** Sort descriptor for thread lists */
export interface ThreadSort {
  field: 'lastMessageAt' | 'subject' | 'sender'
  direction: 'asc' | 'desc'
}

/** Input for thread list filtering - uses unified condition-based filter */
export type ThreadsFilterInput = {
  /** Condition-based filter (ConditionGroup[]) */
  filter: ConditionGroup[]
  /** Sort options */
  sort?: ThreadSort
}

export type Message = MessageType
