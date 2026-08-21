// packages/lib/src/import/resolution/get-pending-relation-lookups.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { PendingRelationLookup } from './resolve-relation-lookups'
import { isPendingRelationLookup } from './resolvers'

/**
 * Get all pending relation lookups for a job.
 * Queries ImportValueResolution records where the resolved value
 * contains a __pendingRelationLookup marker.
 *
 * Both queries are flat: the resolutions for every mapped column are read in
 * ONE `inArray` pass and grouped in memory, the same shape
 * `getAllJobResolutions` uses. Per-column reads made this O(columns)
 * roundtrips for a table that is already indexed on `importJobPropertyId`.
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
    columns: { id: true },
  })

  if (jobProperties.length === 0) {
    return []
  }

  const propertyIds = jobProperties.map((p) => p.id)

  const resolutions = await db.query.ImportValueResolution.findMany({
    where: (table, { inArray }) => inArray(table.importJobPropertyId, propertyIds),
  })

  const pendingLookups: PendingRelationLookup[] = []

  for (const resolution of resolutions) {
    if (!resolution.resolvedValues) continue

    // resolvedValues is JSONB, returned as parsed object
    const values = resolution.resolvedValues as Array<{ type: string; value?: unknown }>
    if (!Array.isArray(values)) continue

    const firstValue = values[0]?.value

    if (isPendingRelationLookup(firstValue)) {
      pendingLookups.push({
        hash: resolution.hashedValue,
        jobPropertyId: resolution.importJobPropertyId,
        entityDefinitionId: firstValue.targetTable,
        matchField: firstValue.matchField ?? '',
        searchValue: firstValue.searchValue,
        // `__createIfNotFound` predates the three-way policy; a marker
        // carrying only the old flag still means "create".
        onNoMatch: firstValue.__onNoMatch ?? (firstValue.__createIfNotFound ? 'create' : 'fail'),
        linkMode: firstValue.__linkMode,
        isDirectId: firstValue.__isDirectId,
      })
    }
  }

  return pendingLookups
}
