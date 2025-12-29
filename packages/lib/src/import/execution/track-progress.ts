// packages/lib/src/import/execution/track-progress.ts

import { eq } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
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
