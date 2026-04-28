// packages/utils/src/currency.ts

/** Currency display options used by formatCurrency. Mirrors CurrencyFieldOptions in @auxx/lib. */
export interface CurrencyDisplayOptions {
  /** ISO 4217 currency code (default 'USD') */
  currencyCode?: string
  /** Number of decimal places to render (default 2) */
  decimals?: number
  /** Whether to use thousand separators (default true) */
  useGrouping?: boolean
  /**
   * Display mode (default 'symbol'). 'symbol' | 'code' | 'name' map directly
   * to Intl's `currencyDisplay`. 'compact' renders large values as `$1.5K` /
   * `$1.5M` / `$1.5B` via Intl's `notation: 'compact'`.
   */
  currencyDisplay?: 'symbol' | 'code' | 'name' | 'compact'
}

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
    decimals = 2,
    useGrouping = true,
    currencyDisplay = 'symbol',
  } = options

  const dollars = cents / 100
  const isCompact = currencyDisplay === 'compact'

  const formatOptions: Intl.NumberFormatOptions = isCompact
    ? {
        style: 'currency',
        currency: currencyCode,
        notation: 'compact',
        compactDisplay: 'short',
        // Intl rejects 'compact' for currencyDisplay; symbol is the natural pick
        currencyDisplay: 'symbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    : {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping,
        currencyDisplay,
      }

  try {
    return new Intl.NumberFormat('en-US', formatOptions).format(dollars)
  } catch {
    return isCompact
      ? `${currencyCode} ${dollars.toFixed(0)}`
      : `${currencyCode} ${dollars.toFixed(decimals)}`
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
    if (Number.isNaN(parsed)) return null

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

/**
 * Convert price string to cents
 * @param priceString - Price as a string
 * @returns Value in cents (integer) or null
 * @example "19.99" -> 1999
 */
export const convertToCents = (priceString: string | null): number | null => {
  if (priceString === null) return null
  return Math.round(parseFloat(priceString) * 100)
}
