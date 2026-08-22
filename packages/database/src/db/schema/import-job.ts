// packages/database/src/db/schema/import-job.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  importJobStatus,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from './_shared'
import { ImportMapping } from './import-mapping'
import { Organization } from './organization'
import { User } from './user'

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
      .references((): AnyPgColumn => ImportMapping.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

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

    // B2 — sync-change manifest captured by the import's skipEvents writes, persisted
    // here so the `sync:records:changed` pointer event stays payload-free (same
    // transport as DataConnectorRun.manifest — no inline cap, no truncation).
    // Structural mirror of `SyncChangeManifest` in `@auxx/lib/record-rules` (can't
    // import across the tier boundary — keep in sync BY HAND, incl. `version: 1`).
    manifest: jsonb().$type<{
      version: 1
      truncated: boolean
      changes: Record<string, Record<string, { o?: unknown; n: unknown }>>
      createdRecordIds: string[]
      archivedRecordIds: string[]
    }>(),
    // B2 — once-per-import consume claim for the manifest (atomic
    // `… WHERE manifestConsumedAt IS NULL RETURNING` in the event consumer), so a
    // redelivered event can never double-fire rule actions.
    manifestConsumedAt: timestamp({ precision: 3 }),
    // Phase 6 (plan events/03 §9, D-3/D-13/D-19) — the guarded workflow dispatch
    // tally, written once at finalize on the LARGE lane (same shape and rules as
    // DataConnectorRun.heldDispatches). Structural mirror of `HeldDispatchEntry`
    // in `@auxx/lib` events/handlers/sync-dispatch-guard.ts — keep in sync BY HAND.
    heldDispatches:
      jsonb().$type<
        Array<{
          workflowId: string
          workflowAppId: string
          workflowName?: string
          triggerType: 'created' | 'updated' | 'deleted'
          entityDefinitionId: string
          recordIds?: string[]
          count: number
          status: 'held' | 'auto' | 'approved' | 'skipped'
          approvalRequestId?: string
        }>
      >(),

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
