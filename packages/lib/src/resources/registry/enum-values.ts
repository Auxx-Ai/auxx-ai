// packages/lib/src/workflow-engine/resources/registry/enum-values.ts

import type { EnumValue } from './field-types'

/**
 * Ticket Type Enum
 * Source: packages/database/src/db/schema/_shared.ts:451
 * Database enum: ticketType
 */
export const TicketType = {
  GENERAL: 'GENERAL',
  MISSING_ITEM: 'MISSING_ITEM',
  RETURN: 'RETURN',
  REFUND: 'REFUND',
  PRODUCT_ISSUE: 'PRODUCT_ISSUE',
  SHIPPING_ISSUE: 'SHIPPING_ISSUE',
  BILLING: 'BILLING',
  TECHNICAL: 'TECHNICAL',
  OTHER: 'OTHER',

  values: [
    { dbValue: 'GENERAL', label: 'General Support' },
    { dbValue: 'MISSING_ITEM', label: 'Missing Item' },
    { dbValue: 'RETURN', label: 'Return Request' },
    { dbValue: 'REFUND', label: 'Refund Request' },
    { dbValue: 'PRODUCT_ISSUE', label: 'Product Issue' },
    { dbValue: 'SHIPPING_ISSUE', label: 'Shipping Issue' },
    { dbValue: 'BILLING', label: 'Billing Issue' },
    { dbValue: 'TECHNICAL', label: 'Technical Support' },
    { dbValue: 'OTHER', label: 'Other' },
  ] as EnumValue[],
} as const

/**
 * Ticket Status Enum
 * Source: packages/database/src/db/schema/_shared.ts:441
 * Database enum: ticketStatus
 */
export const TicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_FOR_CUSTOMER: 'WAITING_FOR_CUSTOMER',
  WAITING_FOR_THIRD_PARTY: 'WAITING_FOR_THIRD_PARTY',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  MERGED: 'MERGED',

  values: [
    { dbValue: 'OPEN', label: 'Open' },
    { dbValue: 'IN_PROGRESS', label: 'In Progress' },
    { dbValue: 'WAITING_FOR_CUSTOMER', label: 'Waiting for Customer' },
    { dbValue: 'WAITING_FOR_THIRD_PARTY', label: 'Waiting for Third Party' },
    { dbValue: 'RESOLVED', label: 'Resolved' },
    { dbValue: 'CLOSED', label: 'Closed' },
    { dbValue: 'CANCELLED', label: 'Cancelled' },
    { dbValue: 'MERGED', label: 'Merged' },
  ] as EnumValue[],
} as const

/**
 * Ticket Priority Enum
 * Source: packages/database/src/db/schema/_shared.ts:440
 * Database enum: ticketPriority
 */
export const TicketPriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',

  values: [
    { dbValue: 'LOW', label: 'Low' },
    { dbValue: 'MEDIUM', label: 'Medium' },
    { dbValue: 'HIGH', label: 'High' },
    { dbValue: 'URGENT', label: 'Urgent' },
  ] as EnumValue[],
} as const

/**
 * Contact/Customer Status Enum
 * Source: packages/database/src/db/schema/_shared.ts:80
 * Database enum: customerStatus
 */
export const ContactStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SPAM: 'SPAM',
  MERGED: 'MERGED',

  values: [
    { dbValue: 'ACTIVE', label: 'Active' },
    { dbValue: 'INACTIVE', label: 'Inactive' },
    { dbValue: 'SPAM', label: 'Spam' },
    { dbValue: 'MERGED', label: 'Merged' },
  ] as EnumValue[],
} as const

/**
 * Customer Source Type Enum
 * Source: packages/database/src/db/schema/_shared.ts:72
 * Database enum: customerSourceType
 */
export const CustomerSourceType = {
  EMAIL: 'EMAIL',
  TICKET_SYSTEM: 'TICKET_SYSTEM',
  SHOPIFY: 'SHOPIFY',
  MANUAL: 'MANUAL',
  OTHER: 'OTHER',
  FACEBOOK_PSID: 'FACEBOOK_PSID',

  values: [
    { dbValue: 'EMAIL', label: 'Email' },
    { dbValue: 'TICKET_SYSTEM', label: 'Ticket System' },
    { dbValue: 'SHOPIFY', label: 'Shopify' },
    { dbValue: 'MANUAL', label: 'Manual' },
    { dbValue: 'OTHER', label: 'Other' },
    { dbValue: 'FACEBOOK_PSID', label: 'Facebook PSID' },
  ] as EnumValue[],
} as const

/**
 * Thread Type Enum
 * Source: packages/database/src/db/schema/_shared.ts:439
 * Database enum: threadType
 */
