// apps/web/src/components/money/ui/settings/format-money.ts

/**
 * Format a CURRENCY field value (stored in cents, see `use-catalog-items.ts`)
 * for display using the org's currency code (`organization.currency` setting).
 */
export function formatMoney(cents: number | null | undefined, currencyCode: string): string {
  if (cents === null || cents === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(cents / 100)
}
