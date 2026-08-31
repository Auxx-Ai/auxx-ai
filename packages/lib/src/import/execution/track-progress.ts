// packages/lib/src/import/execution/track-progress.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
// Type-only import — sync-manifest-types has no runtime, so this creates no
// import ⇄ record-rules load edge.
import type {
  SyncChangeManifest,
  SyncChangeManifestV1,
} from '../../record-rules/sync-manifest-types'
import type { ImportJobStatus, ImportStatistics } from '../types/job'
import { classifyImportOutcome, outcomeToJobStatus } from './classify-outcome'

/**
 * Update import job progress and statistics.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param statistics - Current statistics
 */
export async function updateJobProgress(
  db: Database,
  jobId: string,
  statistics: ImportStatistics
): Promise<void> {
  await db
    .update(schema.ImportJob)
    .set({
      statistics,
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportJob.id, jobId))
}

/**
 * Mark import job as executing.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 */
export async function markJobExecuting(db: Database, jobId: string): Promise<void> {
  const now = new Date()
  await db
    .update(schema.ImportJob)
    .set({
      status: 'executing',
      confirmedAt: now,
      startedExecutionAt: now,
      updatedAt: now,
    })
    .where(eq(schema.ImportJob.id, jobId))
}

/**
 * Mark an import job finished, with the terminal status DERIVED from its own
 * statistics — `completed`, `completed_with_errors`, or `failed`.
 *
 * The status is derived here rather than passed in on purpose. This function
 * used to hard-code `'completed'`, so a run in which every single row was
 * rejected was stored, badged and rendered exactly like a clean one; the caller
 * held a correctly-classified result and simply never forwarded it. Deriving
 * from the counters removes the opportunity to forget.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param statistics - Final statistics
 * @returns The terminal status written to the job row
 */
export async function markJobCompleted(
  db: Database,
  jobId: string,
  statistics: ImportStatistics
): Promise<ImportJobStatus> {
  const status = outcomeToJobStatus(classifyImportOutcome(statistics))

  await db
    .update(schema.ImportJob)
    .set({
      status,
      statistics,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportJob.id, jobId))

  return status
}

/**
 * B2: persist the import's captured sync-change manifest on the job row — the same
 * row-transport the connector path uses (DataConnectorRun.manifest), so the
 * `sync:records:changed` pointer event carries no payload and no inline cap.
 */
export async function saveImportManifest(
  db: Database,
  jobId: string,
  manifest: SyncChangeManifest
): Promise<void> {
  await db
    .update(schema.ImportJob)
    // The column's hand-mirrored jsonb type keys `changes` by plain string
    // (RecordId is a lib-side brand) — structurally identical.
    .set({ manifest: manifest as never, updatedAt: new Date() })
    .where(eq(schema.ImportJob.id, jobId))
}

/**
 * B2: read a persisted import manifest (the `sync:records:changed` consumer). Returns
 * the STORED shape — rows written before the v2 deploy are still v1; callers upgrade
 * via `upgradeManifestV1` at their read edge.
 */
export async function getImportManifest(
  db: Database,
  jobId: string
): Promise<SyncChangeManifest | SyncChangeManifestV1 | null> {
  const row = await db.query.ImportJob.findFirst({
    where: eq(schema.ImportJob.id, jobId),
    columns: { manifest: true },
  })
  return (row?.manifest as SyncChangeManifest | SyncChangeManifestV1 | null) ?? null
}

/**
 * B2: atomically claim an import's manifest for once-only consumption (mirror of
 * `claimRunManifestConsumed` on the connector side). True for exactly one caller;
 * redelivered pointer events get false and must no-op.
 */
export async function claimImportManifestConsumed(db: Database, jobId: string): Promise<boolean> {
  const rows = await db
    .update(schema.ImportJob)
    .set({ manifestConsumedAt: new Date() })
    .where(and(eq(schema.ImportJob.id, jobId), isNull(schema.ImportJob.manifestConsumedAt)))
    .returning({ id: schema.ImportJob.id })
  return rows.length > 0
}

/**
 * Mark import job as failed.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param reason - Failure reason
 */
export async function markJobFailed(db: Database, jobId: string, reason: string): Promise<void> {
  await db
    .update(schema.ImportJob)
    .set({
      status: 'failed',
      ingestionFailureReason: reason,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportJob.id, jobId))
}
