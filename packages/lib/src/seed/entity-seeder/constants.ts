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
    singular: 'Vendor Part',
    plural: 'Vendor Parts',
    icon: 'package',
    color: 'orange',
    isVisible: false, // Internal entity, managed from part drawer
  },
  {
    entityType: 'subpart',
    apiSlug: 'subparts',
    singular: 'Subpart',
    plural: 'Subparts',
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
    singular: 'Product / Service',
    plural: 'Products & Services',
    icon: 'tags',
    color: 'teal',
    isVisible: false, // Internal entity, managed from dispatch settings (vendor_part recipe)
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
    entityType: 'line_item',
    apiSlug: 'line-items',
    singular: 'Line Item',
    plural: 'Line Items',
    icon: 'list',
    color: 'gray',
    isVisible: false, // Internal entity, rendered only by the line-builder UIs
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
}

/**
 * Fields that are EntityInstance columns, not CustomFields
 * These should NOT be seeded as CustomFields
 */
export const ENTITY_INSTANCE_COLUMNS = ['id', 'created_at', 'updated_at'] as const

/**
 * Special entity types that don't have EntityDefinitions
 * For these, the inverse field doesn't exist in fieldMap
 */
export const SPECIAL_ENTITY_TYPES = ['user'] as const
