// packages/lib/src/import/execution/track-progress.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
// Type-only import — sync-manifest-types has no runtime, so this creates no
// import ⇄ record-rules load edge.
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'
import type { ImportStatistics } from '../types/job'

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
 * Mark import job as completed.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param statistics - Final statistics
 */
export async function markJobCompleted(
  db: Database,
  jobId: string,
  statistics: ImportStatistics
): Promise<void> {
  await db
    .update(schema.ImportJob)
    .set({
      status: 'completed',
      statistics,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportJob.id, jobId))
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

/** B2: read a persisted import manifest (the `sync:records:changed` consumer). */
export async function getImportManifest(
  db: Database,
  jobId: string
): Promise<SyncChangeManifest | null> {
  const row = await db.query.ImportJob.findFirst({
    where: eq(schema.ImportJob.id, jobId),
    columns: { manifest: true },
  })
  return (row?.manifest as SyncChangeManifest | null) ?? null
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
