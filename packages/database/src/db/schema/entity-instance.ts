// packages/database/src/db/schema/entity-instance.ts
// Drizzle table for EntityInstance

import { pgTable, index, text, timestamp, jsonb, type AnyPgColumn } from './_shared'
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
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp({ precision: 3, withTimezone: true }),

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

    /** Denormalized primary display field value for fast sorting/display */
    displayName: text(),

    /** Denormalized secondary display field value (subtitle/description) */
    secondaryDisplayValue: text(),

    /** Denormalized avatar URL from avatarFieldId */
    avatarUrl: text(),

    /** Combined searchable text from key fields (for full-text search) */
    searchText: text(),

    /**
     * Generic metadata JSONB for system-managed fields.
     * Structure varies by entityType - typing enforced at service layer.
     * @see packages/lib/src/entity-instances/metadata-types.ts
     */
    metadata: jsonb(),
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
    // Index for display name sorting
    index('EntityInstance_displayName_idx').using('btree', table.displayName.asc().nullsLast()),
    // Note: GIN index for searchText full-text search should be added via raw SQL:
    // CREATE INDEX "EntityInstance_search_idx" ON "EntityInstance" USING gin (to_tsvector('english', COALESCE("searchText", '')));
    // Note: Partial indexes on metadata fields should be added via raw SQL:
    // CREATE UNIQUE INDEX "EntityInstance_mailgunMessageId_key" ON "EntityInstance" (("metadata"->>'mailgunMessageId')) WHERE "metadata"->>'mailgunMessageId' IS NOT NULL;
    // CREATE INDEX "EntityInstance_internalReference_idx" ON "EntityInstance" (("metadata"->>'internalReference')) WHERE "metadata"->>'internalReference' IS NOT NULL;
  ]
)

/** Type for selecting from EntityInstance table */
export type EntityInstanceEntity = typeof EntityInstance.$inferSelect

/** Type for inserting into EntityInstance table */
export type EntityInstanceInsert = typeof EntityInstance.$inferInsert
