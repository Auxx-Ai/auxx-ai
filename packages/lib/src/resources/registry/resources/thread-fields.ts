// packages/lib/src/workflow-engine/resources/registry/resources/thread-fields.ts

import { FieldType } from '@auxx/database/enums'
import { BaseType } from '../../types'
import { toFieldId, type ResourceFieldId } from '@auxx/types/field'
import type { ResourceField } from '../field-types'
import { ThreadStatus, ReadStatus } from '../enum-values'

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
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'id',
    systemSortOrder: 'a0',
    showInPanel: false,
    dbColumn: 'id',
    nullable: false,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique thread identifier',
  },

  externalId: {
    id: toFieldId('externalId'),
    key: 'externalId',
    label: 'External ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'external_id',
    showInPanel: false, // Internal field
    dbColumn: 'externalId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'External provider thread ID',
  },

  // ============================================================================
  // UPDATABLE ACTION FIELDS
  // ============================================================================

  subject: {
    id: toFieldId('subject'),
    key: 'subject',
    label: 'Subject',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'subject',
    systemSortOrder: 'a1',
    dbColumn: 'subject',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description: 'Rename the thread subject',
    placeholder: 'Enter new subject',
  },

  // Note: type removed - column no longer exists in database schema
  // Thread type is now derived from Integration.provider

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'thread_status',
    systemSortOrder: 'a2',
    dbColumn: 'status',
    nullable: false,
    options: { options: ThreadStatus.values },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    defaultValue: 'OPEN',
    description: 'Change thread status (Open, Archive, Spam, Trash)',
  },

  // Note: messageType removed - it's now derived from Integration.provider
  // Use helper function getMessageTypeFromProvider() to get message type

  messageCount: {
    id: toFieldId('messageCount'),
    key: 'messageCount',
    label: 'Message Count',
    type: BaseType.NUMBER,
    fieldType: FieldType.NUMBER,
    isSystem: true,
    systemAttribute: 'message_count',
    showInPanel: false, // Internal metric
    dbColumn: 'messageCount',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Number of messages in thread',
  },

  firstMessageAt: {
    id: toFieldId('firstMessageAt'),
    key: 'firstMessageAt',
    label: 'First Message At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'first_message_at',
    showInPanel: false, // Internal metric
    dbColumn: 'firstMessageAt',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Timestamp of first message',
  },

  lastMessageAt: {
    id: toFieldId('lastMessageAt'),
    key: 'lastMessageAt',
    label: 'Last Message',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'last_message_at',
    systemSortOrder: 'a7',
    dbColumn: 'lastMessageAt',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Timestamp of last message',
  },

  closedAt: {
    id: toFieldId('closedAt'),
    key: 'closedAt',
    label: 'Closed At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'closed_at',
    showInPanel: false, // Internal timestamp
    dbColumn: 'closedAt',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Timestamp when thread was closed',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a6',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when thread is created',
  },

  assignee: {
    id: toFieldId('assignee'),
    key: 'assignee',
    label: 'Assignee',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'assignee_id',
    systemSortOrder: 'a3',
    dynamicOptionsKey: 'teamMembers',
    dbColumn: 'assigneeId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: null,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    description: 'Assign thread to a team member',
    placeholder: 'Select assignee',
  },

  inbox: {
    id: toFieldId('inbox'),
    key: 'inbox',
    label: 'Inbox',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'inbox_id',
    systemSortOrder: 'a4',
    dynamicOptionsKey: 'inboxes',
    dbColumn: 'inboxId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: null,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    description: 'Move thread to a different inbox',
    placeholder: 'Select destination inbox',
  },

  messages: {
    id: toFieldId('messages'),
    key: 'messages',
    label: 'Messages',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'thread_messages',
    showInPanel: false, // Relationship reverse-field
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'message:thread' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: true,
    },
    description: 'All messages in this thread',
  },

  // ============================================================================
  // VIRTUAL ACTION FIELDS (no direct DB column)
  // ============================================================================

  readStatus: {
    id: toFieldId('readStatus'),
    key: 'readStatus',
    label: 'Read Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'read_status',
    showInPanel: false, // Virtual action field
    dbColumn: undefined,
    nullable: true,
    options: { options: ReadStatus.values },
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true,
      configurable: false,
    },
    description: 'Mark thread as read or unread for the current user',
  },

  tags: {
    id: toFieldId('tags'),
    key: 'tags',
    label: 'Tags',
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    isSystem: true,
    systemAttribute: 'thread_tags',
    systemSortOrder: 'a5',
    dbColumn: undefined, // Stored in FieldValue
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'tag:threads' as ResourceFieldId,
      relationshipType: 'has_many',
      isInverse: false,
    },
    description: 'Tags assigned to this thread',
    placeholder: 'Select tags',
  },
}
