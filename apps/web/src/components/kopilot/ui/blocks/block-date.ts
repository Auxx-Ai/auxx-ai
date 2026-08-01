// apps/web/src/components/kopilot/ui/blocks/block-date.ts

/**
 * Parses a timestamp out of block data, returning `null` when it is not a
 * usable date.
 *
 * Block props come from a *partially* streamed JSON fence, so any string field
 * can arrive as a truncated prefix (`"2026-07-31T09:1"`) for a frame or two
 * while the snapshot object is still streaming. `new Date()` yields an Invalid
 * Date for those, and date-fns then throws `RangeError: Invalid time value`,
 * which unmounts the whole message list mid-stream. Callers must render nothing
 * (or a placeholder) when this returns `null`.
 */
export function parseBlockDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
