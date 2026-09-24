// packages/lib/src/conditions/date-range.ts

/** The stored value of a `between` condition: absolute instants, `from` inclusive, `to` exclusive. */
export interface DateRangeValue {
  from?: string
  to?: string
}

/** A parsed `between` value. At least one end is set, and `from < to` when both are. */
export interface ParsedDateRange {
  from?: Date
  to?: Date
}

function parseEnd(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Parse a `between` value. `null` when neither end is set, an end does not parse, or the
 * range is empty — every consumer treats `null` like an unparseable `before` value.
 */
export function parseDateRange(value: unknown): ParsedDateRange | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const from = parseEnd(raw.from)
  const to = parseEnd(raw.to)
  if (from === null || to === null) return null
  if (!from && !to) return null
  if (from && to && from.getTime() >= to.getTime()) return null
  return { from, to }
}

/** Whether `date` falls inside a parsed range (half-open). */
export function isInDateRange(date: Date, range: ParsedDateRange): boolean {
  const t = date.getTime()
  if (range.from && t < range.from.getTime()) return false
  if (range.to && t >= range.to.getTime()) return false
  return true
}
