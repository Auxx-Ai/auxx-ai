// packages/lib/src/seed/entity-seeder/constants.ts

import type { DisplayFieldConfig, SystemEntityConfig } from './types'

/**
 * System entity definitions to seed
 */
export const SYSTEM_ENTITIES: SystemEntityConfig[] = [
  {
    entityType: 'contact',
    apiSlug: 'contacts',
    singular: 'Contact',
    plural: 'Contacts',
    icon: 'user',
    color: 'indigo',
  },
  {
    entityType: 'ticket',
    apiSlug: 'tickets',
    singular: 'Ticket',
    plural: 'Tickets',
    icon: 'ticket',
    color: 'blue',
  },
  {
    entityType: 'part',
    apiSlug: 'parts',
    singular: 'Part',
    plural: 'Parts',
    icon: 'package',
    color: 'orange',
  },
  {
    entityType: 'entity_group',
    apiSlug: 'entity-groups',
    singular: 'Group',
    plural: 'Groups',
    icon: 'users',
    color: 'purple',
    isVisible: false,
  },
  {
    entityType: 'inbox',
    apiSlug: 'inboxes',
    singular: 'Inbox',
    plural: 'Inboxes',
    icon: 'inbox',
    color: 'indigo',
    isVisible: false,
  },
  {
    // Plan 40: personal-ness is def membership, not an `inbox_is_personal` field.
    // Never user-creatable — instances arrive only through the personal connect
    // provisioning flow, and an admin claim moves them onto `inbox`.
    entityType: 'personal_inbox',
    apiSlug: 'personal-inboxes',
    singular: 'Personal Inbox',
    plural: 'Personal Inboxes',
    icon: 'inbox',
    color: 'indigo',
    isVisible: false,
  },
  {
    entityType: 'tag',
    apiSlug: 'tags',
    singular: 'Tag',
    plural: 'Tags',
    icon: 'tag',
    color: 'amber',
    isVisible: false,
  },
  {
    entityType: 'thread',
    apiSlug: 'threads',
    singular: 'Thread',
    plural: 'Threads',
    icon: 'mail',
    color: 'blue',
    isVisible: false,
  },
  {
    entityType: 'signature',
    apiSlug: 'signatures',
    singular: 'Signature',
    plural: 'Signatures',
    icon: 'pen-tool',
    color: 'slate',
    isVisible: false, // Settings-only entity
  },
  {
    entityType: 'vendor_part',
    apiSlug: 'vendor-parts',
    // Named for what it holds, not for the join it is: this def is hidden, and
    // its NAME was the last place the join entity leaked (migration 106).
    // `entityType` and `apiSlug` are keys — they never move.
    singular: 'Supplier Price',
    plural: 'Supplier Pricing',
    icon: 'package',
    color: 'orange',
    isVisible: false, // Internal entity, managed from part drawer
  },
  {
    entityType: 'subpart',
    apiSlug: 'subparts',
    singular: 'Component',
    plural: 'Components',
    icon: 'layers',
    color: 'orange',
    isVisible: false, // Internal entity, managed from part drawer's subparts tab
  },
  {
    entityType: 'stock_movement',
    apiSlug: 'stock-movements',
    singular: 'Stock Movement',
    plural: 'Stock Movements',
    icon: 'arrow-left-right',
    color: 'emerald',
    isVisible: false, // Internal entity, managed from part drawer
  },
  {
    entityType: 'company',
    apiSlug: 'companies',
    singular: 'Company',
    plural: 'Companies',
    icon: 'building-2',
    color: 'blue',
  },
  {
    entityType: 'meeting',
    apiSlug: 'meetings',
    singular: 'Meeting',
    plural: 'Meetings',
    icon: 'calendar',
    color: 'blue',
    isVisible: false, // Accessed via dedicated Meetings page, not entity sidebar
  },
  {
    entityType: 'article',
    apiSlug: 'articles',
    singular: 'Article',
    plural: 'Articles',
    icon: 'book-open',
    color: 'cyan',
    isVisible: false, // Backed by Article table; managed via the KB editor, not entity sidebar
  },
  {
    entityType: 'work_order',
    apiSlug: 'work-orders',
    singular: 'Work Order',
    plural: 'Work Orders',
    icon: 'wrench',
    color: 'amber',
    isVisible: true,
  },
  {
    entityType: 'service_request',
    apiSlug: 'service-requests',
    singular: 'Service Request',
    plural: 'Service Requests',
    icon: 'clipboard-list',
    color: 'cyan',
    isVisible: true,
  },
  {
    entityType: 'catalog_item',
    apiSlug: 'catalog-items',
    singular: 'Catalog Item',
    plural: 'Catalog Items',
    icon: 'tags',
    color: 'teal',
    isVisible: false, // Internal entity, managed from dispatch settings (vendor_part recipe)
  },
  {
    entityType: 'catalog_group',
    apiSlug: 'catalog-groups',
    singular: 'Catalog Group',
    plural: 'Catalog Groups',
    icon: 'boxes',
    color: 'teal',
    isVisible: false, // Internal entity, managed from dispatch settings (catalog_item recipe)
  },
  {
    entityType: 'quote',
    apiSlug: 'quotes',
    singular: 'Quote',
    plural: 'Quotes',
    icon: 'file-text',
    color: 'violet',
    isVisible: true,
  },
  {
    entityType: 'invoice',
    apiSlug: 'invoices',
    singular: 'Invoice',
    plural: 'Invoices',
    icon: 'receipt',
    color: 'green',
    isVisible: true,
  },
  {
    entityType: 'line_item',
    apiSlug: 'line-items',
    singular: 'Line Item',
    plural: 'Line Items',
    icon: 'list',
    color: 'gray',
    isVisible: false, // Internal entity, rendered only by the line-builder UIs
  },
  {
    entityType: 'payment',
    apiSlug: 'payments',
    singular: 'Payment',
    plural: 'Payments',
    icon: 'banknote',
    color: 'emerald',
    isVisible: false, // Ledger mirror records, rendered only by the invoice drawer
  },
  {
    entityType: 'product',
    apiSlug: 'products',
    singular: 'Product',
    plural: 'Products',
    icon: 'package-2', // `package` is taken by `part`
    color: 'teal',
    isVisible: true,
  },
  {
    entityType: 'gl_posting',
    apiSlug: 'gl-postings',
    singular: 'GL Posting',
    plural: 'GL Postings',
    icon: 'book-open',
    color: 'gray',
    // Written only by the QuickBooks poster, mirroring `payment`. Seeded for
    // every org but meaningful only to one that posts to a general ledger, so
    // it stays out of the sidebar; Gap G's close console is the read surface.
    isVisible: false,
  },
  {
    entityType: 'order',
    apiSlug: 'orders',
    singular: 'Order',
    plural: 'Orders',
    icon: 'shopping-bag',
    color: 'amber',
    isVisible: true,
  },
  {
    entityType: 'purchase_order',
    apiSlug: 'purchase-orders',
    singular: 'Purchase Order',
    plural: 'Purchase Orders',
    icon: 'shopping-cart',
    color: 'teal',
    isVisible: true,
  },
  {
    entityType: 'purchase_order_line',
    apiSlug: 'purchase-order-lines',
    singular: 'Purchase Order Line',
    plural: 'Purchase Order Lines',
    icon: 'clipboard-list',
    color: 'teal',
    isVisible: false, // Internal entity, managed from the purchase order
  },
  {
    entityType: 'vendor_bill',
    apiSlug: 'vendor-bills',
    singular: 'Vendor Bill',
    plural: 'Vendor Bills',
    icon: 'receipt',
    color: 'red',
    isVisible: true,
  },
  {
    entityType: 'vendor_bill_line',
    apiSlug: 'vendor-bill-lines',
    singular: 'Vendor Bill Line',
    plural: 'Vendor Bill Lines',
    icon: 'file-text',
    color: 'red',
    isVisible: false, // Internal entity, managed from the bill
  },
  {
    // Ships INERT (plans/purchasing/README.md P13): the def and its fields exist
    // in every org, and NOTHING writes them until the write path is built. A def
    // with zero rows can be reshaped for free; the first row ends that.
    entityType: 'vendor_payment',
    apiSlug: 'vendor-payments',
    singular: 'Vendor Payment',
    plural: 'Vendor Payments',
    icon: 'banknote',
    color: 'emerald',
    isVisible: false,
  },
  {
    // Inert, as above. The header/allocation split is what lets ONE bank line
    // clear several bills (P15) - the shape a flat belongs_to cannot hold.
    entityType: 'vendor_payment_allocation',
    apiSlug: 'vendor-payment-allocations',
    singular: 'Payment Allocation',
    plural: 'Payment Allocations',
    icon: 'calculator',
    color: 'emerald',
    isVisible: false,
  },
  {
    // The chart of accounts, ours. The accounting provider's own id for each
    // account is an app-owned identity field on this row, exactly as
    // `qboJournalEntryId` already hangs off `gl_posting` (P1/P2).
    entityType: 'gl_account',
    apiSlug: 'gl-accounts',
    singular: 'GL Account',
    plural: 'GL Accounts',
    icon: 'book-open',
    color: 'indigo',
    isVisible: false,
  },
  {
    entityType: 'gl_posting_line',
    apiSlug: 'gl-posting-lines',
    singular: 'GL Posting Line',
    plural: 'GL Posting Lines',
    icon: 'file-text',
    color: 'indigo',
    isVisible: false, // Written only by the poster, like gl_posting itself
  },
]

