// packages/lib/src/import/job/delete-job.ts

import { eq, and } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'

/**
 * Input for deleting a job.
 */
export interface DeleteJobInput {
  jobId: string
  organizationId: string
}

/**
 * Delete an import job and its associated mapping.
 * Verifies job belongs to the organization before deleting.
 *
 * @param db - Database instance
 * @param input - Job ID and organization ID for verification
 * @returns True if job was deleted, false if not found
 */
export async function deleteJob(
  db: Database,
  input: DeleteJobInput
): Promise<boolean> {
  // First verify the job exists and belongs to the org
  const job = await db.query.ImportJob.findFirst({
    where: and(
      eq(schema.ImportJob.id, input.jobId),
      eq(schema.ImportJob.organizationId, input.organizationId)
    ),
    columns: { id: true, importMappingId: true },
  })

  if (!job) {
    return false
  }

  // Delete job and mapping in a transaction
  await db.transaction(async (tx) => {
    // Delete the job first (cascade handles ImportJobProperty, ImportPlan, etc.)
    await tx
      .delete(schema.ImportJob)
      .where(eq(schema.ImportJob.id, input.jobId))

    // Delete the associated mapping (cascade handles ImportMappingProperty)
    await tx
      .delete(schema.ImportMapping)
      .where(eq(schema.ImportMapping.id, job.importMappingId))
  })

  return true
}
