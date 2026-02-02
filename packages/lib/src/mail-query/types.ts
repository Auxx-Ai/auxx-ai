// packages/lib/src/mail-query/types.ts

/**
 * Defines the primary context for filtering threads, derived from URL structure or API call intent.
 * Examples: User viewing their assigned items, viewing a specific shared inbox, etc.
 */
export enum InternalFilterContextType {
  PERSONAL_ASSIGNED = 'personal_assigned', // User's view: /mail/assigned/* - Explicitly assigned to user
  PERSONAL_INBOX = 'personal_inbox', // User's view: /mail/inbox/* - Assigned to user (effectively same as PERSONAL_ASSIGNED)
  TAG = 'tag', // Context: /mail/tags/[tagId]/*
  VIEW = 'view', // Context: /mail/views/[viewId]/* - Uses ConditionGroup[] definition
  ALL_INBOXES = 'all_inboxes', // Context: /mail/inboxes/all/* - Org-wide view (respects user access if needed later)
  SPECIFIC_INBOX = 'specific_inbox', // Context: /mail/inboxes/[inboxId]/* - Shared inbox view
  DRAFTS = 'drafts', // Standalone view: /mail/drafts - User's drafts (needs specific logic)
  SENT = 'sent', // Standalone view: /mail/sent - User's sent items (needs specific logic)
  ALL = 'all', // Standalone view: /mail/all - All messages
}
