// packages/lib/src/import/job/update-job-status.ts

import { eq, sql } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ImportJobStatus } from '../types/job'

/**
 * Update import job status.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param status - New status
 */
export async function updateJobStatus(
  db: Database,
  jobId: string,
  status: ImportJobStatus
): Promise<void> {
  await db
    .update(schema.ImportJob)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportJob.id, jobId))
}

/**
 * Finalize upload and transition to waiting state.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 */
export async function finalizeUpload(db: Database, jobId: string): Promise<void> {
  await db
    .update(schema.ImportJob)
    .set({
      status: 'waiting',
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportJob.id, jobId))
}

/**
 * Increment received chunks count.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 */
export async function incrementReceivedChunks(db: Database, jobId: string): Promise<void> {
  await db
    .update(schema.ImportJob)
    .set({
      receivedChunks: sql`${schema.ImportJob.receivedChunks} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportJob.id, jobId))
}

/**
 * Set job to planning status.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 */
export async function markJobPlanning(db: Database, jobId: string): Promise<void> {
  await db
    .update(schema.ImportJob)
    .set({
      status: 'planning',
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportJob.id, jobId))
}

/**
 * Set job to ready status after planning.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 */
export async function markJobReady(db: Database, jobId: string): Promise<void> {
  await db
    .update(schema.ImportJob)
    .set({
      status: 'ready',
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportJob.id, jobId))
}

/**
 * Enable plan generation for a job.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 */
export async function allowPlanGeneration(db: Database, jobId: string): Promise<void> {
  await db
    .update(schema.ImportJob)
    .set({
      allowPlanGeneration: true,
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportJob.id, jobId))
}
