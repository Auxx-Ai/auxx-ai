// packages/database/src/db/schema/entity-instance.ts
// Drizzle table for EntityInstance

import { pgTable, index, text, timestamp, type AnyPgColumn, sql } from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { Organization } from './organization'
import { EntityDefinition } from './entity-definition'
import { User } from './user'

/**
 * EntityInstance table for storing actual records of custom entities
 * Example: An instance of a "Product" entity definition
 *
 * The actual field values are stored in CustomFieldValue table,
 * linked via customFieldValue.entityId = entityInstance.id
 */
export const EntityInstance = pgTable(
  'EntityInstance',
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp({ precision: 3, mode: 'string' })
      .notNull()
      .$onUpdate(() => new Date().toISOString()),
    archivedAt: timestamp({ precision: 3, mode: 'string' }),

    /** Reference to the entity definition this is an instance of */
    entityDefinitionId: text()
      .notNull()
      .references((): AnyPgColumn => EntityDefinition.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** Organization this instance belongs to */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** User who created this instance (for audit) */
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
  },
  (table) => [
    // Index for entity definition lookups
    index('EntityInstance_entityDefinitionId_idx').using(
      'btree',
      table.entityDefinitionId.asc().nullsLast()
    ),
    // Index for organization lookups
    index('EntityInstance_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    // Index for archived instances
    index('EntityInstance_archivedAt_idx').using('btree', table.archivedAt.asc().nullsLast()),
    // Composite index for common queries
    index('EntityInstance_orgId_defId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from EntityInstance table */
export type EntityInstanceEntity = typeof EntityInstance.$inferSelect

/** Type for inserting into EntityInstance table */
export type EntityInstanceInsert = typeof EntityInstance.$inferInsert
