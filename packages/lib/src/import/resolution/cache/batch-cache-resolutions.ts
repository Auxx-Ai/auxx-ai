// packages/lib/src/import/resolution/cache/batch-cache-resolutions.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { CacheResolutionInput } from './cache-resolution'

/**
 * Batch save multiple value resolutions to the cache.
 * Uses bulk insert for efficiency.
 *
 * @param db - Database instance
 * @param resolutions - Array of resolutions to cache
 */
export async function batchCacheResolutions(
  db: Database,
  resolutions: CacheResolutionInput[]
): Promise<void> {
  if (resolutions.length === 0) {
    return
  }

  const now = new Date()

  await db.insert(schema.ImportValueResolution).values(
    resolutions.map((r) => ({
      importJobPropertyId: r.jobPropertyId,
      hashedValue: r.hashedValue,
      rawValue: r.rawValue,
      cellCount: r.cellCount,
      resolvedValues: r.resolvedValues,
      isValid: r.isValid,
      errorMessage: r.errorMessage,
      status: r.status,
      updatedAt: now,
    }))
  )
}
