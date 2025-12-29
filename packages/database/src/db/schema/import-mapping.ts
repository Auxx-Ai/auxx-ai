// packages/database/src/db/schema/import-mapping.ts

import { pgTable, index, text, timestamp, type AnyPgColumn } from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { Organization } from './organization'
import { User } from './user'
import { EntityDefinition } from './entity-definition'

/**
 * ImportMapping - Reusable import mapping template
 * Defines how CSV columns map to target table fields
 */
export const ImportMapping = pgTable(
  'ImportMapping',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),

    // Organization scope
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Target table (e.g., 'contact', 'ticket', 'entity_products')
    targetTable: text().notNull(),

    // For custom entities, reference the EntityDefinition
    entityDefinitionId: text().references((): AnyPgColumn => EntityDefinition.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    // User-friendly name for this mapping template
    title: text().notNull(),

    // Source file type (currently only 'csv')
    sourceType: text().notNull().default('csv'),

    // Default strategy for duplicate handling
    defaultStrategy: text().notNull().default('create'), // 'create' | 'update' | 'skip'

    // Field used for duplicate detection (e.g., 'email', 'externalId')
    identifierFieldKey: text(),

    // Creator
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('ImportMapping_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('ImportMapping_targetTable_idx').using('btree', table.targetTable.asc().nullsLast()),
  ]
)

/** Type for selecting from ImportMapping table */
export type ImportMappingEntity = typeof ImportMapping.$inferSelect

/** Type for inserting into ImportMapping table */
export type ImportMappingInsert = typeof ImportMapping.$inferInsert
