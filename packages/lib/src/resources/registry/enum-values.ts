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

/**
 * Stock Movement Cost Basis
 * How the cost frozen on a movement was arrived at
 * (plans/purchasing/01-build-plan.md §2.1).
 *
 * A build values at `standard`; a **receipt is the first thing in the system
 * that legitimately writes `actual`**, because it records what was really paid.
 * Under D20 the difference between the two is the purchase price variance.
 */
export const StockMovementCostBasis = {
  STANDARD: 'standard',
  ACTUAL: 'actual',

  values: [
    { value: 'standard', label: 'Standard', color: 'blue' },
    { value: 'actual', label: 'Actual', color: 'green' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Purchase Order Status — the ACTION axis, and nothing else
 * plans/purchasing/07-purchase-order-send-and-status.md §3.3.
 *
 * `draft` -> `issued` -> `closed` | `canceled`. `issued` means **sent to the
 * vendor** and nothing more (§6.4) — not "the vendor accepted", which is a
 * `confirmed` state that does not exist yet and must not be smuggled in here.
 *
 * 🛑 **Receiving and billing are NOT on this axis.** `partially_received` and
 * `received` used to sit in this list and had no writer at all; they are now
 * {@link PurchaseOrderReceiptStatus}, alongside {@link PurchaseOrderBillingStatus}.
 * The decisive case is prepayment: a vendor that will not ship until the invoice
 * is paid leaves the order *fully billed, fully paid, nothing received* for
 * weeks, and one enum cannot say that — whichever axis you pick, the other
 * becomes invisible. {@link VendorBillStatus} is what this looks like when the
 * two are left conflated: its payment values destroy its match verdict, and
 * `partially_paid` had to be invented to compensate.
 *
 * `OrderFinancialStatus` / `OrderFulfillmentStatus` are the same split on the
 * sell side; the purchase order simply predates them.
 *
 * ✅ `closed` is deliberately never derived: an order the vendor short-shipped,
 * where the remainder has been agreed away, must still be closeable, and no
 * roll-up rule can decide that.
 */
export const PurchaseOrderStatus = {
  DRAFT: 'draft',
  ISSUED: 'issued',
  CLOSED: 'closed',
  CANCELED: 'canceled',

  values: [
    { value: 'draft', label: 'Draft', color: 'gray' },
    { value: 'issued', label: 'Issued', color: 'blue' },
    { value: 'closed', label: 'Closed', color: 'forest' },
    { value: 'canceled', label: 'Canceled', color: 'red' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Purchase Order Receipt Status — the GOODS axis
 * plans/purchasing/07-purchase-order-send-and-status.md §3.3.
 *
 * Derived from the `purchase_order_line_quantity_received` roll-up that already
 * re-SUMs on every stock movement; the order-level verdict is the same
 * computation one level up, on the same trigger and with no new query. Never
 * set by hand — the enum carries no `not_applicable`-style escape hatch for the
 * same reason `part_quantity_on_hand` carries none.
 *
 * The register mirrors {@link OrderFulfillmentStatus}: grey for nothing yet,
 * amber for the partial state somebody has to chase, green for complete.
 */
export const PurchaseOrderReceiptStatus = {
  NOT_RECEIVED: 'not_received',
  PARTIALLY_RECEIVED: 'partially_received',
  RECEIVED: 'received',

  values: [
    { value: 'not_received', label: 'Not received', color: 'gray' },
    { value: 'partially_received', label: 'Partially received', color: 'amber' },
    { value: 'received', label: 'Received', color: 'green' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Purchase Order Billing Status — the MONEY axis
 * plans/purchasing/07-purchase-order-send-and-status.md §3.3.
 *
 * Derived from the `purchase_order_line_quantity_billed` roll-up, the twin of
 * {@link PurchaseOrderReceiptStatus}'s source and written by the same pass.
 *
 * 🛑 This is BILLED, not PAID (§3.6). Payment lives on the vendor bill, one
 * order can carry several bills, and a PO-level payment field would be a
 * summary of state owned elsewhere — free to drift from the rows it claims to
 * summarise. "Everything here is settled" is what `closed` means, and a human
 * sets it.
 */
export const PurchaseOrderBillingStatus = {
  NOT_BILLED: 'not_billed',
  PARTIALLY_BILLED: 'partially_billed',
  BILLED: 'billed',

  values: [
    { value: 'not_billed', label: 'Not billed', color: 'gray' },
    { value: 'partially_billed', label: 'Partially billed', color: 'amber' },
    { value: 'billed', label: 'Billed', color: 'green' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Landed Cost Allocation Basis
 * How a purchase's shipping, tax and discount are spread across its lines
 * (plans/products/11-costing-and-stock-improvements.md §4.2).
 *
 * Deliberately a **parameter**, not a constant: value-weighting makes a $1 part
 * absorb $9.99 of a $10,000 freight bill while a $1,000 part absorbs $9,990.
 * Defensible bookkeeping, but freight actually tracks mass, and a business
 * shipping motors and decals knows it.
 */
export const LandedCostAllocationBasis = {
  VALUE: 'value',
  QUANTITY: 'quantity',
  WEIGHT: 'weight',

  values: [
    { value: 'value', label: 'By line value', color: 'blue' },
    { value: 'quantity', label: 'By quantity', color: 'purple' },
    { value: 'weight', label: 'By weight', color: 'teal' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Vendor Bill Status
 * plans/purchasing/01-build-plan.md §5.1.
 *
 * `matched` / `exception` are written by the three-way match, never by hand —
 * that split is the control. A control a person has to run by comparing three
 * documents is a control that stops being run.
 */
export const VendorBillStatus = {
  DRAFT: 'draft',
  MATCHED: 'matched',
  EXCEPTION: 'exception',
  POSTED: 'posted',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  VOID: 'void',

  values: [
    { value: 'draft', label: 'Draft', color: 'gray' },
    { value: 'matched', label: 'Matched', color: 'green' },
    { value: 'exception', label: 'Exception', color: 'red' },
    { value: 'posted', label: 'Posted', color: 'blue' },
    // 🛑 `partially_paid` is not cosmetic. Without it a bill with $400 of $1,000
    // settled reads `matched` — indistinguishable from one nobody has paid a cent
    // of, with the remaining balance visible only on the payment card. Same
    // discipline as `paidSource`: never let a partial fact render as a complete
    // one. It sits before `paid` because that is the lifecycle order, and `amber`
    // because it is a state that still needs something to happen.
    { value: 'partially_paid', label: 'Partially Paid', color: 'amber' },
    { value: 'paid', label: 'Paid', color: 'forest' },
    { value: 'void', label: 'Void', color: 'orange' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Vendor Bill Paid Source
 * What evidence marked a bill paid (plans/purchasing/01-build-plan.md §5.3).
 *
 * 🛑 Not decoration. An auto-mark that cannot be told apart from a confirmed
 * payment is how a genuinely unpaid bill goes quiet until the vendor calls.
 * `rule` is a **presumption** and stays in an unconfirmed filter until a
 * provider read or a bank line confirms it.
 */
export const VendorBillPaidSource = {
  MANUAL: 'manual',
  PROVIDER: 'provider',
  BANK_IMPORT: 'bank_import',
  RULE: 'rule',

  values: [
    { value: 'manual', label: 'Entered by hand', color: 'gray' },
    { value: 'provider', label: 'From accounting system', color: 'blue' },
    { value: 'bank_import', label: 'Matched to a bank line', color: 'green' },
    { value: 'rule', label: 'Presumed by rule', color: 'amber' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Vendor Payment Status
 * plans/purchasing/01-build-plan.md §5.4. Ships INERT — nothing writes it yet.
 */
export const VendorPaymentStatus = {
  DRAFT: 'draft',
  POSTED: 'posted',
  VOID: 'void',

  values: [
    { value: 'draft', label: 'Draft', color: 'gray' },
    { value: 'posted', label: 'Posted', color: 'green' },
    { value: 'void', label: 'Void', color: 'orange' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * GL Account Type
 * The five statement classifications (plans/purchasing/01-build-plan.md §7.2).
 */
export const GlAccountType = {
  ASSET: 'asset',
  LIABILITY: 'liability',
  EQUITY: 'equity',
  REVENUE: 'revenue',
  EXPENSE: 'expense',

  values: [
    { value: 'asset', label: 'Asset', color: 'blue' },
    { value: 'liability', label: 'Liability', color: 'amber' },
    { value: 'equity', label: 'Equity', color: 'purple' },
    { value: 'revenue', label: 'Revenue', color: 'green' },
    { value: 'expense', label: 'Expense', color: 'red' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * GL Posting Line Direction
 * plans/purchasing/01-build-plan.md §7.3.
 *
 * `amount` is always POSITIVE; this carries the sign. Storing a signed amount
 * and a direction lets the two disagree, and a ledger that can contradict
 * itself is not a ledger.
 */
export const GlPostingLineDirection = {
  DEBIT: 'debit',
  CREDIT: 'credit',

  values: [
    { value: 'debit', label: 'Debit', color: 'blue' },
    { value: 'credit', label: 'Credit', color: 'purple' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Build Status
 * plans/products/build/01-build-plan.md §1.1.
 *
 * `planned` -> `in_progress` -> `completed` | `canceled`. A `planned` build
 * writes NO stock movements (README B2) — that is the safety property the whole
 * phasing rests on, and it is why `createBuild` can ship before
 * `part_standard_cost` has a single writer. `completed` is terminal: a
 * completed build is never edited or deleted, it is REVERSED by a second build
 * carrying the original's frozen costs (B6).
 */
export const BuildStatus = {
  PLANNED: 'planned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELED: 'canceled',

  values: [
    { value: 'planned', label: 'Planned', color: 'gray' },
    { value: 'in_progress', label: 'In Progress', color: 'blue' },
    { value: 'completed', label: 'Completed', color: 'green' },
    { value: 'canceled', label: 'Canceled', color: 'red' },
  ] satisfies FieldOptionItem[],
} as const

/**
 * Build Source
 * plans/products/build/01-build-plan.md §1.1, plans/products/12 AB7.
 *
 * An auto-raised build must be distinguishable from one a person raised against
 * the same order deliberately — without that, "cancel the builds this order
 * caused" cannot tell the two apart and would revoke a human decision.
 */
export const BuildSource = {
  MANUAL: 'manual',
  ORDER: 'order',

  values: [
    { value: 'manual', label: 'Manual', color: 'gray' },
    { value: 'order', label: 'Order', color: 'blue' },
  ] satisfies FieldOptionItem[],
} as const
