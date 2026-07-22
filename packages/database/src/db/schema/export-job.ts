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
 * A print run's output format — reuses the whole `ExportJob` worker/realtime/progress/list
 * surface (plans/printing/01-unified-print.md §B locked decision 2). `'csv'` is the existing
 * export path; `'pdf'` is a print run driven by a `PrintConfig` snapshot.
 */
export type ExportJobFormat = 'csv' | 'pdf'

/** Master print style — which generic renderer a print run uses (§A/§B). */
export type PrintStyle = 'list' | 'detail' | 'document'

/**
 * Free-text header/footer slots for a print run. Substituted at render time with tokens:
 * `{page}`, `{pages}`, `{date}`, `{orgName}`, `{viewName}`, `{count}`.
 */
export interface PrintHeaderFooter {
  left?: string
  center?: string
  right?: string
}

/**
 * Full print-run configuration snapshot, stored on `ExportJob.printConfig` and (later) as the
 * org's last-used default per entity + style (`printing.lastUsed.<entityDefinitionId>`).
 * Defined here (not in `@auxx/lib`) because `@auxx/database` can never depend on `@auxx/lib` —
 * `packages/lib/src/export/types.ts` re-exports this type family for server code, and
 * `packages/lib/src/export/client.ts` re-exports it again for client-safe (wizard) code.
 */
export interface PrintConfig {
  style: PrintStyle
  /** Defaults from documents branding (`resolveDocumentSettings().branding.paperSize`). */
  paperSize: 'a4' | 'letter'
  orientation: 'auto' | 'portrait' | 'landscape'
  header: PrintHeaderFooter & { showLogo: boolean }
  footer: PrintHeaderFooter
  list?: {
    /** 'shrink' scales font down to fit all columns; 'wrap' keeps 9pt and wraps cells. */
    fitMode: 'shrink' | 'wrap'
  }
  detail?: { pageBreakPerRecord: boolean }
  document?: {
    /** Registry id ('invoice' | 'quote') — see `@auxx/lib/documents`'s `RegisteredDocumentType`. */
    documentTypeId: string
    copies: Array<'customer' | 'office'>
    /** 'per_record': cust, office, cust, office… (staple-ready). 'stacks': all cust, then all office. */
    collation: 'per_record' | 'stacks'
    /** Values for the registry's `printOptions` fields (e.g. invoice sortBy) — P4. */
    options?: Record<string, unknown>
  }
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

    // 'view' | 'all' | 'selection' (no filters + no filters + frozen recordIds respectively)
    exportType: text().notNull(),

    // 'csv' (existing export path) | 'pdf' (print run — see `printConfig`)
    format: text().notNull().default('csv'),

    status: exportJobStatus().notNull().default('pending'),

    // Snapshots taken at creation
    filters: jsonb().$type<unknown[]>(),
    sorting: jsonb().$type<Array<{ id: string; desc: boolean }>>(),
    columns: jsonb().$type<ExportColumnSnapshot[]>().notNull(),
    // Print-run config snapshot — null for CSV exports (`format: 'csv'`).
    printConfig: jsonb().$type<PrintConfig>(),
    // exportType 'selection' — frozen RecordId list, ordered as selected.
    recordIds: jsonb().$type<string[]>(),

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
