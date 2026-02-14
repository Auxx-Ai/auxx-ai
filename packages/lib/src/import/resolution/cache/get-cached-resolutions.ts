// packages/lib/src/import/resolution/cache/get-cached-resolutions.ts

import type { Database } from '@auxx/database'
import { eq, inArray } from 'drizzle-orm'
import type { ValueResolution } from '../../types/resolution'

/**
 * Fetch cached resolutions by value hashes.
 *
 * @param db - Database instance
 * @param jobPropertyId - The import job property ID
 * @param hashes - Array of value hashes to look up
 * @returns Map of hash → resolution
 */
export async function getCachedResolutions(
  db: Database,
  jobPropertyId: string,
  hashes: string[]
): Promise<Map<string, ValueResolution>> {
  if (hashes.length === 0) {
    return new Map()
  }

  const cached = await db.query.ImportValueResolution.findMany({
    where: (table, { and }) =>
      and(eq(table.importJobPropertyId, jobPropertyId), inArray(table.hashedValue, hashes)),
  })

  const result = new Map<string, ValueResolution>()

  for (const row of cached) {
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
