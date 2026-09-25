// packages/utils/src/stats.ts

/** Arithmetic mean; `null` for an empty list. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

/** Linear-interpolated percentile (the spreadsheet `PERCENTILE.INC` rule), `p` in 0–100; `null` for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0 || !Number.isFinite(p)) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  const low = sorted[lo] as number
  const high = sorted[hi] as number
  return low + (high - low) * (rank - lo)
}

/** The 50th percentile; `null` for an empty list. */
export function median(values: readonly number[]): number | null {
  return percentile(values, 50)
}

/** POPULATION standard deviation (divides by n): the list is the whole window, not a sample of it. */
export function stddev(values: readonly number[]): number | null {
  const m = mean(values)
  if (m === null) return null
  let sq = 0
  for (const v of values) sq += (v - m) ** 2
  return Math.sqrt(sq / values.length)
}

/** Population σ ÷ mean; `null` when empty or the mean is 0. */
export function coefficientOfVariation(values: readonly number[]): number | null {
  const m = mean(values)
  if (m === null || m === 0) return null
  return (stddev(values) as number) / m
}
