// packages/database/src/db/schema/import-job-raw-data.ts

import { pgTable, index, text, integer, timestamp, type AnyPgColumn } from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { ImportJob } from './import-job'

/**
 * ImportJobRawData - Raw CSV cell values
 * Stores each cell value from the uploaded CSV
 */
export const ImportJobRawData = pgTable(
  'ImportJobRawData',
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

    // Position in CSV
    rowIndex: integer().notNull(),
    columnIndex: integer().notNull(),

    // The raw string value
    value: text().notNull().default(''),

    // Pre-computed hash for deduplication
    valueHash: text().notNull(),
  },
  (table) => [
    index('ImportJobRawData_importJobId_idx').using('btree', table.importJobId.asc().nullsLast()),
    index('ImportJobRawData_importJobId_rowIndex_idx').using(
      'btree',
      table.importJobId.asc().nullsLast(),
      table.rowIndex.asc().nullsLast()
    ),
    index('ImportJobRawData_importJobId_columnIndex_idx').using(
      'btree',
      table.importJobId.asc().nullsLast(),
      table.columnIndex.asc().nullsLast()
    ),
    index('ImportJobRawData_valueHash_idx').using(
      'btree',
      table.importJobId.asc().nullsLast(),
      table.columnIndex.asc().nullsLast(),
      table.valueHash.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from ImportJobRawData table */
export type ImportJobRawDataEntity = typeof ImportJobRawData.$inferSelect

/** Type for inserting into ImportJobRawData table */
export type ImportJobRawDataInsert = typeof ImportJobRawData.$inferInsert
