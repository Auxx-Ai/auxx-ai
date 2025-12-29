// packages/database/src/db/schema/import-job.ts

import {
  pgTable,
  index,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  type AnyPgColumn,
  importJobStatus,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { Organization } from './organization'
import { User } from './user'
import { ImportMapping } from './import-mapping'

/**
 * ImportJob - Individual import job instance
 * Created when a user starts an import
 */
export const ImportJob = pgTable(
  'ImportJob',
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

    // The mapping template used
    importMappingId: text()
      .notNull()
      .references((): AnyPgColumn => ImportMapping.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Original file name
    sourceFileName: text().notNull(),

    // CSV metadata
    columnCount: integer().notNull(),
    rowCount: integer().notNull(),

    // Chunk upload tracking
    totalChunks: integer(),
    receivedChunks: integer().default(0),

    // Job status
    status: importJobStatus().notNull().default('uploading'),

    // If ingestion failed, the reason
    ingestionFailureReason: text(),

    // Whether user has completed mappings and can generate plan
    allowPlanGeneration: boolean().notNull().default(false),

    // Final statistics (JSON)
    // { created, updated, skipped, failed, durationMs }
    statistics: jsonb(),

    // Creator
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    // Timestamps for tracking
    confirmedAt: timestamp({ precision: 3 }),
    startedExecutionAt: timestamp({ precision: 3 }),
    completedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('ImportJob_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('ImportJob_importMappingId_idx').using('btree', table.importMappingId.asc().nullsLast()),
    index('ImportJob_status_idx').using('btree', table.status.asc().nullsLast()),
    index('ImportJob_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
  ]
)

/** Type for selecting from ImportJob table */
export type ImportJobEntity = typeof ImportJob.$inferSelect

/** Type for inserting into ImportJob table */
export type ImportJobInsert = typeof ImportJob.$inferInsert
