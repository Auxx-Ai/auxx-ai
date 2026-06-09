export const parseBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true
  if (['false', '0', 'no', 'n'].includes(normalized)) return false
  return undefined
}

/**
 * Coerce a value to a comparable number. Numbers pass through; ISO date strings
 * become epoch milliseconds (so timestamp comparisons work), then plain numeric
 * strings are parsed. Returns `null` when the value is not comparably numeric.
 */
export function toNumeric(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string') {
    // Try a date first (so `gt` over timestamps works), then a plain number.
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
    const n = Number(v)
    if (v.trim() !== '' && !Number.isNaN(n)) return n
  }
  return null
}
