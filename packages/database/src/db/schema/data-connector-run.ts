// packages/database/src/db/schema/data-connector-run.ts
// Drizzle table: DataConnectorRun — run/health ledger. One row per sync run.
// Powers the workspace Runs tab, surfaces partial failures, and provides the
// metrics for the per-run execution cap. See plans/data-connectors/.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, integer, jsonb, pgTable, text, timestamp } from './_shared'
import { DataConnector } from './data-connector'
import { Organization } from './organization'

export const DataConnectorRun = pgTable(
  'DataConnectorRun',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    dataConnectorId: text()
      .notNull()
      .references((): AnyPgColumn => DataConnector.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    trigger: text().notNull(), // 'manual' | 'scheduled' | 'webhook' | 'backfill'
    mode: text().notNull(), // 'snapshot' | 'incremental'
    status: text().notNull(), // 'running' | 'completed' | 'failed' | 'partial'
    // Engine-managed lifecycle phase of the run (sync-core). Null for legacy
    // single-shot full-sync runs that predate the backfill/steady split.
    phase: text(), // 'backfill' | 'steady'
    // counts (mirror the importer's execution statistics shape)
    fetched: integer().default(0).notNull(),
    created: integer().default(0).notNull(),
    updated: integer().default(0).notNull(),
    skipped: integer().default(0).notNull(),
    archived: integer().default(0).notNull(),
    deleted: integer().default(0).notNull(),
    failed: integer().default(0).notNull(),
    relationshipWarnings: integer().default(0).notNull(),
    // Pages fetched across the whole continuation chain (progress UI + slice budget).
    pagesProcessed: integer().default(0).notNull(),
    // Cumulative wall-clock spent waiting on rate limits (honest "Rate-limited" UX).
    rateLimitWaitMs: integer().default(0).notNull(),
    errorSample: jsonb().$type<Array<{ externalId: string; error: string }>>(),
    // Optional progress snapshot for the live status line (counts + per-stream phase).
    progress: jsonb().$type<Record<string, unknown>>(),
    cursorBefore: jsonb(),
    cursorAfter: jsonb(),
    startedAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    // Checkpoint heartbeat — bumped on every slice/update so the stale-run sweep
    // distinguishes "alive but slow" from "dead" across a continuation chain.
    // Keys the sweep off THIS, not startedAt (RunLedger.recordSlice contract).
    heartbeatAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    finishedAt: timestamp({ precision: 3 }),
    durationMs: integer(),
  },
  (table) => [
    index('DataConnectorRun_dataConnectorId_startedAt_idx').using(
      'btree',
      table.dataConnectorId.asc().nullsLast(),
      table.startedAt.asc().nullsLast()
    ),
    // Stale-run sweep: find 'running' runs whose heartbeat has gone cold.
    index('DataConnectorRun_status_heartbeatAt_idx').using(
      'btree',
      table.status.asc().nullsLast(),
      table.heartbeatAt.asc().nullsLast()
    ),
  ]
)

/** Selected DataConnectorRun entity type */
export type DataConnectorRunEntity = typeof DataConnectorRun.$inferSelect
