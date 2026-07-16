// apps/web/src/components/dashboard/lib/axis-width.ts
//
// Measured Y-axis width for the chart widgets. recharts 2.x never auto-sizes
// axes (its fixed 60px default clipped `$12,000.00`-style ticks), so the
// widgets measure their actual tick strings and size the axis to fit. A
// numeric axis doesn't know recharts' internal "nice" ticks up front —
// `numericTickLabels` bounds the widest one from the data extent (0, min, max
// and the significant-digit ceilings the tick generator rounds up to).

const FALLBACK_CHAR_WIDTH = 7
const TICK_FONT_SIZE = 12

let measureContext: CanvasRenderingContext2D | null | undefined
let tickFont: string | undefined

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  return measureContext
}

/** Pixel width of `text` in the chart tick font. SSR / canvas-less → per-char estimate. */
export function measureTickWidth(text: string): number {
  const ctx = getMeasureContext()
  if (!ctx) return text.length * FALLBACK_CHAR_WIDTH
  tickFont ??= `${TICK_FONT_SIZE}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`
  ctx.font = tickFont
  return ctx.measureText(text).width
}

/** Ceiling to `digits` significant digits (sign-preserving): 11800 → 12000 (2), 20000 (1). */
export function ceilToSignificant(value: number, digits: number): number {
  if (value === 0 || !Number.isFinite(value)) return 0
  const abs = Math.abs(value)
  const factor = 10 ** (Math.floor(Math.log10(abs)) - digits + 1)
  return Math.sign(value) * Math.ceil(abs / factor) * factor
}

/**
 * Candidate tick labels for a numeric axis over `[min, max]` — a superset that
 * bounds the widest label recharts' nice-tick generator will actually render.
 */
export function numericTickLabels(
  min: number,
  max: number,
  format: (n: number) => string
): string[] {
  const candidates = new Set<number>([0])
  for (const v of [min, max]) {
    if (!Number.isFinite(v) || v === 0) continue
    candidates.add(v)
    candidates.add(ceilToSignificant(v, 1))
    candidates.add(ceilToSignificant(v, 2))
  }
  return [...candidates].map(format)
}

/** Axis width that fits `labels`: widest label + tick margin + padding, clamped. */
export function axisWidthFor(
  labels: string[],
  { tickMargin = 8, minWidth = 32, maxWidth = 140 } = {}
): number {
  let widest = 0
  for (const label of labels) widest = Math.max(widest, measureTickWidth(label))
  return Math.round(Math.min(maxWidth, Math.max(minWidth, widest + tickMargin + 4)))
}
