export { mapUrlSlugToStatusFilter } from './filter-types'
export enum FilterOperator {
  AND = 'AND',
  OR = 'OR',
}

export enum ConditionType {
  // INTEGRATION = 'INTEGRATION', // Removed
  TAG = 'TAG',
  LABEL = 'LABEL',
  ASSIGNEE = 'ASSIGNEE',
  STATUS = 'STATUS', // Refers to ThreadStatus (OPEN, ARCHIVED, TRASH, SPAM)
  DATE = 'DATE',
  SENDER = 'SENDER', // Filtering by sender needs adjustment for new schema
  SUBJECT = 'SUBJECT',
  INBOX = 'INBOX', // Filters by Thread.inboxId
  // Add more types as needed, e.g., PARTICIPANT
}

export enum ComparisonOperator {
  EQUALS = 'EQUALS',
  NOT_EQUALS = 'NOT_EQUALS',
  CONTAINS = 'CONTAINS',
  NOT_CONTAINS = 'NOT_CONTAINS',
  IN = 'IN',
  NOT_IN = 'NOT_IN',
  BEFORE = 'BEFORE',
  AFTER = 'AFTER',
  IS_EMPTY = 'IS_EMPTY',
  IS_NOT_EMPTY = 'IS_NOT_EMPTY',
}

// Filter structure interfaces
export interface FilterCondition {
  type: ConditionType
  operator: ComparisonOperator
  value: any // Type depends on ConditionType and Operator
  field?: string // Optional field name for specific conditions (e.g., date field)
}

export interface MailViewFilter {
  operator: FilterOperator
  conditions: (FilterCondition | MailViewFilter)[]
}

// Interface matching client-side data structure for assignees
export interface TeamMember {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
}

export enum InternalFilterContextType {
  PERSONAL_ASSIGNED = 'personal_assigned', // User's view: /mail/assigned/* - Explicitly assigned to user
  PERSONAL_INBOX = 'personal_inbox', // User's view: /mail/inbox/* - Assigned to user (effectively same as PERSONAL_ASSIGNED)
  TAG = 'tag', // Context: /mail/tags/[tagId]/*
  VIEW = 'view', // Context: /mail/views/[viewId]/* - Uses MailViewFilter definition
  ALL_INBOXES = 'all_inboxes', // Context: /mail/inboxes/all/* - Org-wide view (respects user access if needed later)
  SPECIFIC_INBOX = 'specific_inbox', // Context: /mail/inboxes/[inboxId]/* - Shared inbox view
  DRAFTS = 'drafts', // Standalone view: /mail/drafts - User's drafts (needs specific logic)
  SENT = 'sent', // Standalone view: /mail/sent - User's sent items (needs specific logic)
  ALL = 'all', // Standalone view: /mail/all - All messages
}
