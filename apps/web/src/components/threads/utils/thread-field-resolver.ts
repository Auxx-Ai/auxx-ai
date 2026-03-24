// apps/web/src/components/threads/utils/thread-field-resolver.ts

import { FIELD_NOT_RESOLVABLE, type FieldResolver } from '@auxx/lib/conditions/client'
import { parseRecordId } from '@auxx/types/resource'
import type { ThreadMeta } from '../store'

/**
 * Field resolver for ThreadMeta entities.
 * Maps condition fieldIds to thread properties.
 *
 * Used by evaluateConditions to filter threads client-side
 * for optimistic updates (e.g., archive, assign, tag).
 */
export const threadFieldResolver: FieldResolver<ThreadMeta> = (thread, fieldId) => {
  switch (fieldId) {
    // Status — return raw DB value (OPEN, ARCHIVED, TRASH, SPAM).
    // Virtual values (assigned, unassigned, done) are handled by normalizeStatusConditions
    // which expands them into DB-level status + assignee conditions before evaluation.
    case 'status':
      return thread.status ?? null

    // Inbox field - return instance ID for comparison
    case 'inbox':
      return thread.inboxId ? parseRecordId(thread.inboxId).entityInstanceId : null

    // Assignee fields
    case 'assignee':
      return thread.assigneeId

    // Read status
    case 'isUnread':
    case 'unread':
      return thread.isUnread

    // Tags - return array of instance IDs
    case 'tag':
    case 'tags':
      return thread.tagIds?.map((id) => parseRecordId(id).entityInstanceId) ?? []

    // Text fields
    case 'subject':
      return thread.subject

    // Date fields
    case 'lastMessageAt':
    case 'date':
      return thread.lastMessageAt

    case 'firstMessageAt':
      return thread.firstMessageAt

    // Counts
    case 'messageCount':
      return thread.messageCount

    case 'participantCount':
      return thread.participantCount

    // Integration
    case 'integrationId':
      return thread.integrationId

    case 'integrationProvider':
      return thread.integrationProvider

    // Draft status
    case 'hasDraft':
      return thread.draftIds && thread.draftIds.length > 0

    default:
      // Field not available on ThreadMeta (e.g. freeText, from, to, hasAttachments)
      // — these require server-side SQL joins. Return sentinel so the evaluator
      // treats the condition as "pass" (the server already filtered for it).
      return FIELD_NOT_RESOLVABLE
  }
}
