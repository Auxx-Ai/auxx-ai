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
 * Tag Scope Enum
 * Virtual enum for resource-type scoping of tags (filters the picker pool).
 * Stored as a SINGLE_SELECT on the tag entity.
 */
export const TagScope = {
  THREAD: 'thread',
  ARTICLE: 'article',

  values: [
    { value: 'thread', label: 'Thread', color: 'blue' },
    { value: 'article', label: 'Article', color: 'purple' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Article Status Enum
 * Source: packages/database/src/db/schema/_shared.ts (articleStatus)
 * Database enum: articleStatus
 */
export const ArticleStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',

  values: [
    { value: 'DRAFT', label: 'Draft', color: 'gray' },
    { value: 'PUBLISHED', label: 'Published', color: 'green' },
    { value: 'ARCHIVED', label: 'Archived', color: 'amber' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Article Kind Enum
 * Source: packages/database/src/db/schema/_shared.ts (articleKind)
 * Database enum: articleKind
 */
export const ArticleKind = {
  page: 'page',
  category: 'category',
  header: 'header',
  tab: 'tab',
  link: 'link',

  values: [
    { value: 'page', label: 'Page', color: 'blue' },
    { value: 'category', label: 'Category', color: 'purple' },
    { value: 'header', label: 'Section Header', color: 'gray' },
    { value: 'tab', label: 'Tab', color: 'teal' },
    { value: 'link', label: 'Link', color: 'amber' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * KB Publish Status Enum
 * Source: packages/database/src/db/schema/_shared.ts (kbPublishStatus)
 * Database enum: kbPublishStatus
 */
export const KbPublishStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  UNLISTED: 'UNLISTED',

  values: [
    { value: 'DRAFT', label: 'Draft', color: 'gray' },
    { value: 'PUBLISHED', label: 'Published', color: 'green' },
    { value: 'UNLISTED', label: 'Unlisted', color: 'amber' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * KB Visibility Enum
 * Source: packages/database/src/db/schema/_shared.ts (kbVisibility)
 * Database enum: kbVisibility
 */
export const KbVisibility = {
  PUBLIC: 'PUBLIC',
  INTERNAL: 'INTERNAL',

  values: [
    { value: 'PUBLIC', label: 'Public', color: 'green' },
    { value: 'INTERNAL', label: 'Internal', color: 'blue' },
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
    { value: 'low_stock', label: 'Low Stock', color: 'amber' },
    { value: 'in_stock', label: 'In Stock', color: 'green' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Cost Source Enum
 * Entity-system field options for `part_cost_source` — which of the two stored
 * numbers `part_cost` actually took.
 *
 * `none` is the point of the field: before it existed, "this part has no cost"
 * was unrepresentable, so a part that lost its last supplier kept a frozen value
 * that looked identical to a fresh one.
 */
export const CostSource = {
  VENDOR: 'vendor',
  BOM: 'bom',
  NONE: 'none',

  values: [
    { value: 'vendor', label: 'Supplier', color: 'blue' },
    { value: 'bom', label: 'Bill of Materials', color: 'teal' },
    { value: 'none', label: 'Not costed', color: 'amber' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Part Kind Enum
 * Entity-system field options for `part_kind` — how a part is classified for
 * build/sell purposes. Human-set, not computed: NULL reads as `component`.
 */
export const PartKind = {
  COMPONENT: 'component',
  SUBASSEMBLY: 'subassembly',
  FINISHED_GOOD: 'finished_good',

  values: [
    { value: 'component', label: 'Component', color: 'gray' },
    { value: 'subassembly', label: 'Subassembly', color: 'blue' },
    { value: 'finished_good', label: 'Finished Good', color: 'green' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Product Status Enum
 * Entity-system field options for `product_status` — the lifecycle of a
 * product family (plans/products/01-product-family.md §1).
 */
export const ProductStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',

  values: [
    { value: 'draft', label: 'Draft', color: 'gray' },
    { value: 'active', label: 'Active', color: 'green' },
    { value: 'archived', label: 'Archived', color: 'amber' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * GL Posting Type Enum
 * The accrual entry types auxx.ai summarises into QuickBooks
 * (plans/auxx-lift/gap-b-quickbooks-journal-entry.md §6.2).
 *
 * `month_end_inventory` sits with the other `month_end_*` values rather than
 * being a fifth entry type on purpose — the integration surface stays at four
 * journal-entry types. `receipt` is deliberately ABSENT: per-receipt GRNI
 * postings need Accounts Payable, and no vendor bill has ever been entered in
 * this QuickBooks file, so nothing would debit it. It returns with Gap D §9.4.
 */
export const GlPostingType = {
  FULFILLMENT: 'fulfillment',
  PAYOUT: 'payout',
  BUILD: 'build',
  MONTH_END_DEFERRAL: 'month_end_deferral',
  MONTH_END_REVERSAL: 'month_end_reversal',
  MONTH_END_INVENTORY: 'month_end_inventory',

  values: [
    { value: 'fulfillment', label: 'Fulfillment', color: 'green' },
    { value: 'payout', label: 'Payout', color: 'blue' },
    { value: 'build', label: 'Build', color: 'purple' },
    { value: 'month_end_deferral', label: 'Month-end deferral', color: 'amber' },
    { value: 'month_end_reversal', label: 'Month-end reversal', color: 'orange' },
    { value: 'month_end_inventory', label: 'Month-end inventory', color: 'teal' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * GL Posting Status Enum
 * Lifecycle of one summary journal entry. A `pending` row that outlives its run
 * is the signal to reconcile against QuickBooks before retrying — it may mean
 * the entry posted and the write-back crashed.
 */
export const GlPostingStatus = {
  PENDING: 'pending',
  POSTED: 'posted',
  FAILED: 'failed',

  values: [
    { value: 'pending', label: 'Pending', color: 'gray' },
    { value: 'posted', label: 'Posted', color: 'green' },
    { value: 'failed', label: 'Failed', color: 'red' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Order Financial Status Enum
 * Where an order sits on the money side (plans/products/08-order-build.md §2).
 * Deliberately mirrors the Shopify vocabulary so a future retargeting of the
 * order stream maps one-to-one rather than through a translation table.
 */
export const OrderFinancialStatus = {
  PENDING: 'pending',
  AUTHORIZED: 'authorized',
  PAID: 'paid',
  PARTIALLY_REFUNDED: 'partially_refunded',
  REFUNDED: 'refunded',
  VOIDED: 'voided',

  values: [
    { value: 'pending', label: 'Pending', color: 'gray' },
    { value: 'authorized', label: 'Authorized', color: 'blue' },
    { value: 'paid', label: 'Paid', color: 'green' },
    { value: 'partially_refunded', label: 'Partially refunded', color: 'amber' },
    { value: 'refunded', label: 'Refunded', color: 'orange' },
    { value: 'voided', label: 'Voided', color: 'red' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Order Fulfillment Status Enum
 * Where an order sits on the shipping side (plans/products/08-order-build.md §2).
 */
export const OrderFulfillmentStatus = {
  UNFULFILLED: 'unfulfilled',
  PARTIAL: 'partial',
  FULFILLED: 'fulfilled',
  RESTOCKED: 'restocked',

  values: [
    { value: 'unfulfilled', label: 'Unfulfilled', color: 'gray' },
    { value: 'partial', label: 'Partially fulfilled', color: 'amber' },
    { value: 'fulfilled', label: 'Fulfilled', color: 'green' },
    { value: 'restocked', label: 'Restocked', color: 'purple' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Order Channel Enum
 * Which route the sale came in through (plans/products/08-order-build.md §4, D18).
 *
 * **Human-set, never derived.** An earlier design derived it at ingest from
 * `financialStatus` + `paymentGateways` + tags; that cannot handle the only
 * rows that need it — a manual sale has no payment gateways and no Shopify
 * tags, and `manual` exists in this list precisely for it.
 */
export const OrderChannel = {
  DTC: 'dtc',
  DEALER: 'dealer',
  MANUAL: 'manual',

  values: [
    { value: 'dtc', label: 'Direct to consumer', color: 'blue' },
    { value: 'dealer', label: 'Dealer', color: 'purple' },
    { value: 'manual', label: 'Manual', color: 'gray' },
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
