// packages/lib/src/resources/registry/enum-values.ts

import type { FieldOptionItem } from './option-helpers'

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
    { value: 'GENERAL', label: 'General Support' },
    { value: 'MISSING_ITEM', label: 'Missing Item' },
    { value: 'RETURN', label: 'Return Request' },
    { value: 'REFUND', label: 'Refund Request' },
    { value: 'PRODUCT_ISSUE', label: 'Product Issue' },
    { value: 'SHIPPING_ISSUE', label: 'Shipping Issue' },
    { value: 'BILLING', label: 'Billing Issue' },
    { value: 'TECHNICAL', label: 'Technical Support' },
    { value: 'OTHER', label: 'Other' },
  ] satisfies FieldOptionItem[],
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
    { value: 'OPEN', label: 'Open' },
    { value: 'IN_PROGRESS', label: 'In Progress' },
    { value: 'WAITING_FOR_CUSTOMER', label: 'Waiting for Customer' },
    { value: 'WAITING_FOR_THIRD_PARTY', label: 'Waiting for Third Party' },
    { value: 'RESOLVED', label: 'Resolved' },
    { value: 'CLOSED', label: 'Closed' },
    { value: 'CANCELLED', label: 'Cancelled' },
    { value: 'MERGED', label: 'Merged' },
  ] satisfies FieldOptionItem[],
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
    { value: 'LOW', label: 'Low' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'HIGH', label: 'High' },
    { value: 'URGENT', label: 'Urgent' },
  ] satisfies FieldOptionItem[],
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
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
    { value: 'SPAM', label: 'Spam' },
    { value: 'MERGED', label: 'Merged' },
  ] satisfies FieldOptionItem[],
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
    { value: 'EMAIL', label: 'Email' },
    { value: 'TICKET_SYSTEM', label: 'Ticket System' },
    { value: 'SHOPIFY', label: 'Shopify' },
    { value: 'MANUAL', label: 'Manual' },
    { value: 'OTHER', label: 'Other' },
    { value: 'FACEBOOK_PSID', label: 'Facebook PSID' },
  ] satisfies FieldOptionItem[],
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
    { value: 'EMAIL', label: 'Email' },
    { value: 'CHAT', label: 'Chat' },
  ] satisfies FieldOptionItem[],
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
    { value: 'OPEN', label: 'Open' },
    { value: 'ARCHIVED', label: 'Archived' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'RESOLVED', label: 'Resolved' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'CLOSED', label: 'Closed' },
    { value: 'SPAM', label: 'Spam' },
    { value: 'TRASH', label: 'Trash' },
  ] satisfies FieldOptionItem[],
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
    { value: 'EMAIL', label: 'Email' },
    { value: 'FACEBOOK', label: 'Facebook' },
    { value: 'SMS', label: 'SMS' },
    { value: 'WHATSAPP', label: 'WhatsApp' },
    { value: 'INSTAGRAM', label: 'Instagram' },
    { value: 'OPENPHONE', label: 'OpenPhone' },
    { value: 'CHAT', label: 'Chat' },
  ] satisfies FieldOptionItem[],
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
    { value: 'READ', label: 'Mark as Read' },
    { value: 'UNREAD', label: 'Mark as Unread' },
  ] satisfies FieldOptionItem[],
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
    { value: 'add', label: 'Add tags' },
    { value: 'remove', label: 'Remove tags' },
    { value: 'set', label: 'Replace all tags' },
  ] satisfies FieldOptionItem[],
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
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
    { value: 'PROCESSING', label: 'Processing' },
    { value: 'ERROR', label: 'Error' },
  ] satisfies FieldOptionItem[],
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
    { value: 'POSTGRESQL', label: 'PostgreSQL' },
    { value: 'CHROMA', label: 'Chroma' },
    { value: 'QDRANT', label: 'Qdrant' },
    { value: 'WEAVIATE', label: 'Weaviate' },
    { value: 'PINECONE', label: 'Pinecone' },
    { value: 'MILVUS', label: 'Milvus' },
  ] satisfies FieldOptionItem[],
} as const
