// packages/lib/src/import/hashing/count-occurrences.ts

import { hashValue } from './hash-value'
import type { UniqueValue } from '../types/resolution'

/**
 * Count occurrences of each unique value in an array.
 * Returns unique values with their hash and count.
 */
export function countOccurrences(values: string[]): UniqueValue[] {
  const map = new Map<string, { rawValue: string; count: number }>()

  for (const rawValue of values) {
    const hash = hashValue(rawValue)
    const existing = map.get(hash)

    if (existing) {
      existing.count++
    } else {
      map.set(hash, { rawValue, count: 1 })
    }
  }

  return Array.from(map.entries()).map(([hash, { rawValue, count }]) => ({
    rawValue,
    hash,
    count,
  }))
}
