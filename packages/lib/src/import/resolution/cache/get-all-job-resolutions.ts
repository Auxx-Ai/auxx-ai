// packages/lib/src/import/resolution/cache/get-all-job-resolutions.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { ValueResolution } from '../../types/resolution'

/**
 * Fetch all resolutions for a job across all mapped columns.
 * Returns a map keyed by hashedValue.
 *
 * Note: If multiple columns share the same value hash with different resolutions,
 * the last one will be used. This is acceptable for most use cases where
 * the same raw value resolves the same way regardless of column.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns Map of hashedValue → resolution
 */
export async function getAllJobResolutions(
  db: Database,
  jobId: string
): Promise<Map<string, ValueResolution>> {
  // First get all job properties for this job
  const jobProperties = await db.query.ImportJobProperty.findMany({
    where: eq(schema.ImportJobProperty.importJobId, jobId),
    columns: { id: true },
  })

  if (jobProperties.length === 0) {
    return new Map()
  }

  const propertyIds = jobProperties.map((p) => p.id)

  // Fetch all resolutions for these properties
  const resolutions = await db.query.ImportValueResolution.findMany({
    where: (table, { inArray }) => inArray(table.importJobPropertyId, propertyIds),
  })

  const result = new Map<string, ValueResolution>()

  for (const row of resolutions) {
    result.set(row.hashedValue, {
      id: row.id,
      importJobPropertyId: row.importJobPropertyId,
      hashedValue: row.hashedValue,
      rawValue: row.rawValue,
      cellCount: row.cellCount,
      resolvedValues: row.resolvedValues as ValueResolution['resolvedValues'],
      isValid: row.isValid,
      errorMessage: row.errorMessage ?? undefined,
    })
  }

  return result
}