/**
 * Display field configuration for each entity type
 * Uses field.id (not systemAttribute) to match fieldMap keys
 */
export const DISPLAY_FIELD_CONFIG: Record<string, DisplayFieldConfig> = {
  contact: {
    primaryDisplayField: 'fullName',
    secondaryDisplayField: 'primaryEmail',
    avatarField: 'avatarUrl',
  },
  ticket: {
    primaryDisplayField: 'title',
    secondaryDisplayField: 'number',
  },
  part: {
    primaryDisplayField: 'title',
    secondaryDisplayField: 'sku',
    avatarField: 'image',
  },
  inbox: {
    primaryDisplayField: 'name',
    secondaryDisplayField: undefined,
    avatarField: 'color',
  },
  personal_inbox: {
    primaryDisplayField: 'name',
    secondaryDisplayField: undefined,
    avatarField: 'color',
  },
  tag: {
    primaryDisplayField: 'title',
    secondaryDisplayField: undefined,
  },
  thread: {
    primaryDisplayField: 'subject',
    secondaryDisplayField: undefined,
  },
  signature: {
    primaryDisplayField: 'name',
    secondaryDisplayField: undefined,
  },
  vendor_part: {
    primaryDisplayField: 'vendorSku',
    secondaryDisplayField: undefined,
  },
  subpart: {
    primaryDisplayField: 'childPart',
    secondaryDisplayField: 'quantity',
  },
  stock_movement: {
    primaryDisplayField: 'type',
    secondaryDisplayField: 'quantity',
  },
  company: {
    primaryDisplayField: 'companyName',
    secondaryDisplayField: 'website',
    avatarField: 'logo',
  },
  meeting: {
    primaryDisplayField: 'title',
    secondaryDisplayField: 'dateTime',
  },
  article: {
    primaryDisplayField: 'title',
    secondaryDisplayField: undefined,
  },
  work_order: {
    primaryDisplayField: 'title',
    secondaryDisplayField: 'number',
  },
  service_request: {
    primaryDisplayField: 'title',
    secondaryDisplayField: 'number',
  },
  quote: {
    primaryDisplayField: 'title',
    secondaryDisplayField: 'number',
  },
  line_item: {
    primaryDisplayField: 'name',
    secondaryDisplayField: undefined,
  },
  catalog_item: {
    primaryDisplayField: 'name',
    secondaryDisplayField: undefined,
  },
  catalog_group: {
    primaryDisplayField: 'name',
    secondaryDisplayField: undefined,
  },
  invoice: {
    primaryDisplayField: 'number',
    secondaryDisplayField: undefined,
  },
  payment: {
    primaryDisplayField: 'amount',
    secondaryDisplayField: undefined,
  },
  product: {
    primaryDisplayField: 'title',
    secondaryDisplayField: 'vendor',
    avatarField: 'image',
  },
  gl_posting: {
    primaryDisplayField: 'docNumber',
    secondaryDisplayField: 'periodKey',
  },
  order: {
    primaryDisplayField: 'number',
    secondaryDisplayField: undefined,
  },
  purchase_order: {
    primaryDisplayField: 'number',
    secondaryDisplayField: 'vendor',
  },
  purchase_order_line: {
    primaryDisplayField: 'description',
    secondaryDisplayField: undefined,
  },
  vendor_bill: {
    primaryDisplayField: 'number',
    secondaryDisplayField: 'vendor',
  },
  vendor_bill_line: {
    primaryDisplayField: 'description',
    secondaryDisplayField: undefined,
  },
  vendor_payment: {
    primaryDisplayField: 'reference',
    secondaryDisplayField: 'vendor',
  },
  vendor_payment_allocation: {
    primaryDisplayField: 'amount',
    secondaryDisplayField: undefined,
  },
  gl_account: {
    primaryDisplayField: 'code',
    secondaryDisplayField: 'name',
  },
  gl_posting_line: {
    primaryDisplayField: 'accountCode',
    secondaryDisplayField: undefined,
  },
}

/**
 * Fields that are EntityInstance columns, not CustomFields
 * These should NOT be seeded as CustomFields
 */
export const ENTITY_INSTANCE_COLUMNS = [
  'id',
  'created_at',
  'updated_at',
  'first_interaction_at',
  'last_interaction_at',
] as const

/**
 * Special entity types that don't have EntityDefinitions
 * For these, the inverse field doesn't exist in fieldMap
 */
export const SPECIAL_ENTITY_TYPES = ['user'] as const
