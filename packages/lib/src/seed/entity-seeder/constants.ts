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
    // account is an app-owned identity field on this row (P1/P2) — which is
    // exactly why `gl_account` stays an EntityInstance while `gl_posting` /
    // `gl_posting_line` became tables (G6): `RecordIdentity` is keyed on an
    // instance and has no other addressing mode.
    entityType: 'gl_account',
    apiSlug: 'gl-accounts',
    singular: 'GL Account',
    plural: 'GL Accounts',
    icon: 'book-open',
    color: 'indigo',
    isVisible: false,
  },
  {
    // Ships INERT with entity migration 109 (plans/products/build/README.md
    // B10): the def and all 24 of its fields exist in every org, and NOTHING
    // writes them until `packages/lib/src/builds/` lands in phase 2. An entity
    // with zero rows can be reshaped for free; the first row ends that.
    //
    // ✅ Flipped to `isVisible: true` with phase 2 — the list, the detail page
    // and the completion form landed, so the nav entry now leads somewhere.
    //
    // 🛑 This line reaches FRESH orgs only. `ensureEntityDefinitions` is a plain
    // insert that skips an org already holding the def, so `isVisible` is read
    // once at creation and never again; every org that ran 109 keeps the `false`
    // it was seeded with. Entity migration **110-build-visible** is the other
    // half, and the two must agree or the def means one thing on an old org and
    // another on a new one.
    entityType: 'build',
    apiSlug: 'builds',
    singular: 'Build',
    plural: 'Builds',
    icon: 'hammer',
    color: 'orange',
    isVisible: true,
  },
  {
    // The classification registry, one record per (code, country)
    // (plans/money/tasks/29-tariff-schedule.md §1.1). Seeded by entity
    // migration 119 and INERT: nothing resolves through it until somebody
    // classifies an offer, and a set `vendor_part_tariff_rate` still wins.
    //
    // ✅ `isVisible` on purpose (§12 d), unlike `gl_account` beside it. A
    // records-Full actor creating a tariff code decides nothing about where
    // money lands; it is reference data. Visible also gets the importer, which
    // matters because loading a schedule is a bulk job.
    entityType: 'tariff_code',
    apiSlug: 'tariff-codes',
    singular: 'Tariff Code',
    plural: 'Tariff Codes',
    icon: 'globe',
    color: 'teal',
    isVisible: true,
  },
  {
    // The dated schedule behind a code. An ENTITY and not JSON on the code row
    // (§12 f / §12.1): rows are importable, queryable across codes, and audited
    // individually.
    entityType: 'tariff_rate',
    apiSlug: 'tariff-rates',
    singular: 'Tariff Rate',
    plural: 'Tariff Rates',
    icon: 'percent',
    color: 'teal',
    isVisible: true,
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
  // 🛑 The primary is the PART, not `vendorSku`. `vendorSku` is optional — under
  // the `(part, supplier)` natural key the supplier's own part number is
  // metadata, not identity, and real price lists routinely omit the column — and
  // `computeDisplayValue` has no fallback: an absent value writes
  // `displayName: null` and the record renders nameless everywhere a relation
  // chip resolves it. `vendor_part_part` is `required: true` / `nullable: false`,
  // so it is the only leg guaranteed to be there.
  //
  // Reaches EXISTING orgs only through migration 115 — `linkDisplayFields` runs
  // at seed time, so editing this constant alone repoints fresh orgs and leaves
  // every current one pointing at the SKU.
  vendor_part: {
    primaryDisplayField: 'part',
    secondaryDisplayField: 'vendorSku',
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
  // 🛑 The primary is the DERIVED `label` - `8481.80.9005 CN` - stamped by a
  // hook from the two legs on every write (task 30 §8), so the display name and
  // the importers' relation match read the same string that names the whole
  // `(code, country)` identity. It was `code` until migration 120, which
  // repoints existing orgs; this constant reaches fresh orgs only.
  tariff_code: {
    primaryDisplayField: 'label',
    secondaryDisplayField: 'description',
  },
  // The `authority` is the natural thing to read first, but it is NULLABLE and
  // `computeDisplayValue` has no fallback - an absent value writes
  // `displayName: null` and the row renders nameless. `tariffCode` is the only
  // required leg.
  tariff_rate: {
    primaryDisplayField: 'tariffCode',
    secondaryDisplayField: 'effectiveFrom',
  },
  gl_account: {
    primaryDisplayField: 'code',
    secondaryDisplayField: 'name',
  },
  build: {
    primaryDisplayField: 'number',
    secondaryDisplayField: 'part',
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