export const ThreadType = {
  EMAIL: 'EMAIL',
  CHAT: 'CHAT',

  values: [
    { dbValue: 'EMAIL', label: 'Email' },
    { dbValue: 'CHAT', label: 'Chat' },
  ] as EnumValue[],
} as const

/**
 * Thread Status Enum
 * Source: packages/database/src/db/schema/_shared.ts:424
 * Database enum: threadStatus
 */
export const ThreadStatus = {
  OPEN: 'OPEN',
  ARCHIVED: 'ARCHIVED',
  ACTIVE: 'ACTIVE',
  RESOLVED: 'RESOLVED',
  PENDING: 'PENDING',
  CLOSED: 'CLOSED',
  SPAM: 'SPAM',
  TRASH: 'TRASH',

  values: [
    { dbValue: 'OPEN', label: 'Open' },
    { dbValue: 'ARCHIVED', label: 'Archived' },
    { dbValue: 'ACTIVE', label: 'Active' },
    { dbValue: 'RESOLVED', label: 'Resolved' },
    { dbValue: 'PENDING', label: 'Pending' },
    { dbValue: 'CLOSED', label: 'Closed' },
    { dbValue: 'SPAM', label: 'Spam' },
    { dbValue: 'TRASH', label: 'Trash' },
  ] as EnumValue[],
} as const

/**
 * Message Type Enum
 * Source: packages/database/src/db/schema/_shared.ts:228
 * Database enum: messageType
 */
export const MessageType = {
  EMAIL: 'EMAIL',
  FACEBOOK: 'FACEBOOK',
  SMS: 'SMS',
  WHATSAPP: 'WHATSAPP',
  INSTAGRAM: 'INSTAGRAM',
  OPENPHONE: 'OPENPHONE',
  CHAT: 'CHAT',

  values: [
    { dbValue: 'EMAIL', label: 'Email' },
    { dbValue: 'FACEBOOK', label: 'Facebook' },
    { dbValue: 'SMS', label: 'SMS' },
    { dbValue: 'WHATSAPP', label: 'WhatsApp' },
    { dbValue: 'INSTAGRAM', label: 'Instagram' },
    { dbValue: 'OPENPHONE', label: 'OpenPhone' },
    { dbValue: 'CHAT', label: 'Chat' },
  ] as EnumValue[],
} as const

/**
 * Read Status Enum
 * Virtual enum for thread read/unread actions (not a database enum)
 * Used for CRUD thread update operations
 */
export const ReadStatus = {
  READ: 'READ',
  UNREAD: 'UNREAD',

  values: [
    { dbValue: 'READ', label: 'Mark as Read' },
    { dbValue: 'UNREAD', label: 'Mark as Unread' },
  ] as EnumValue[],
} as const

/**
 * Tag Operation Enum
 * Virtual enum for specifying how to apply tags to threads
 * Used for CRUD thread update operations
 */
export const TagOperation = {
  ADD: 'add',
  REMOVE: 'remove',
  SET: 'set',

  values: [
    { dbValue: 'add', label: 'Add tags' },
    { dbValue: 'remove', label: 'Remove tags' },
    { dbValue: 'set', label: 'Replace all tags' },
  ] as EnumValue[],
} as const

/**
 * Dataset Status Enum
 * Source: packages/database/src/db/schema/_shared.ts:91
 * Database enum: datasetStatus
 */
export const DatasetStatusEnum = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  PROCESSING: 'PROCESSING',
  ERROR: 'ERROR',

  values: [
    { dbValue: 'ACTIVE', label: 'Active' },
    { dbValue: 'INACTIVE', label: 'Inactive' },
    { dbValue: 'PROCESSING', label: 'Processing' },
    { dbValue: 'ERROR', label: 'Error' },
  ] as EnumValue[],
} as const

/**
 * Vector Database Type Enum
 * Source: packages/database/src/db/schema/_shared.ts:469
 * Database enum: vectorDbType
 */
export const VectorDbTypeEnum = {
  POSTGRESQL: 'POSTGRESQL',
  CHROMA: 'CHROMA',
  QDRANT: 'QDRANT',
  WEAVIATE: 'WEAVIATE',
  PINECONE: 'PINECONE',
  MILVUS: 'MILVUS',

  values: [
    { dbValue: 'POSTGRESQL', label: 'PostgreSQL' },
    { dbValue: 'CHROMA', label: 'Chroma' },
    { dbValue: 'QDRANT', label: 'Qdrant' },
    { dbValue: 'WEAVIATE', label: 'Weaviate' },
    { dbValue: 'PINECONE', label: 'Pinecone' },
    { dbValue: 'MILVUS', label: 'Milvus' },
  ] as EnumValue[],
} as const
