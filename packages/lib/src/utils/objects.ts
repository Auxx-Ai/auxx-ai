// packages/lib/src/utils/objects.ts

/**
 * Deep clones an object, handling nested objects, arrays, Date, RegExp, Map, and Set.
 * Does not handle circular references or class instances (use structuredClone for those).
 */
export function cloneDeep<T>(value: T): T {
  // Handle primitives and null/undefined
  if (value === null || typeof value !== 'object') {
    return value
  }

  // Handle Date
  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }

  // Handle RegExp
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T
  }

  // Handle Map
  if (value instanceof Map) {
    const clonedMap = new Map()
    value.forEach((v, k) => clonedMap.set(cloneDeep(k), cloneDeep(v)))
    return clonedMap as T
  }

  // Handle Set
  if (value instanceof Set) {
    const clonedSet = new Set()
    value.forEach((v) => clonedSet.add(cloneDeep(v)))
    return clonedSet as T
  }

  // Handle Array
  if (Array.isArray(value)) {
    return value.map((item) => cloneDeep(item)) as T
  }

  // Handle plain objects
  const clonedObj: Record<string, unknown> = {}
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      clonedObj[key] = cloneDeep((value as Record<string, unknown>)[key])
    }
  }
  return clonedObj as T
}

/**
 * Gets the value at a nested path in an object.
 * Path can use dot notation: 'a.b.c' or 'a.0.b' for arrays.
 */
export function getByPath<T = unknown>(obj: unknown, path: string): T | undefined {
  if (!path) return obj as T

  const keys = path.split('.')
  let result: unknown = obj

  for (const key of keys) {
    if (result === null || result === undefined) {
      return undefined
    }
    result = (result as Record<string, unknown>)[key]
  }

  return result as T
}

/**
 * Deep merges source into target, returning a new object.
 * - Objects are recursively merged
 * - Arrays are replaced (not merged)
 * - Primitives from source override target
 * - undefined values in source are ignored
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target }

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key]
    const targetVal = target[key]

    // Skip undefined values
    if (sourceVal === undefined) continue

    // Recursively merge plain objects
    if (
      sourceVal &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      ) as T[keyof T]
    } else {
      result[key] = sourceVal as T[keyof T]
    }
  }

  return result
}
