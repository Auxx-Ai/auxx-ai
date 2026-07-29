// packages/lib/src/mail-query/types.ts

/**
 * Defines the primary context for filtering threads, derived from URL structure or API call intent.
 * Examples: User viewing their assigned items, viewing a specific shared inbox, etc.
 *
 * ⚠ **`PERSONAL_INBOX` is a NAME COLLISION, not a synonym** (plan 40a §8.2). Its
 * value `'personal_inbox'` is also an `EntityDefinition.entityType`
 * (`EntityType.PERSONAL_INBOX`, `@auxx/database/enums`) — the def that owns a
 * user's own mailbox. These mean OPPOSITE things: the member below is a mail-URL
 * context meaning **"assigned to me"** (a filter over threads in ANY inbox);
 * the owner's actual personal mailbox is {@link PERSONAL_CHANNEL}. The two live in
 * disjoint keyspaces — this enum never reaches `getCachedEntityDefId` or a
 * RecordId prefix — so there is no runtime intersection, but every grep for the
 * def slug lands here. Do not "unify" them.
 */
export enum InternalFilterContextType {
  PERSONAL_ASSIGNED = 'personal_assigned', // User's view: /mail/assigned/* - Explicitly assigned to user
  // NOT the `personal_inbox` EntityDefinition — see the collision note above.
  PERSONAL_INBOX = 'personal_inbox', // User's view: /mail/inbox/* - Assigned to user (effectively same as PERSONAL_ASSIGNED)
  SHARED_WITH_ME = 'shared_with_me', // Context: /mail/shared/* - Threads explicitly shared with the user
  TAG = 'tag', // Context: /mail/tags/[tagId]/*
  VIEW = 'view', // Context: /mail/views/[viewId]/* - Uses ConditionGroup[] definition
  ALL_INBOXES = 'all_inboxes', // Context: /mail/inboxes/all/* - Org-wide view (respects user access if needed later)
  SPECIFIC_INBOX = 'specific_inbox', // Context: /mail/inboxes/[inboxId]/* - Shared inbox view
  PERSONAL_CHANNEL = 'personal_channel', // Context: /mail/personal/[inboxId]/* - Owner's personal inbox (§11), personal tabs
  DRAFTS = 'drafts', // Standalone view: /mail/drafts - User's drafts (needs specific logic)
  SENT = 'sent', // Standalone view: /mail/sent - User's sent items (needs specific logic)
  ALL = 'all', // Standalone view: /mail/all - All messages
}
