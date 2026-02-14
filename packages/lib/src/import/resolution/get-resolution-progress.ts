// packages/lib/src/import/resolution/get-resolution-progress.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

/** Resolution progress for a job */
export interface ResolutionProgress {
  columnsProcessed: number
  totalColumns: number
  valuesProcessed: number
  totalValues: number
}

/**
 * Get resolution progress for an import job.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns Resolution progress
 */
export async function getResolutionProgress(
  db: Database,
  jobId: string
): Promise<ResolutionProgress> {
  // Get job for total column count
  const job = await db.query.ImportJob.findFirst({
    where: eq(schema.ImportJob.id, jobId),
    columns: {
      columnCount: true,
    },
  })

  if (!job) {
    return {
      columnsProcessed: 0,
      totalColumns: 0,
      valuesProcessed: 0,
      totalValues: 0,
    }
  }

  // Count job properties and resolved values
  const jobProps = await db.query.ImportJobProperty.findMany({
    where: eq(schema.ImportJobProperty.importJobId, jobId),
  })

  let totalValues = 0
  let resolvedValues = 0

  for (const prop of jobProps) {
    totalValues += prop.uniqueValueCount ?? 0
    resolvedValues += prop.resolvedCount ?? 0
  }

  return {
    columnsProcessed: jobProps.length,
    totalColumns: job.columnCount,
    valuesProcessed: resolvedValues,
    totalValues,
  }
}
