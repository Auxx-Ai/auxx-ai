// packages/lib/src/import/job/reopen-planned-job.ts

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Send a planned job back to `waiting` and drop its plan, after a mapping or value override
 * changed what the plan was built from. The confirm step only plans a `waiting` job, so without
 * this it would show, and execute, the superseded plan. Jobs past `ready` are left alone.
 *
 * @param db - Database instance or open transaction
 * @param scope - The job, or every job on a mapping
 */
export async function reopenPlannedJobs(
  db: Database | Transaction,
  scope: { jobId: string } | { mappingId: string }
): Promise<void> {
  const target =
    'jobId' in scope
      ? eq(schema.ImportJob.id, scope.jobId)
      : eq(schema.ImportJob.importMappingId, scope.mappingId)

  const reopened = await db
    .update(schema.ImportJob)
    .set({ status: 'waiting', updatedAt: new Date() })
    .where(and(target, eq(schema.ImportJob.status, 'ready')))
    .returning({ id: schema.ImportJob.id })

  const jobIds = reopened.map((row) => row.id)
  if (jobIds.length === 0) return

  await db.delete(schema.ImportPlan).where(inArray(schema.ImportPlan.importJobId, jobIds))
}
