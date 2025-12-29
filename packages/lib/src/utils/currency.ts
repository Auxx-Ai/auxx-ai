// packages/lib/src/utils/currency.ts

import type { CurrencyOptions } from '@auxx/services/custom-fields'

/** Currency display options (uses CurrencyOptions with all fields optional for formatting) */
export type CurrencyDisplayOptions = Partial<CurrencyOptions>

/**
 * Format cents to currency display string
 * @param cents - Value in cents (integer)
 * @param options - Currency display options
 * @returns Formatted currency string
 */
export function formatCurrency(
  cents: number | null | undefined,
  options: CurrencyDisplayOptions = {}
): string {
  if (cents === null || cents === undefined) return '-'

  const {
    currencyCode = 'USD',
    decimalPlaces = 'two-places',
    displayType = 'symbol',
    groups = 'default',
  } = options

  // Convert cents to dollars
  const dollars = cents / 100

  // Build Intl.NumberFormat options
  const formatOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: decimalPlaces === 'no-decimal' ? 0 : 2,
    maximumFractionDigits: decimalPlaces === 'no-decimal' ? 0 : 2,
    useGrouping: groups === 'default',
    currencyDisplay: displayType === 'symbol' ? 'symbol' : displayType === 'code' ? 'code' : 'name',
  }

  try {
    return new Intl.NumberFormat('en-US', formatOptions).format(dollars)
  } catch {
    // Fallback for unsupported currencies
    return `${currencyCode} ${dollars.toFixed(decimalPlaces === 'no-decimal' ? 0 : 2)}`
  }
}

/**
 * Parse display value to cents
 * @param value - Display value (string or number)
 * @returns Value in cents (integer)
 */
export function parseToCents(value: string | number): number | null {
  if (typeof value === 'number') {
    // If already a number, check if it looks like cents or dollars
    if (Number.isInteger(value) && Math.abs(value) > 100) {
      // Likely already in cents
      return value
    }
    // Convert dollars to cents
    return Math.round(value * 100)
  }

  if (typeof value === 'string') {
    // Remove currency symbols, commas, spaces
    const cleaned = value.replace(/[$€£¥₹₩,\s]/g, '').trim()
    if (!cleaned) return null

    const parsed = parseFloat(cleaned)
    if (isNaN(parsed)) return null

    // Convert to cents
    return Math.round(parsed * 100)
  }

  return null
}

/**
 * Convert cents to dollars for input display
 * @param cents - Value in cents
 * @returns Value in dollars (decimal)
 */
export function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2)
}
