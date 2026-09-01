// apps/web/src/components/money/ui/line-builder/shared.ts

// Shared formatting helpers for the line builder cluster
// (line-builder.tsx, totals-footer.tsx).

import { formatCurrency as formatCurrencyUtil } from '@auxx/utils/currency'

/**
 * Format an amount in the org currency; em dash for unpriced values.
 *
 * `value` is INTEGER MINOR UNITS — the FieldType.CURRENCY storage convention.
 * Delegates the formatting itself to `@auxx/utils` so the minor-unit exponent
 * comes from the code (JPY 0, KWD 3) rather than a hardcoded /100. The only
 * thing this wrapper adds is the em dash: an unpriced line is not `$0.00`.
 *
 * `decimals` is the field's declared precision (see `RATE_DECIMALS`) - pass it
 * for a RATE (a unit price), omit it for an AMOUNT (a line total, a balance),
 * which never carries more than the currency's exponent. Display's
 * minimum/maximum split (`formatCurrency` in `@auxx/utils/currency`) is what
 * keeps a whole-cent rate printing `$16.50`, not `$16.50000`.
 */
export function formatCurrency(
  value: number | null | undefined,
  currencyCode: string,
  decimals?: number
): string {
  if (value === null || value === undefined) return '—'
  return formatCurrencyUtil(value, { currencyCode, decimals })
}

/** Capitalize a category value for chip display ('service' → 'Service'). */
export function titleCase(value: string): string {
  return value.length ? value.charAt(0).toUpperCase() + value.slice(1) : value
}
