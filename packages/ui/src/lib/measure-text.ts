// packages/ui/src/lib/measure-text.ts

/** Cached canvas context for text measurement */
let cachedContext: CanvasRenderingContext2D | null = null

/**
 * Gets or creates a cached canvas context for text measurement
 */
function getCanvasContext(): CanvasRenderingContext2D | null {
  if (cachedContext) return cachedContext
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  cachedContext = canvas.getContext('2d')
  return cachedContext
}

/**
 * Measures the width of text using canvas measureText
 * @param text - The text to measure
 * @param font - CSS font string (e.g., "14px Inter, sans-serif")
 * @returns Width in pixels, or 0 if measurement fails
 */
export function measureTextWidth(text: string, font: string): number {
  const ctx = getCanvasContext()
  if (!ctx) return 0

  ctx.font = font
  return ctx.measureText(text).width
}

/**
 * Measures widths of multiple text strings efficiently
 * @param texts - Array of text strings to measure
 * @param font - CSS font string
 * @returns Array of widths in pixels
 */
export function measureTextWidths(texts: string[], font: string): number[] {
  const ctx = getCanvasContext()
  if (!ctx) return texts.map(() => 0)

  ctx.font = font
  return texts.map((text) => ctx.measureText(text).width)
}

/**
 * Truncates text to fit within a maximum width, adding ellipsis if needed
 * @param text - The text to truncate
 * @param maxWidth - Maximum width in pixels
 * @param font - CSS font string
 * @returns Truncated text with ellipsis if needed
 */
export function truncateText(text: string, maxWidth: number, font: string): string {
  const ctx = getCanvasContext()
  if (!ctx) return text

  ctx.font = font
  const textWidth = ctx.measureText(text).width

  if (textWidth <= maxWidth) return text

  const ellipsis = '…'
  const ellipsisWidth = ctx.measureText(ellipsis).width

  if (maxWidth <= ellipsisWidth) return ellipsis

  // Binary search for optimal truncation point
  let low = 0
  let high = text.length

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const truncated = text.slice(0, mid) + ellipsis
    const width = ctx.measureText(truncated).width

    if (width <= maxWidth) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return low > 0 ? text.slice(0, low) + ellipsis : ellipsis
}
