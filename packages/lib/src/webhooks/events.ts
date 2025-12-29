// @auxx/lib/webhooks/events.ts

export const WEBHOOK_EVENT_TYPES = {
  // User events
  USER_CREATED: 'user:created',
  USER_UPDATED: 'user:updated',
  USER_DELETED: 'user:deleted',
  USER_INVITED: 'membership:created',

  // Organization events
  // ORGANIZATION_CREATED: 'organization:created',
  // ORGANIZATION_UPDATED: 'organization:updated',
  // ORGANIZATION_DELETED: 'organization:deleted',

  // Ticket events
  TICKET_CREATED: 'ticket:created',
  TICKET_UPDATED: 'ticket:updated',
  TICKET_DELETED: 'ticket:deleted',
  TICKET_STATUS_CHANGED: 'ticket:status:changed',
  TICKET_ASSIGNED: 'ticket:assignee:added',
  TICKET_UNASSIGNED: 'ticket:assignee:removed',

  // message events

  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_SENT: 'message:sent',
  MESSAGE_FAILED: 'message:failed',
  MESSAGE_COMMENT_CREATED: 'message:comment:created',
  MESSAGE_ASSIGNEE_CHANGED: 'message:assignee:changed',
  MESSAGE_TAG_ADDED: 'message:tag:added',
  MESSAGE_TAG_REMOVED: 'message:tag:removed',

  // thread events
  THREAD_MOVED: 'thread:moved',
  THREAD_ARCHIVED: 'thread:archived',
  THREAD_DELETED: 'thread:deleted',
  THREAD_REOPENED: 'thread:reopened',
  THREAD_RESTORED: 'thread:restored',

  // workflow events
  WORKFLOW_PAUSED: 'workflow:paused',
  WORKFLOW_RESUMED: 'workflow:resumed',
  WORKFLOW_RESUME_FAILED: 'workflow:resume:failed',

  // Comment events
  // COMMENT_CREATED: 'comment:created',
  // COMMENT_UPDATED: 'comment:updated',
  // COMMENT_DELETED: 'comment:deleted',

  // Email events
  // EMAIL_RECEIVED: 'email:received',
  // EMAIL_SENT: 'email:sent',
} as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[keyof typeof WEBHOOK_EVENT_TYPES]

// UI grouping for the command component
export const eventTypesList = [
  {
    value: 'user',
    label: 'User events',
    items: [
      { value: WEBHOOK_EVENT_TYPES.USER_CREATED, label: 'User Created' },
      { value: WEBHOOK_EVENT_TYPES.USER_UPDATED, label: 'User Updated' },
      { value: WEBHOOK_EVENT_TYPES.USER_DELETED, label: 'User Deleted' },
      { value: WEBHOOK_EVENT_TYPES.USER_INVITED, label: 'User Invited' },
    ],
  },
  // {
  //   value: 'organization',
  //   label: 'Organization events',
  //   items: [
  //     { value: WEBHOOK_EVENT_TYPES.ORGANIZATION_CREATED, label: 'Organization Created' },
  //     { value: WEBHOOK_EVENT_TYPES.ORGANIZATION_UPDATED, label: 'Organization Updated' },
  //     { value: WEBHOOK_EVENT_TYPES.ORGANIZATION_DELETED, label: 'Organization Deleted' },
  //   ],
  // },
  {
    value: 'message',
    label: 'Message events',
    items: [
      { value: WEBHOOK_EVENT_TYPES.MESSAGE_RECEIVED, label: 'Message Received' },
      { value: WEBHOOK_EVENT_TYPES.MESSAGE_SENT, label: 'Message Sent' },
      { value: WEBHOOK_EVENT_TYPES.MESSAGE_FAILED, label: 'Message Failed' },
      { value: WEBHOOK_EVENT_TYPES.MESSAGE_COMMENT_CREATED, label: 'Message Comment Created' },
      { value: WEBHOOK_EVENT_TYPES.MESSAGE_ASSIGNEE_CHANGED, label: 'Message Assignee Change' },
      { value: WEBHOOK_EVENT_TYPES.MESSAGE_TAG_ADDED, label: 'Message Tag Added' },
      { value: WEBHOOK_EVENT_TYPES.MESSAGE_TAG_REMOVED, label: 'Message Tag Removed' },
    ],
  },
  {
    value: 'thread',
    label: 'Message events',
    items: [
      { value: WEBHOOK_EVENT_TYPES.THREAD_MOVED, label: 'Thread Moved' },
      { value: WEBHOOK_EVENT_TYPES.THREAD_ARCHIVED, label: 'Thread Archived' },
      { value: WEBHOOK_EVENT_TYPES.THREAD_DELETED, label: 'Thread Deleted' },
      { value: WEBHOOK_EVENT_TYPES.THREAD_REOPENED, label: 'Thread Reopened' },
      { value: WEBHOOK_EVENT_TYPES.THREAD_RESTORED, label: 'Thread Restored' },
    ],
  },

  {
    value: 'ticket',
    label: 'Ticket events',
    items: [
      { value: WEBHOOK_EVENT_TYPES.TICKET_CREATED, label: 'Ticket Created' },
      { value: WEBHOOK_EVENT_TYPES.TICKET_UPDATED, label: 'Ticket Updated' },
      { value: WEBHOOK_EVENT_TYPES.TICKET_DELETED, label: 'Ticket Deleted' },
      { value: WEBHOOK_EVENT_TYPES.TICKET_STATUS_CHANGED, label: 'Ticket Status Changed' },
      { value: WEBHOOK_EVENT_TYPES.TICKET_ASSIGNED, label: 'Ticket Assigned' },
      { value: WEBHOOK_EVENT_TYPES.TICKET_UNASSIGNED, label: 'Ticket Unassigned' },
    ],
  },

  {
    value: 'workflow',
    label: 'Workflow events',
    items: [
      { value: WEBHOOK_EVENT_TYPES.WORKFLOW_PAUSED, label: 'Workflow Paused' },
      { value: WEBHOOK_EVENT_TYPES.WORKFLOW_RESUMED, label: 'Workflow Resumed' },
      { value: WEBHOOK_EVENT_TYPES.WORKFLOW_RESUME_FAILED, label: 'Workflow Resume Failed' },
    ],
  },

  // {
  //   value: 'comment',
  //   label: 'Comment events',
  //   items: [
  //     { value: WEBHOOK_EVENT_TYPES.COMMENT_CREATED, label: 'Comment Created' },
  //     { value: WEBHOOK_EVENT_TYPES.COMMENT_UPDATED, label: 'Comment Updated' },
  //     { value: WEBHOOK_EVENT_TYPES.COMMENT_DELETED, label: 'Comment Deleted' },
  //   ],
  // },
  // {
  //   value: 'email',
  //   label: 'Email events',
  //   items: [
  //     { value: WEBHOOK_EVENT_TYPES.EMAIL_RECEIVED, label: 'Email Received' },
  //     { value: WEBHOOK_EVENT_TYPES.EMAIL_SENT, label: 'Email Sent' },
  //   ],
  // },
]
