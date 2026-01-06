// packages/lib/src/utils/arrays.ts

/**
 * Returns a new array with unique elements based on a key property.
 * Keeps the first occurrence of each unique key.
 */
export function uniqueBy<T>(array: T[], key: keyof T | ((item: T) => unknown)): T[] {
  const seen = new Set<unknown>()
  const result: T[] = []

  for (const item of array) {
    const keyValue = typeof key === 'function' ? key(item) : item[key]
    if (!seen.has(keyValue)) {
      seen.add(keyValue)
      result.push(item)
    }
  }

  return result
}
