// packages/utils/src/currency.ts

/** Currency display options used by formatCurrency. Mirrors CurrencyFieldOptions in @auxx/lib. */
export interface CurrencyDisplayOptions {
  /** ISO 4217 currency code (default 'USD') */
  currencyCode?: string
  /** Number of decimal places to render (default: the code's minor-unit exponent) */
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

const exponentCache = new Map<string, number>()

/**
 * ISO 4217 minor-unit exponent for a currency code — the power of ten between a
 * minor unit and the major unit. USD/EUR → 2 (cents), JPY/CLP → 0 (the minor
 * unit IS the yen/peso), KWD/BHD → 3 (thousandths of a dinar).
 *
 * Derived from `Intl`, never stored: a persisted copy is a second source of
 * truth that can disagree with the formatter sitting next to it. Falls back to
 * 2 for an unrecognised code, matching the platform's historical assumption.
 */
export function minorUnitExponent(currencyCode: string | null | undefined): number {
  const code = (currencyCode || 'USD').toUpperCase()
  const cached = exponentCache.get(code)
  if (cached !== undefined) return cached

  let exponent = 2
  try {
    exponent =
      new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2
  } catch {
    exponent = 2
  }
  exponentCache.set(code, exponent)
  return exponent
}

/**
 * Format an INTEGER COUNT OF MINOR UNITS as a currency string.
 *
 * `minorUnits` is cents for USD/EUR, whole yen for JPY, thousandths of a dinar
 * for KWD — never a decimal major-unit amount. $32.29 is `3229`, never `32.29`.
 * The scale comes from `currencyCode` via {@link minorUnitExponent}.
 *
 * @param minorUnits - Value in minor units (integer)
 * @param options - Currency display options
 * @returns Formatted currency string
 */
export function formatCurrency(
  minorUnits: number | null | undefined,
  options: CurrencyDisplayOptions = {}
): string {
  if (minorUnits === null || minorUnits === undefined) return '-'

  const { currencyCode = 'USD', useGrouping = true, currencyDisplay = 'symbol' } = options

  const exponent = minorUnitExponent(currencyCode)
  const decimals = options.decimals ?? exponent
  const major = minorUnits / 10 ** exponent
  const isCompact = currencyDisplay === 'compact'

  const formatOptions: Intl.NumberFormatOptions = isCompact
    ? {
        style: 'currency',
        currency: currencyCode,
        notation: 'compact',
        compactDisplay: 'short',
        // Intl rejects 'compact' for currencyDisplay; symbol is the natural pick
        currencyDisplay: 'symbol',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
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
    return new Intl.NumberFormat('en-US', formatOptions).format(major)
  } catch {
    return isCompact
      ? `${currencyCode} ${major.toFixed(0)}`
      : `${currencyCode} ${major.toFixed(decimals)}`
  }
}

/**
 * Compact currency for space-constrained surfaces (chart axes, badges), from
 * minor units: 36000 → "$360", 1200000 → "$12K", 230000000 → "$2.3M". Unlike
 * `formatCurrency`'s `'compact'` display mode (which keeps the code's full
 * decimals, e.g. `$12.00K`), this clamps to at most one fraction digit.
 */
export function formatCurrencyCompact(
  minorUnits: number | null | undefined,
  options: Pick<CurrencyDisplayOptions, 'currencyCode'> = {}
): string {
  if (minorUnits === null || minorUnits === undefined) return '-'
  const { currencyCode = 'USD' } = options
  const major = minorUnits / 10 ** minorUnitExponent(currencyCode)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      notation: 'compact',
      compactDisplay: 'short',
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(major)
  } catch {
    return `${currencyCode} ${major.toFixed(0)}`
  }
}

/**
 * Parse a MAJOR-unit amount (what a human types, or what a provider returns as
 * a decimal string like Shopify's `"49.99"`) into integer minor units.
 *
 * Deliberately explicit about the input unit. Its predecessor `parseToCents`
 * guessed — `Number.isInteger(v) && Math.abs(v) > 100 ? v : v * 100` — which is
 * the undecidable dollars-vs-cents guess that produced 100×-wrong stored data.
 * If you do not know the unit of your input, you cannot call this.
 *
 * @example parseMajorToMinor('19.99', 'USD') // 1999
 * @example parseMajorToMinor('1000', 'JPY')  // 1000  (exponent 0)
 */
export function parseMajorToMinor(
  value: string | number | null | undefined,
  currencyCode = 'USD'
): number | null {
  if (value === null || value === undefined) return null

  let major: number
  if (typeof value === 'number') {
    major = value
  } else {
    const cleaned = value
      .replace(/[^0-9.,-]/g, '')
      .replace(/,/g, '')
      .trim()
    if (!cleaned) return null
    major = Number.parseFloat(cleaned)
  }

  if (Number.isNaN(major)) return null
  return Math.round(major * 10 ** minorUnitExponent(currencyCode))
}

/**
 * Render integer minor units as a plain major-unit decimal string — no symbol,
 * no grouping. For text inputs and copy-to-clipboard, where a formatted string
 * would not round-trip.
 *
 * @example minorToMajorString(1999, 'USD') // '19.99'
 * @example minorToMajorString(1000, 'JPY') // '1000'
 */
export function minorToMajorString(
  minorUnits: number | null | undefined,
  currencyCode = 'USD'
): string {
  if (minorUnits === null || minorUnits === undefined) return ''
  const exponent = minorUnitExponent(currencyCode)
  return (minorUnits / 10 ** exponent).toFixed(exponent)
}
