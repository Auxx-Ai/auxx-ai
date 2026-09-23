// packages/lib/src/import/resolution/cache/get-all-job-resolutions.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { resolutionKey } from '../../hashing/resolution-key'
import type { ValueResolution } from '../../types/resolution'

/**
 * Fetch all resolutions for a job across all mapped columns, keyed by {@link resolutionKey}
 * (mapping column + value hash): the same text resolves differently in different columns.
 */
export async function getAllJobResolutions(
  db: Database,
  jobId: string
): Promise<Map<string, ValueResolution>> {
  // First get all job properties for this job
  const jobProperties = await db.query.ImportJobProperty.findMany({
    where: eq(schema.ImportJobProperty.importJobId, jobId),
    columns: { id: true, importMappingPropertyId: true },
  })

  if (jobProperties.length === 0) {
    return new Map()
  }

  const propertyIds = jobProperties.map((p) => p.id)
  const mappingPropertyIdByJobProperty = new Map(
    jobProperties.map((p) => [p.id, p.importMappingPropertyId])
  )

  // Fetch all resolutions for these properties
  const resolutions = await db.query.ImportValueResolution.findMany({
    where: (table, { inArray }) => inArray(table.importJobPropertyId, propertyIds),
  })

  const result = new Map<string, ValueResolution>()

  for (const row of resolutions) {
    const mappingPropertyId = mappingPropertyIdByJobProperty.get(row.importJobPropertyId)
    if (!mappingPropertyId) continue
    result.set(`${mappingPropertyId}:${row.hashedValue}`, {
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
