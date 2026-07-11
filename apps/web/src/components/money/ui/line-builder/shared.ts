// apps/web/src/components/money/ui/line-builder/shared.ts

// Shared formatting helpers for the line builder cluster
// (line-builder.tsx, totals-footer.tsx).

/**
 * Format an amount in the org currency; em dash for unpriced values.
 * `value` is INTEGER CENTS — the FieldType.CURRENCY storage convention
 * (same contract as the platform DisplayCurrency renderer).
 */
export function formatCurrency(value: number | null | undefined, currencyCode: string): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode,
  }).format(value / 100)
}

/** Capitalize a category value for chip display ('service' → 'Service'). */
export function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value
}
