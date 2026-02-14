// packages/database/src/db/schema/import-job-property.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { ImportJob } from './import-job'
import { ImportMappingProperty } from './import-mapping-property'

/**
 * ImportJobProperty - Job-specific property instance
 * Tracks resolution stats for each mapped column in a job
 */
export const ImportJobProperty = pgTable(
  'ImportJobProperty',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),

    // Parent job
    importJobId: text()
      .notNull()
      .references((): AnyPgColumn => ImportJob.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // The mapping property template
    importMappingPropertyId: text()
      .notNull()
      .references((): AnyPgColumn => ImportMappingProperty.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    // Resolution statistics
    uniqueValueCount: integer().notNull().default(0),
    resolvedCount: integer().notNull().default(0),
    errorCount: integer().notNull().default(0),
  },
  (table) => [
    index('ImportJobProperty_importJobId_idx').using('btree', table.importJobId.asc().nullsLast()),
    uniqueIndex('ImportJobProperty_jobId_mappingPropertyId_key').using(
      'btree',
      table.importJobId.asc().nullsLast(),
      table.importMappingPropertyId.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from ImportJobProperty table */
export type ImportJobPropertyEntity = typeof ImportJobProperty.$inferSelect

/** Type for inserting into ImportJobProperty table */
export type ImportJobPropertyInsert = typeof ImportJobProperty.$inferInsert
