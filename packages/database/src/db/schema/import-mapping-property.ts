// packages/database/src/db/schema/import-mapping-property.ts

import {
  pgTable,
  index,
  text,
  integer,
  timestamp,
  type AnyPgColumn,
  importMappingTargetType,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { ImportMapping } from './import-mapping'
import { CustomField } from './custom-field'

/**
 * ImportMappingProperty - Column mapping within a template
 * Defines how a single CSV column maps to a target field
 */
export const ImportMappingProperty = pgTable(
  'ImportMappingProperty',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),

    // Parent mapping
    importMappingId: text()
      .notNull()
      .references((): AnyPgColumn => ImportMapping.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Source column index (0-based)
    sourceColumnIndex: integer().notNull(),

    // Source column name (from CSV header)
    sourceColumnName: text(),

    // Target type: 'particle' (field), 'relation', or 'skip'
    targetType: importMappingTargetType().notNull().default('skip'),

    // For system fields: the field key (e.g., 'email', 'firstName')
    targetFieldKey: text(),

    // For custom fields: the CustomField ID
    customFieldId: text().references((): AnyPgColumn => CustomField.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    // Resolution type (e.g., 'text:value', 'date:iso', 'select:value')
    resolutionType: text().notNull().default('text:value'),

    // Resolution config (JSON)
    // { dateFormat?, numberDecimalSeparator?, arraySeparator?, relationConfig? }
    resolutionConfig: text(), // JSON string
  },
  (table) => [
    index('ImportMappingProperty_importMappingId_idx').using(
      'btree',
      table.importMappingId.asc().nullsLast()
    ),
    index('ImportMappingProperty_sourceColumnIndex_idx').using(
      'btree',
      table.importMappingId.asc().nullsLast(),
      table.sourceColumnIndex.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from ImportMappingProperty table */
export type ImportMappingPropertyEntity = typeof ImportMappingProperty.$inferSelect

/** Type for inserting into ImportMappingProperty table */
export type ImportMappingPropertyInsert = typeof ImportMappingProperty.$inferInsert
