// packages/ui/src/components/input-number-utils.ts

/**
 * Clamp a value between min and max bounds
 */
export function clampValue(
  value: number | undefined,
  min?: number,
  max?: number
): number | undefined {
  if (value === undefined) return undefined
  let clamped = value
  if (min !== undefined && clamped < min) clamped = min
  if (max !== undefined && clamped > max) clamped = max
  return clamped
}

/**
 * Increment a value by step, respecting max constraint
 */
export function incrementValue(current: number | undefined, step: number, max?: number): number {
  const newValue = (current ?? 0) + step
  return clampValue(newValue, undefined, max) ?? newValue
}

/**
 * Decrement a value by step, respecting min constraint
 */
export function decrementValue(current: number | undefined, step: number, min?: number): number {
  const newValue = (current ?? 0) - step
  return clampValue(newValue, min, undefined) ?? newValue
}

/**
 * Format a number using Intl.NumberFormat
 */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale = 'en-US'
): string {
  return new Intl.NumberFormat(locale, options).format(value)
}
