// packages/lib/src/utils/pick-defined.ts

/**
 * Pick only defined (not undefined) properties from an object.
 * Preserves null values for explicit field clearing.
 *
 * Key behaviors:
 * - `undefined` = field not included in update (skip it)
 * - `null` = explicitly set field to null (include it)
 * - any value = set field to that value (include it)
 *
 * @example
 * // Complete a task
 * pickDefined({ completedAt: new Date(), completedById: userId })
 *
 * @example
 * // Reopen a task (set fields to null)
 * pickDefined({ completedAt: null, completedById: null })
 *
 * @example
 * // Mixed update - only defined fields are included
 * pickDefined({ title: 'New title', description: undefined, priority: 'high' })
 * // Returns: { title: 'New title', priority: 'high' }
 */
export function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined)) as Partial<T>
}

/**
 * Check if an object has any defined (non-undefined) properties.
 * Useful for validating that at least one field is being updated.
 */
export function hasDefinedProps(obj: Record<string, unknown>): boolean {
  return Object.values(obj).some((v) => v !== undefined)
}
