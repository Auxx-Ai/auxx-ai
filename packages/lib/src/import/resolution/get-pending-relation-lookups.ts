// packages/lib/src/import/resolution/get-pending-relation-lookups.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { PendingRelationLookup } from './resolve-relation-lookups'
import { isPendingRelationLookup } from './resolvers'

/**
 * Get all pending relation lookups for a job.
 * Queries ImportValueResolution records where the resolved value
 * contains a __pendingRelationLookup marker.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns Array of pending relation lookups
 */
export async function getPendingRelationLookups(
  db: Database,
  jobId: string
): Promise<PendingRelationLookup[]> {
  // Get all ImportJobProperty records for this job
  const jobProperties = await db.query.ImportJobProperty.findMany({
    where: eq(schema.ImportJobProperty.importJobId, jobId),
  })

  if (jobProperties.length === 0) {
    return []
  }

  const pendingLookups: PendingRelationLookup[] = []

  // For each job property, find resolutions with pending lookups
  for (const jobProp of jobProperties) {
    const resolutions = await db.query.ImportValueResolution.findMany({
      where: eq(schema.ImportValueResolution.importJobPropertyId, jobProp.id),
    })

    for (const resolution of resolutions) {
      if (!resolution.resolvedValues) continue

      // resolvedValues is JSONB, returned as parsed object
      const values = resolution.resolvedValues as Array<{ type: string; value?: unknown }>
      if (!Array.isArray(values)) continue

      const firstValue = values[0]?.value

      if (isPendingRelationLookup(firstValue)) {
        pendingLookups.push({
          hash: resolution.hashedValue,
          jobPropertyId: jobProp.id,
          entityDefinitionId: firstValue.targetTable,
          matchField: firstValue.matchField ?? '',
          searchValue: firstValue.searchValue,
          createIfNotFound: firstValue.__createIfNotFound,
          isDirectId: firstValue.__isDirectId,
        })
      }
    }
  }

  return pendingLookups
}
