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
    if (Object.hasOwn(value, key)) {
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
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
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

/**
 * Is a value "empty": `undefined`, `null`, the empty string, or an empty array.
 *
 * The canonical predicate for omitting optional args/fields and "has the user
 * provided a value" checks. Deliberately NOT empty: `{}`, whitespace-only
 * strings, `0`, and `false` — callers that need those have different semantics
 * and should say so locally. PURE.
 */
export function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

/**
 * Shallow equality check for objects.
 * Compares top-level properties only (reference equality for nested objects).
 */
export function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (!a || !b) return a === b
  if (typeof a !== 'object' || typeof b !== 'object') return false

  const keysA = Object.keys(a)
  const keysB = Object.keys(b)

  if (keysA.length !== keysB.length) return false

  for (const key of keysA) {
    if (a[key] !== b[key]) return false
  }

  return true
}

/**
 * Order-independent structural deep equality for JSON-like values.
 *
 * - Object key order does NOT matter; array order does.
 * - `Date`s compare by timestamp.
 * - Differing `typeof`, a lone `null`, or array-vs-non-array all fail fast.
 * - Symbols (and other primitives) compare by identity via the `Object.is`
 *   short-circuit, so sentinel symbols are only ever equal to themselves.
 *
 * Does not handle circular references, `Map`/`Set`, or class instances.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null || typeof a !== 'object') return false

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }

  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr !== bArr) return false
  if (aArr && bArr) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }

  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const aKeys = Object.keys(ao)
  const bKeys = Object.keys(bo)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]))
}
