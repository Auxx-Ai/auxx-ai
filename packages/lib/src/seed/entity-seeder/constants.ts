// packages/lib/src/seed/entity-seeder/constants.ts

import type { SystemEntityConfig, DisplayFieldConfig } from './types'

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
]

/**
 * Display field configuration for each entity type
 * Uses field.id (not systemAttribute) to match fieldMap keys
 */
export const DISPLAY_FIELD_CONFIG: Record<string, DisplayFieldConfig> = {
  contact: {
    primaryDisplayField: 'fullName',
    secondaryDisplayField: 'primaryEmail',
  },
  ticket: {
    primaryDisplayField: 'title',
    secondaryDisplayField: 'number',
  },
  part: {
    primaryDisplayField: 'title',
    secondaryDisplayField: 'sku',
  },
  inbox: {
    primaryDisplayField: 'name',
    secondaryDisplayField: undefined,
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
