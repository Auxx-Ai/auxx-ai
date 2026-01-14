// packages/lib/src/workflow-engine/resources/registry/resources/thread-fields.ts

import { FieldType } from '@auxx/database/enums'
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
    id: 'id',
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemSortOrder: -1,
    showInPanel: false,
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
    id: 'externalId',
    key: 'externalId',
    label: 'External ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    showInPanel: false, // Internal field
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
    id: 'subject',
    key: 'subject',
    label: 'Subject',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemSortOrder: 10,
    dbColumn: 'subject',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
    },
    description: 'Rename the thread subject',
    placeholder: 'Enter new subject',
  },

  // Note: type removed - column no longer exists in database schema
  // Thread type is now derived from Integration.provider

  status: {
    id: 'status',
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemSortOrder: 20,
    dbColumn: 'status',
    nullable: false,
    enumValues: ThreadStatus.values,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
    },
    defaultValue: 'OPEN',
    description: 'Change thread status (Open, Archive, Spam, Trash)',
  },

  // Note: messageType removed - it's now derived from Integration.provider
  // Use helper function getMessageTypeFromProvider() to get message type

  messageCount: {
    id: 'messageCount',
    key: 'messageCount',
    label: 'Message Count',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    showInPanel: false, // Internal metric
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
    id: 'firstMessageAt',
    key: 'firstMessageAt',
    label: 'First Message At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    showInPanel: false, // Internal metric
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
    id: 'lastMessageAt',
    key: 'lastMessageAt',
    label: 'Last Message',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemSortOrder: 101,
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
    id: 'closedAt',
    key: 'closedAt',
    label: 'Closed At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    showInPanel: false, // Internal timestamp
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
    id: 'createdAt',
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemSortOrder: 100,
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
    id: 'assignee',
    key: 'assignee',
    label: 'Assignee',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemSortOrder: 40,
    dynamicOptionsKey: 'teamMembers',
    dbColumn: 'assigneeId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: true,
    },
    relationship: {
      relatedEntityDefinitionId: 'user',
      relationshipType: 'belongs_to',
    },
    description: 'Assign thread to a team member',
    placeholder: 'Select assignee',
  },

  inbox: {
    id: 'inbox',
    key: 'inbox',
    label: 'Inbox',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemSortOrder: 45,
    dynamicOptionsKey: 'inboxes',
    dbColumn: 'inboxId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: true,
    },
    relationship: {
      relatedEntityDefinitionId: 'inbox',
      relationshipType: 'belongs_to',
    },
    description: 'Move thread to a different inbox',
    placeholder: 'Select destination inbox',
  },

  messages: {
    id: 'messages',
    key: 'messages',
    label: 'Messages',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    showInPanel: false, // Relationship reverse-field
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: false,
    },
    relationship: {
      relatedEntityDefinitionId: 'message',
      relationshipType: 'has_many',
    },
    description: 'All messages in this thread',
  },

  // ============================================================================
  // VIRTUAL ACTION FIELDS (no direct DB column)
  // ============================================================================

  readStatus: {
    id: 'readStatus',
    key: 'readStatus',
    label: 'Read Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    showInPanel: false, // Virtual action field
    dbColumn: undefined,
    nullable: true,
    enumValues: ReadStatus.values,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true,
    },
    description: 'Mark thread as read or unread for the current user',
  },

  tags: {
    id: 'tags',
    key: 'tags',
    label: 'Tags',
    type: BaseType.TAGS,
    fieldType: FieldType.TAGS,
    isSystem: true,
    systemSortOrder: 50,
    dynamicOptionsKey: 'tags',
    dbColumn: undefined,
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true,
    },
    description: 'Add, remove, or set tags on thread',
    placeholder: 'Select tags',
  },

  tagOperation: {
    id: 'tagOperation',
    key: 'tagOperation',
    label: 'Tag Operation',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    showInPanel: false, // Internal operation field
    dbColumn: undefined,
    nullable: true,
    enumValues: TagOperation.values,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true,
    },
    defaultValue: 'add',
    description: 'How to apply tags: add, remove, or replace all',
  },
}
