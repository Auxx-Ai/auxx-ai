// packages/database/src/db/schema/export-job.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  exportJobStatus,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from './_shared'
import { Organization } from './organization'
import { StorageLocation } from './storage-location'
import { User } from './user'

/**
 * One column in an export snapshot. `fieldRef` is a `FieldReference`:
 * a `ResourceFieldId` string (`contact:email`) for direct fields, or a
 * `FieldPath` string array (`['product:vendor', 'vendor:name']`) for
 * relationship traversal. Both are valid inputs to `batchGetValues`.
 */
export interface ExportColumnSnapshot {
  label: string
  fieldRef: string | string[]
}

/**
 * ExportJob — a background CSV export of entity records driven by a table view.
 * The filters / sorting / columns are snapshotted at creation so the export
 * reflects what the user requested even if the view changes mid-run.
 */
export const ExportJob = pgTable(
  'ExportJob',
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

    // Creator
    createdById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // Target entity definition (no FK — system defs like contact/ticket aren't rows)
    entityDefinitionId: text().notNull(),

    // Free-form table id (e.g. "entity-<defId>") + saved view id — reference/label only
    tableId: text(),
    viewId: text(),

    // 'view' (filters + visible columns) | 'all' (no filters + all fields)
    exportType: text().notNull(),

    status: exportJobStatus().notNull().default('pending'),

    // Snapshots taken at creation
    filters: jsonb().$type<unknown[]>(),
    sorting: jsonb().$type<Array<{ id: string; desc: boolean }>>(),
    columns: jsonb().$type<ExportColumnSnapshot[]>().notNull(),

    // Progress
    totalRecords: integer().notNull().default(0),
    processedRecords: integer().notNull().default(0),

    // Result
    storageLocationId: text().references((): AnyPgColumn => StorageLocation.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    fileName: text(),
    fileSizeBytes: integer(),
    error: text(),

    startedAt: timestamp({ precision: 3 }),
    completedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('ExportJob_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('ExportJob_status_idx').using('btree', table.status.asc().nullsLast()),
    index('ExportJob_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
    index('ExportJob_entityDefinitionId_idx').using(
      'btree',
      table.entityDefinitionId.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from ExportJob table */
export type ExportJobEntity = typeof ExportJob.$inferSelect

/** Type for inserting into ExportJob table */
export type ExportJobInsert = typeof ExportJob.$inferInsert
