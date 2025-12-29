// packages/lib/src/import/hashing/hash-value.ts

import { createHash } from 'crypto'

/**
 * Generate truncated SHA256 hash of a string value.
 * Returns 16-char hex string for storage efficiency while maintaining uniqueness.
 * Used for deduplicating identical values during import.
 */
export function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
