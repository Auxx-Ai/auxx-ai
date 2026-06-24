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
    // Trial-sync per-stream record cap (trial-sync-plan §4.1). Set ⇒ this is a SAMPLE
    // run: each stream's backfill stops once it has seen this many records, then the
    // run parks `partial` (`progress.paused.reason = 'sample'`) for review. Null ⇒ a
    // normal run (runs to the real ingest ceiling). Per-run only — never persisted on
    // the connector, so the "Sync everything" resume carries no cap and runs to completion.
    sampleLimit: integer(),
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
    // `tier` (Step 9 §1.1): 'invalid' (bad shape, pre-write drop) | 'rejected'
    // (the entity write threw). Omitted ⇒ engine-level error → neutral "Error".
    // Mirror of `RunCounters.errorSample` in lib service.ts (hand-synced).
    errorSample:
      jsonb().$type<Array<{ externalId: string; error: string; tier?: 'invalid' | 'rejected' }>>(),
    // Optional progress snapshot for the live status line (counts + per-stream phase).
    progress: jsonb().$type<Record<string, unknown>>(),
    // B2 — the decoded stream+mapping snapshot the continuation chain is PINNED to.
    // Captured once when the backfill is enqueued so a mid-chain config/mapping edit
    // can't skew slices already in flight; every slice job decodes against this, not
    // live config. Null for legacy single-shot runs. See plans/data-connectors/v3.
    chainSnapshot: jsonb().$type<Record<string, unknown>>(),
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
