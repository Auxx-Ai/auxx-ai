// packages/lib/src/workflow-engine/resources/registry/resources/thread-fields.ts

import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'
import { ThreadStatus, ReadStatus, TagOperation } from '../enum-values'

/**
 * Field definitions for the Thread resource
 * Defines all fields, their types, capabilities, and validation rules
 *
 * Thread Action Fields:
 * Unlike traditional CRUD fields that directly update database columns, some fields
 * are "action fields" that trigger specific operations with their own business logic.
 * These map to ThreadMutationService/UnreadService methods.
 */
export const THREAD_FIELDS: Record<string, ResourceField> = {
  id: {
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    dbColumn: 'id',
    nullable: false,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    description: 'Unique thread identifier',
  },

  externalId: {
    key: 'externalId',
    label: 'External ID',
    type: BaseType.STRING,
    dbColumn: 'externalId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    description: 'External provider thread ID',
  },

  // ============================================================================
  // UPDATABLE ACTION FIELDS
  // ============================================================================

  subject: {
    key: 'subject',
    label: 'Subject',
    type: BaseType.STRING,
    dbColumn: 'subject',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true, // Enable for update - maps to ThreadMutationService.updateThreadSubject
    },
    description: 'Rename the thread subject',
    placeholder: 'Enter new subject',
  },

  // Note: type removed - column no longer exists in database schema
  // Thread type is now derived from Integration.provider

  status: {
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    dbColumn: 'status',
    nullable: false,
    enumValues: ThreadStatus.values,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true, // Enable for update - maps to ThreadMutationService.updateThreadStatus
    },
    defaultValue: 'OPEN',
    description: 'Change thread status (Open, Archive, Spam, Trash)',
  },

  // Note: messageType removed - it's now derived from Integration.provider
  // Use helper function getMessageTypeFromProvider() to get message type

  messageCount: {
    key: 'messageCount',
    label: 'Message Count',
    type: BaseType.NUMBER,
    dbColumn: 'messageCount',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Number of messages in thread',
  },

  firstMessageAt: {
    key: 'firstMessageAt',
    label: 'First Message At',
    type: BaseType.DATETIME,
    dbColumn: 'firstMessageAt',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Timestamp of first message',
  },

  lastMessageAt: {
    key: 'lastMessageAt',
    label: 'Last Message At',
    type: BaseType.DATETIME,
    dbColumn: 'lastMessageAt',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Timestamp of last message',
  },

  closedAt: {
    key: 'closedAt',
    label: 'Closed At',
    type: BaseType.DATETIME,
    dbColumn: 'closedAt',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Timestamp when thread was closed',
  },

  createdAt: {
    key: 'createdAt',
    label: 'Created At',
    type: BaseType.DATETIME,
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
    },
    description: 'Automatically set when thread is created',
  },

  assignee: {
    key: 'assignee',
    label: 'Assignee',
    type: BaseType.RELATION,
    dbColumn: 'assigneeId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: true, // Enable for update - maps to ThreadMutationService.assignThread
    },
    relationship: {
      targetTable: 'user',
      targetField: 'id',
      cardinality: 'many-to-one',
      required: false,
    },
    description: 'Assign thread to a team member',
    placeholder: 'Select assignee',
  },

  inbox: {
    key: 'inbox',
    label: 'Move to Inbox',
    type: BaseType.RELATION,
    dbColumn: 'inboxId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: true, // Enable for update - maps to ThreadMutationService.moveThreadsToInbox
    },
    relationship: {
      targetTable: 'inbox',
      targetField: 'id',
      cardinality: 'many-to-one',
      required: false,
    },
    description: 'Move thread to a different inbox',
    placeholder: 'Select destination inbox',
  },

  messages: {
    key: 'messages',
    label: 'Messages',
    type: BaseType.RELATION,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    relationship: {
      targetTable: 'message',
      cardinality: 'one-to-many',
      reciprocalField: 'thread',
    },
    description: 'All messages in this thread',
  },

  // ============================================================================
  // VIRTUAL ACTION FIELDS (no direct DB column)
  // ============================================================================

  readStatus: {
    key: 'readStatus',
    label: 'Read Status',
    type: BaseType.ENUM,
    dbColumn: undefined, // Virtual - no direct DB column, handled by ThreadReadStatus table
    nullable: true,
    enumValues: ReadStatus.values,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true, // Virtual but updatable - maps to UnreadService methods
    },
    description: 'Mark thread as read or unread for the current user',
  },

  tags: {
    key: 'tags',
    label: 'Tags',
    type: BaseType.TAGS,
    dbColumn: undefined, // Junction table - not a direct column
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true, // Virtual but updatable - maps to ThreadMutationService.tagThreadsBulk
    },
    description: 'Add, remove, or set tags on thread',
    placeholder: 'Select tags',
  },

  tagOperation: {
    key: 'tagOperation',
    label: 'Tag Operation',
    type: BaseType.ENUM,
    dbColumn: undefined, // Virtual - used to specify how to apply tags
    nullable: true,
    enumValues: TagOperation.values,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true, // Virtual - used in conjunction with tags field
    },
    defaultValue: 'add',
    description: 'How to apply tags: add, remove, or replace all',
  },
}
