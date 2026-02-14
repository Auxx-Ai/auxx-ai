// packages/database/src/db/schema/entity-definition.ts
// Drizzle table for EntityDefinition

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { CustomField } from './custom-field'
import { Organization } from './organization'

/**
 * EntityDefinition table for storing custom entity type definitions
 * Allows organizations to create custom entities (e.g., Company, Deal)
 * and link them to existing system tables (Contact, User, Thread, Ticket)
 */
export const EntityDefinition = pgTable(
  'EntityDefinition',
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
    apiSlug: text().notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    color: text().notNull().default('blue'),
    icon: text().notNull().default('Box'),
    singular: text().notNull(),
    plural: text().notNull(),
    /** Entity type: 'standard', 'contact', 'user', 'thread', 'ticket', or null */
    entityType: text(),
    /** Standard type: 'company', 'task', 'deal', 'custom', or null */
    standardType: text(),
    archivedAt: timestamp({ precision: 3 }),

    /** Custom field ID to use as primary display name (e.g., product name) */
    primaryDisplayFieldId: text().references((): AnyPgColumn => CustomField.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Custom field ID to use as secondary info/subtitle (e.g., SKU, price) */
    secondaryDisplayFieldId: text().references((): AnyPgColumn => CustomField.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Custom field ID to use as avatar/image URL */
    avatarFieldId: text().references((): AnyPgColumn => CustomField.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Whether this entity should appear in the sidebar (default: true) */
    isVisible: boolean().notNull().default(true),
  },
  (table) => [
    // Unique constraint: apiSlug must be unique per organization
    uniqueIndex('EntityDefinition_apiSlug_organizationId_key').using(
      'btree',
      table.apiSlug.asc().nullsLast(),
      table.organizationId.asc().nullsLast()
    ),
    // Index for organization lookups
    index('EntityDefinition_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    // Index for entityType filtering
    index('EntityDefinition_entityType_idx').using('btree', table.entityType.asc().nullsLast()),
    // Index for archived entities
    index('EntityDefinition_archivedAt_idx').using('btree', table.archivedAt.asc().nullsLast()),
  ]
)

/** Type for selecting from EntityDefinition table */
export type EntityDefinitionEntity = typeof EntityDefinition.$inferSelect

/** Type for inserting into EntityDefinition table */
export type EntityDefinitionInsert = typeof EntityDefinition.$inferInsert
