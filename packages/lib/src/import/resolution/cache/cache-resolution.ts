// packages/lib/src/import/resolution/cache/cache-resolution.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ResolvedValue, ValueResolution } from '../../types/resolution'
import type { ResolutionStatus } from '../get-unique-values-with-status'

/** Input for caching a single resolution */
export interface CacheResolutionInput {
  jobPropertyId: string
  hashedValue: string
  rawValue: string
  cellCount: number
  resolvedValues: ResolvedValue[]
  isValid: boolean
  errorMessage?: string
  status: ResolutionStatus
}

/**
 * Save a single value resolution to the cache.
 *
 * @param db - Database instance
 * @param input - Resolution data to cache
 * @returns The created resolution record
 */
export async function cacheResolution(
  db: Database,
  input: CacheResolutionInput
): Promise<ValueResolution> {
  const [result] = await db
    .insert(schema.ImportValueResolution)
    .values({
      importJobPropertyId: input.jobPropertyId,
      hashedValue: input.hashedValue,
      rawValue: input.rawValue,
      cellCount: input.cellCount,
      resolvedValues: input.resolvedValues,
      isValid: input.isValid,
      errorMessage: input.errorMessage,
      status: input.status,
      updatedAt: new Date(),
    })
    .returning()

  return {
    id: result.id,
    importJobPropertyId: result.importJobPropertyId,
    hashedValue: result.hashedValue,
    rawValue: result.rawValue,
    cellCount: result.cellCount,
    resolvedValues: result.resolvedValues as ValueResolution['resolvedValues'],
    isValid: result.isValid,
    errorMessage: result.errorMessage ?? undefined,
  }
}
