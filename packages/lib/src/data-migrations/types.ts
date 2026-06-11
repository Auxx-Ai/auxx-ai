// packages/lib/src/data-migrations/types.ts

import type { Database } from '@auxx/database'

/**
 * A one-shot data migration (backfill, reshape, per-org reconciliation, or an
 * assert-only guard for a manual operation). Tracked by the `DataMigration` ledger
 * and executed exactly once by the runner.
 *
 * `run()` MUST throw on failure (the ledger only knows what the runner sees) and
 * should be safe to re-run from the top — guard writes with check-then-create /
 * upsert so a retry after a halfway failure repairs instead of duplicating.
 */
export interface DataMigrationDef {
  /** Stable, ordered id: zero-padded sequence + slug, e.g. '024-backfill-foo'. Never reuse. */
  id: string
  description: string
  run(db: Database): Promise<void>
}

/** Per-migration row as surfaced to the admin panel (registry joined with the ledger). */
export interface DataMigrationStatus {
  id: string
  description: string
  status: 'applied' | 'failed' | 'pending'
  error: string | null
  durationMs: number | null
  appliedAt: Date | null
}

/** Outcome of a runner pass, for the job log / tRPC response. */
export interface RunSummary {
  applied: string[]
  /** The migration that failed (or the pre-existing `failed` row that halted the run). */
  failed?: string
  skipped: string[]
}
