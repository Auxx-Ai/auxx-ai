// packages/utils/src/rounding.ts

/** Absorbs float noise, so 0.3 at a multiple of 0.1 stays 0.3 instead of becoming 0.4. */
const EPSILON = 1e-9

/** Round `q` up to the next multiple of `n`; `q` unchanged when `n` is ≤ 0 or not finite. */
export function ceilToMultiple(q: number, n: number): number {
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(q)) return q
  const steps = Math.ceil(q / n - EPSILON)
  return Number((steps * n).toPrecision(12))
}
