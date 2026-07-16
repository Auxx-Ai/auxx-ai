// packages/utils/src/number.ts

/**
 * Compact human-readable number for space-constrained surfaces (chart axes,
 * badges, stat chips): 950 → "950", 1200 → "1.2K", 2300000 → "2.3M".
 * Values below 1,000 render as-is with up to `maximumFractionDigits` decimals.
 */
export function formatNumberCompact(
  value: number | null | undefined,
  maximumFractionDigits = 1
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits,
  }).format(value)
}
