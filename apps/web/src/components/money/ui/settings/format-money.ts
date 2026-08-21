// apps/web/src/components/money/ui/settings/format-money.ts

import { formatCurrency } from '@auxx/utils/currency'

/**
 * Format a CURRENCY field value (stored in MINOR UNITS, see `use-catalog-items.ts`)
 * for display using the org's currency code (`organization.currency` setting).
 *
 * Scale and fraction digits come from the code via `@auxx/utils`, so a
 * zero-exponent currency renders `¥1,000` rather than `¥10.00`.
 */
export function formatMoney(minorUnits: number | null | undefined, currencyCode: string): string {
  if (minorUnits === null || minorUnits === undefined) return '—'
  return formatCurrency(minorUnits, { currencyCode })
}
