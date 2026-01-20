// packages/lib/src/workflow-engine/resources/registry/resources/message-fields.ts

import { BaseType } from '../../types'
import { toFieldId, type ResourceFieldId } from '@auxx/types/field'
import type { ResourceField } from '../field-types'
// Note: MessageType import removed - messageType field no longer exists in schema

/**
 * Field definitions for the Message resource
 * Defines all fields, their types, capabilities, and validation rules
 */
export const MESSAGE_FIELDS: Record<string, ResourceField> = {
  id: {
    id: toFieldId('id'),
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
      configurable: false,
    },
    description: 'Unique message identifier',
  },

  externalId: {
    id: toFieldId('externalId'),
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
      configurable: false,
    },
    description: 'External provider message ID',
  },

  externalThreadId: {
    id: toFieldId('externalThreadId'),
    key: 'externalThreadId',
    label: 'External Thread ID',
    type: BaseType.STRING,
    dbColumn: 'externalThreadId',
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

  subject: {
    id: toFieldId('subject'),
    key: 'subject',
    label: 'Subject',
    type: BaseType.STRING,
    dbColumn: 'subject',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Message subject',
  },

  textHtml: {
    id: toFieldId('textHtml'),
    key: 'textHtml',
    label: 'HTML Content',
    type: BaseType.STRING,
    dbColumn: 'textHtml',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'HTML content of message',
  },

  textPlain: {
    id: toFieldId('textPlain'),
    key: 'textPlain',
    label: 'Plain Text',
    type: BaseType.STRING,
    dbColumn: 'textPlain',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Plain text content of message',
  },

  // Note: messageType removed - it's now derived from Integration.provider
  // Use helper function getMessageTypeFromProvider() to get message type

  isInbound: {
    id: toFieldId('isInbound'),
    key: 'isInbound',
    label: 'Is Inbound',
    type: BaseType.BOOLEAN,
    dbColumn: 'isInbound',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Whether message is inbound',
  },

  // Note: isAutoReply removed - column no longer exists in database schema

  isFirstInThread: {
    id: toFieldId('isFirstInThread'),
    key: 'isFirstInThread',
    label: 'Is First In Thread',
    type: BaseType.BOOLEAN,
    dbColumn: 'isFirstInThread',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Whether this is the first message in thread',
  },

  isReply: {
    id: toFieldId('isReply'),
    key: 'isReply',
    label: 'Is Reply',
    type: BaseType.BOOLEAN,
    dbColumn: 'isReply',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Whether message is a reply',
  },

  sentAt: {
    id: toFieldId('sentAt'),
    key: 'sentAt',
    label: 'Sent At',
    type: BaseType.DATETIME,
    dbColumn: 'sentAt',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Timestamp when message was sent',
  },

  receivedAt: {
    id: toFieldId('receivedAt'),
    key: 'receivedAt',
    label: 'Received At',
    type: BaseType.DATETIME,
    dbColumn: 'receivedAt',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Timestamp when message was received',
  },

  hasAttachments: {
    id: toFieldId('hasAttachments'),
    key: 'hasAttachments',
    label: 'Has Attachments',
    type: BaseType.BOOLEAN,
    dbColumn: 'hasAttachments',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Whether message has attachments',
  },

  thread: {
    id: toFieldId('thread'),
    key: 'thread',
    label: 'Thread',
    type: BaseType.RELATION,
    dbColumn: 'threadId',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: 'thread:messages' as ResourceFieldId,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    description: 'Thread this message belongs to',
  },

  createdBy: {
    id: toFieldId('createdBy'),
    key: 'createdBy',
    label: 'Created By',
    type: BaseType.RELATION,
    dbColumn: 'createdById',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: null,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    description: 'User who created this message',
  },

  from: {
    id: toFieldId('from'),
    key: 'from',
    label: 'From',
    type: BaseType.RELATION,
    dbColumn: 'fromId',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: null,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    description: 'Participant who sent this message',
  },

  replyTo: {
    id: toFieldId('replyTo'),
    key: 'replyTo',
    label: 'Reply To',
    type: BaseType.RELATION,
    dbColumn: 'replyToId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    relationship: {
      inverseResourceFieldId: null,
      relationshipType: 'belongs_to',
      isInverse: false,
    },
    description: 'Participant to reply to',
  },
}
