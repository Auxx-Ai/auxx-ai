// packages/database/src/db/schema/import-job-mappable-property.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { ImportJob } from './import-job'

/**
 * ImportJobMappableProperty - CSV column metadata for a job
 * Stores the column headers from the uploaded CSV file
 */
export const ImportJobMappableProperty = pgTable(
  'ImportJobMappableProperty',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),

    // Parent job
    importJobId: text()
      .notNull()
      .references((): AnyPgColumn => ImportJob.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Column index (0-based)
    columnIndex: integer().notNull(),

    // Column name from CSV header
    visibleName: text().notNull(),
  },
  (table) => [
    index('ImportJobMappableProperty_importJobId_idx').using(
      'btree',
      table.importJobId.asc().nullsLast()
    ),
    uniqueIndex('ImportJobMappableProperty_jobId_columnIndex_key').using(
      'btree',
      table.importJobId.asc().nullsLast(),
      table.columnIndex.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from ImportJobMappableProperty table */
export type ImportJobMappablePropertyEntity = typeof ImportJobMappableProperty.$inferSelect

/** Type for inserting into ImportJobMappableProperty table */
export type ImportJobMappablePropertyInsert = typeof ImportJobMappableProperty.$inferInsert
