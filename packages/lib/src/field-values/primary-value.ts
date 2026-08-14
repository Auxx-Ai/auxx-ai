// packages/lib/src/field-values/primary-value.ts

/**
 * Maximum number of values a multi-value scalar field (`options.multi`) may hold.
 * Enforced at the write path (`validateAndConvertValue`, `addValues`) and mirrored
 * in the UI (picker hides its create row at the cap).
 */
export const MAX_MULTI_VALUES = 10

/**
 * First-is-primary unwrap for multi-value scalar fields.
 *
 * Field values on `options.multi` fields read back as arrays ordered by `sortKey`;
 * by convention the first value is the primary. Single-value fields pass through
 * unchanged. Use this everywhere a scalar consumer (sequences, compose, documents,
 * placeholders, connectors) needs one representative value.
 */
export function primaryValue<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}
