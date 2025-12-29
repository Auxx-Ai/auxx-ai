// packages/lib/src/import/resolution/process-column-values.ts

import type { Database } from '@auxx/database'
import type {
  ResolutionType,
  ResolutionConfig,
  ValueResolution,
  ResolvedValue,
} from '../types/resolution'
import type { ResolutionStatus } from './get-unique-values-with-status'
import { hashValue } from '../hashing/hash-value'
import { countOccurrences } from '../hashing/count-occurrences'
import { resolveValue } from './resolve-value'
import { getCachedResolutions } from './cache/get-cached-resolutions'
import { batchCacheResolutions } from './cache/batch-cache-resolutions'

/**
 * Derive resolution status from resolved value type.
 */
function deriveStatus(resolved: ResolvedValue): ResolutionStatus {
  switch (resolved.type) {
    case 'value':
      return 'valid'
    case 'error':
      return 'error'
    case 'warning':
      return 'warning'
    case 'create':
      return 'create'
    default:
      return 'pending'
  }
}

/** Options for processing column values */
export interface ProcessColumnValuesOptions {
  db: Database
  jobPropertyId: string
  values: string[]
  resolutionType: ResolutionType
  config?: ResolutionConfig
  /** Progress callback - called with (processed, total) */
  onProgress?: (processed: number, total: number) => void
}

/**
 * Process all values for a column, resolving each unique value.
 * Uses caching to avoid re-resolving duplicate values.
 *
 * @param options - Processing options
 * @returns Map of hash → resolution result
 */
export async function processColumnValues(
  options: ProcessColumnValuesOptions
): Promise<Map<string, ValueResolution>> {
  const { db, jobPropertyId, values, resolutionType, config = {}, onProgress } = options

  // Count unique values with occurrences
  const uniqueValues = countOccurrences(values)
  const hashes = uniqueValues.map((v) => v.hash)

  // Check for cached resolutions
  const cached = await getCachedResolutions(db, jobPropertyId, hashes)
  const result = new Map<string, ValueResolution>(cached)

  // Find values that need resolution
  const toResolve = uniqueValues.filter((v) => !cached.has(v.hash))

  if (toResolve.length === 0) {
    onProgress?.(uniqueValues.length, uniqueValues.length)
    return result
  }

  // Resolve each unique value
  const newResolutions: Array<{
    jobPropertyId: string
    hashedValue: string
    rawValue: string
    cellCount: number
    resolvedValues: ResolvedValue[]
    isValid: boolean
    errorMessage?: string
    status: ResolutionStatus
  }> = []

  let processed = cached.size

  for (const { rawValue, hash, count } of toResolve) {
    const resolved = resolveValue(rawValue, resolutionType, config)

    const resolution = {
      jobPropertyId,
      hashedValue: hash,
      rawValue,
      cellCount: count,
      resolvedValues: [resolved],
      isValid: resolved.type !== 'error',
      errorMessage: resolved.type === 'error' ? resolved.error : undefined,
      status: deriveStatus(resolved),
    }

    newResolutions.push(resolution)
    // Exclude status from in-memory map (only needed for DB storage)
    // Also rename jobPropertyId to importJobPropertyId for ValueResolution type
    const { status: _, jobPropertyId: __, ...rest } = resolution
    result.set(hash, {
      id: '', // Will be set after insert
      importJobPropertyId: jobPropertyId,
      ...rest,
    })

    processed++
    onProgress?.(processed, uniqueValues.length)
  }

  // Batch save new resolutions
  if (newResolutions.length > 0) {
    await batchCacheResolutions(db, newResolutions)
  }

  return result
}
