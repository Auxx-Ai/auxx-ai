// packages/lib/src/export/job/update-job.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { ExportJobStatus } from '../types'

/**
 * Fields the worker may patch on an export job. Every field is optional — only
 * the ones present are written (plus `updatedAt`, always stamped). Callers pass
 * `startedAt` / `completedAt` explicitly on the transitions that need them.
 */
export interface UpdateExportJobInput {
  status?: ExportJobStatus
  totalRecords?: number
  processedRecords?: number
  storageLocationId?: string | null
  fileName?: string | null
  fileSizeBytes?: number | null
  error?: string | null
  startedAt?: Date
  completedAt?: Date
}

/**
 * Patch an export job. One entry point for every lifecycle write the worker
 * makes (mark processing, record total, bump progress, complete, fail) — pass
 * the fields that change; the rest are left untouched.
 *
 * @param db - Database instance
 * @param jobId - Export job ID
 * @param patch - Fields to update
 */
export async function updateExportJob(
  db: Database,
  jobId: string,
  patch: UpdateExportJobInput
): Promise<void> {
  await db
    .update(schema.ExportJob)
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.totalRecords !== undefined ? { totalRecords: patch.totalRecords } : {}),
      ...(patch.processedRecords !== undefined ? { processedRecords: patch.processedRecords } : {}),
      ...(patch.storageLocationId !== undefined
        ? { storageLocationId: patch.storageLocationId }
        : {}),
      ...(patch.fileName !== undefined ? { fileName: patch.fileName } : {}),
      ...(patch.fileSizeBytes !== undefined ? { fileSizeBytes: patch.fileSizeBytes } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
      ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.ExportJob.id, jobId))
}

/**
 * Mark a job canceled, but only if it is still pending or processing. Returns
 * true when a row was flipped (the worker checks `throwIfCancelled`). Kept
 * separate from {@link updateExportJob} for its status-guarded, org-scoped write.
 */
export async function markCanceled(
  db: Database,
  organizationId: string,
  jobId: string
): Promise<boolean> {
  const rows = await db
    .update(schema.ExportJob)
    .set({ status: 'canceled', completedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.ExportJob.id, jobId),
        eq(schema.ExportJob.organizationId, organizationId),
        inArray(schema.ExportJob.status, ['pending', 'processing'])
      )
    )
    .returning({ id: schema.ExportJob.id })
  return rows.length > 0
}

/** Delete an export job row, scoped to organization. Returns true if deleted. */
export async function deleteExportJob(
  db: Database,
  organizationId: string,
  jobId: string
): Promise<boolean> {
  const rows = await db
    .delete(schema.ExportJob)
    .where(and(eq(schema.ExportJob.id, jobId), eq(schema.ExportJob.organizationId, organizationId)))
    .returning({ id: schema.ExportJob.id })
  return rows.length > 0
}
