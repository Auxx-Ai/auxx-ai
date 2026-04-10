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
    { value: 'GENERAL', label: 'General Support', color: 'blue' },
    { value: 'MISSING_ITEM', label: 'Missing Item', color: 'orange' },
    { value: 'RETURN', label: 'Return Request', color: 'purple' },
    { value: 'REFUND', label: 'Refund Request', color: 'amber' },
    { value: 'PRODUCT_ISSUE', label: 'Product Issue', color: 'red' },
    { value: 'SHIPPING_ISSUE', label: 'Shipping Issue', color: 'teal' },
    { value: 'BILLING', label: 'Billing Issue', color: 'indigo' },
    { value: 'TECHNICAL', label: 'Technical Support', color: 'pink' },
    { value: 'OTHER', label: 'Other', color: 'gray' },
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
    { value: 'OPEN', label: 'Open', color: 'blue' },
    { value: 'IN_PROGRESS', label: 'In Progress', color: 'amber' },
    { value: 'WAITING_FOR_CUSTOMER', label: 'Waiting for Customer', color: 'orange' },
    { value: 'WAITING_FOR_THIRD_PARTY', label: 'Waiting for Third Party', color: 'purple' },
    { value: 'RESOLVED', label: 'Resolved', color: 'green' },
    { value: 'CLOSED', label: 'Closed', color: 'gray' },
    { value: 'CANCELLED', label: 'Cancelled', color: 'red' },
    { value: 'MERGED', label: 'Merged', color: 'indigo' },
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
    { value: 'LOW', label: 'Low', color: 'gray' },
    { value: 'MEDIUM', label: 'Medium', color: 'blue' },
    { value: 'HIGH', label: 'High', color: 'orange' },
    { value: 'URGENT', label: 'Urgent', color: 'red' },
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
    { value: 'ACTIVE', label: 'Active', color: 'green' },
    { value: 'INACTIVE', label: 'Inactive', color: 'gray' },
    { value: 'SPAM', label: 'Spam', color: 'red' },
    { value: 'MERGED', label: 'Merged', color: 'indigo' },
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
    { value: 'EMAIL', label: 'Email', color: 'blue' },
    { value: 'TICKET_SYSTEM', label: 'Ticket System', color: 'purple' },
    { value: 'SHOPIFY', label: 'Shopify', color: 'green' },
    { value: 'MANUAL', label: 'Manual', color: 'gray' },
    { value: 'OTHER', label: 'Other', color: 'gray' },
    { value: 'FACEBOOK_PSID', label: 'Facebook PSID', color: 'indigo' },
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
    { value: 'EMAIL', label: 'Email', color: 'blue' },
    { value: 'CHAT', label: 'Chat', color: 'green' },
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
  IGNORED: 'IGNORED',

  values: [
    { value: 'OPEN', label: 'Open', color: 'blue' },
    { value: 'ARCHIVED', label: 'Archived', color: 'gray' },
    { value: 'ACTIVE', label: 'Active', color: 'green' },
    { value: 'RESOLVED', label: 'Resolved', color: 'teal' },
    { value: 'PENDING', label: 'Pending', color: 'amber' },
    { value: 'CLOSED', label: 'Closed', color: 'gray' },
    { value: 'SPAM', label: 'Spam', color: 'red' },
    { value: 'TRASH', label: 'Trash', color: 'red' },
    { value: 'IGNORED', label: 'Ignored', color: 'gray' },
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
    { value: 'EMAIL', label: 'Email', color: 'blue' },
    { value: 'FACEBOOK', label: 'Facebook', color: 'indigo' },
    { value: 'SMS', label: 'SMS', color: 'green' },
    { value: 'WHATSAPP', label: 'WhatsApp', color: 'teal' },
    { value: 'INSTAGRAM', label: 'Instagram', color: 'pink' },
    { value: 'OPENPHONE', label: 'OpenPhone', color: 'purple' },
    { value: 'CHAT', label: 'Chat', color: 'amber' },
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
    { value: 'READ', label: 'Mark as Read', color: 'green' },
    { value: 'UNREAD', label: 'Mark as Unread', color: 'blue' },
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
    { value: 'add', label: 'Add tags', color: 'green' },
    { value: 'remove', label: 'Remove tags', color: 'red' },
    { value: 'set', label: 'Replace all tags', color: 'blue' },
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
    { value: 'ACTIVE', label: 'Active', color: 'green' },
    { value: 'INACTIVE', label: 'Inactive', color: 'gray' },
    { value: 'PROCESSING', label: 'Processing', color: 'amber' },
    { value: 'ERROR', label: 'Error', color: 'red' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Vector Database Type Enum
 * Source: packages/database/src/db/schema/_shared.ts:469
 * Database enum: vectorDbType
 */
/**
 * Stock Movement Type Enum
 * Entity-system field options for stock_movement_type
 */
export const StockMovementType = {
  RECEIVE: 'receive',
  SHIP: 'ship',
  ADJUST: 'adjust',
  SALE: 'sale',
  BUILD_CONSUME: 'build_consume',
  BUILD_PRODUCE: 'build_produce',
  SCRAP: 'scrap',
  RETURN_IN: 'return_in',
  RETURN_OUT: 'return_out',
  INITIAL: 'initial',

  values: [
    { value: 'receive', label: 'Receive', color: 'green' },
    { value: 'ship', label: 'Ship', color: 'blue' },
    { value: 'adjust', label: 'Adjustment', color: 'amber' },
    { value: 'sale', label: 'Sale', color: 'indigo' },
    { value: 'build_consume', label: 'Build (consume)', color: 'orange' },
    { value: 'build_produce', label: 'Build (produce)', color: 'teal' },
    { value: 'scrap', label: 'Scrap', color: 'red' },
    { value: 'return_in', label: 'Return (inbound)', color: 'purple' },
    { value: 'return_out', label: 'Return (outbound)', color: 'pink' },
    { value: 'initial', label: 'Initial Stock', color: 'gray' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Stock Status Enum
 * Entity-system field options for part_stock_status
 */
export const StockStatus = {
  OUT_OF_STOCK: 'out_of_stock',
  LOW_STOCK: 'low_stock',
  IN_STOCK: 'in_stock',

  values: [
    { value: 'out_of_stock', label: 'Out of Stock', color: 'red' },
    { value: 'low_stock', label: 'Low Stock', color: 'yellow' },
    { value: 'in_stock', label: 'In Stock', color: 'green' },
  ] satisfies FieldOptionItem[],
} as const

export const VectorDbTypeEnum = {
  POSTGRESQL: 'POSTGRESQL',
  CHROMA: 'CHROMA',
  QDRANT: 'QDRANT',
  WEAVIATE: 'WEAVIATE',
  PINECONE: 'PINECONE',
  MILVUS: 'MILVUS',

  values: [
    { value: 'POSTGRESQL', label: 'PostgreSQL', color: 'blue' },
    { value: 'CHROMA', label: 'Chroma', color: 'orange' },
    { value: 'QDRANT', label: 'Qdrant', color: 'purple' },
    { value: 'WEAVIATE', label: 'Weaviate', color: 'green' },
    { value: 'PINECONE', label: 'Pinecone', color: 'teal' },
    { value: 'MILVUS', label: 'Milvus', color: 'indigo' },
  ] satisfies FieldOptionItem[],
} as const
