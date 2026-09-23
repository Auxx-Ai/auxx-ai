// packages/lib/src/import/hashing/resolution-key.ts

import { hashValue } from './hash-value'

/**
 * The key of one column's resolution of one raw cell in a job's resolution map.
 * Per column because the same text resolves differently by column ("12" is 1200 minor in a
 * currency column, 12 in a number column).
 */
export function resolutionKey(mappingPropertyId: string, rawValue: string): string {
  return `${mappingPropertyId}:${hashValue(rawValue)}`
}
