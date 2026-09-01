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
 * Major-unit decimal places a RATE field carries: a price per one of something
 * (a supplier price, a part cost, a standard cost, a line's unit price).
 *
 * Five, because any price quoted in whole cents per thousand needs five
 * (`$15.94 / 1,000 = $0.01594`), and fastener, label and packaging vendors
 * quote exactly that way. Four reproduces such an order to within dollars and
 * still misstates half its lines. AMOUNT fields (totals, balances, an extended
 * cost, a GL line) never carry more than the currency's exponent: a rate times
 * a quantity is rounded to whole minor units at that boundary, and nowhere
 * else.
 */
export const RATE_DECIMALS = 5

/**
 * Number of fractional MINOR-unit places a field admits: `decimals` beyond the
 * currency's exponent, never below it. USD at `decimals: 5` -> 3 (a value such
 * as `1.594` cents); USD at `decimals: 2`, `0`, or unset -> 0 (whole cents).
 *
 * The floor is deliberate: `decimals` may add precision, never remove it, so a
 * field set to "No decimals" stays a display choice and `$10.99` still parses
 * to `1099`.
 */
export function fractionalMinorPlaces(
  decimals: number | null | undefined,
  currencyCode: string | null | undefined = 'USD'
): number {
  const exponent = minorUnitExponent(currencyCode)
  if (decimals === null || decimals === undefined || !Number.isFinite(decimals)) return 0
  return Math.max(0, Math.floor(decimals) - exponent)
}

/**
 * Round a minor-unit amount to what a field of the given `decimals` can hold.
 * With `decimals` unset (or at the exponent) this is `Math.round`: whole minor
 * units, the rule for every AMOUNT. With `RATE_DECIMALS` on USD it keeps three
 * fractional cents: `1.5939 -> 1.594`.
 *
 * Scales, rounds, and divides back, so the result is the nearest representable
 * double for that many places and round-trips through `toFixed`.
 */
export function roundMinor(
  minorUnits: number,
  decimals?: number | null,
  currencyCode: string | null | undefined = 'USD'
): number {
  const places = fractionalMinorPlaces(decimals, currencyCode)
  if (places === 0) return Math.round(minorUnits)
  const scale = 10 ** places
  return Math.round(minorUnits * scale) / scale
}

/**
 * Whether a minor-unit amount is exactly representable at the field's
 * precision. `isAtPrecision(1.594, 5)` is true; `isAtPrecision(1.5941, 5)` and
 * `isAtPrecision(1.594)` are false.
 *
 * 🛑 Never `Number.isInteger(value * scale)`: `1.594 * 1000` is not `1594` in a
 * double. Compares against the rounded value with a tolerance instead.
 */
export function isAtPrecision(
  minorUnits: number,
  decimals?: number | null,
  currencyCode: string | null | undefined = 'USD'
): boolean {
  if (!Number.isFinite(minorUnits)) return false
  const places = fractionalMinorPlaces(decimals, currencyCode)
  if (places === 0) return Number.isInteger(minorUnits)
  const scale = 10 ** places
  const scaled = minorUnits * scale
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

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
 * Format a COUNT OF MINOR UNITS as a currency string.
 *
 * `minorUnits` is cents for USD/EUR, whole yen for JPY, thousandths of a dinar
 * for KWD — never a decimal major-unit amount. $32.29 is `3229`, never `32.29`.
 * The scale comes from `currencyCode` via {@link minorUnitExponent}. A RATE
 * field may hold a fractional minor unit (`1.594` cents); see `RATE_DECIMALS`.
 *
 * Fraction digits: **minimum is the currency's exponent, maximum is
 * `decimals`** when `decimals` exceeds the exponent. So a five-place field
 * renders `1650` as `$16.50` and `1650.63` as `$16.5063` - raising a field's
 * precision is invisible until a value needs the digits. A `decimals` at or
 * below the exponent pins both (the pre-existing behaviour: "No decimals" on
 * USD renders `$11`).
 *
 * @param minorUnits - Value in minor units
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
  const minimumFractionDigits = Math.min(decimals, exponent)
  const maximumFractionDigits = Math.max(decimals, minimumFractionDigits)
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
        minimumFractionDigits,
        maximumFractionDigits,
      }
    : {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits,
        maximumFractionDigits,
        useGrouping,
        currencyDisplay,
      }

  try {
    return new Intl.NumberFormat('en-US', formatOptions).format(major)
  } catch {
    return isCompact
      ? `${currencyCode} ${major.toFixed(0)}`
      : `${currencyCode} ${major.toFixed(maximumFractionDigits)}`
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
 * `decimals` is the field's declared precision (see `RATE_DECIMALS`): the
 * result is rounded to `max(decimals, exponent)` major-unit places, so a
 * five-place USD field turns `'0.01594'` into `1.594` and a two-place (or
 * unset) one turns it into `2`. The rounding is the caller's responsibility to
 * have declared; this never guesses.
 *
 * @example parseMajorToMinor('19.99', 'USD') // 1999
 * @example parseMajorToMinor('1000', 'JPY')  // 1000  (exponent 0)
 * @example parseMajorToMinor('0.01594', 'USD', 5) // 1.594
 */
export function parseMajorToMinor(
  value: string | number | null | undefined,
  currencyCode = 'USD',
  decimals?: number | null
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
  return roundMinor(major * 10 ** minorUnitExponent(currencyCode), decimals, currencyCode)
}

/**
 * Render minor units as a plain major-unit decimal string - no symbol, no
 * grouping. For text inputs and copy-to-clipboard, where a formatted string
 * would not round-trip.
 *
 * With `decimals` above the exponent, trailing zeros beyond the exponent are
 * dropped so a focused input shows `16.50` for `1650` and `0.01594` for
 * `1.594` - the full stored precision, never a display-rounded string that a
 * blur would commit back.
 *
 * @example minorToMajorString(1999, 'USD') // '19.99'
 * @example minorToMajorString(1000, 'JPY') // '1000'
 * @example minorToMajorString(1.594, 'USD', 5) // '0.01594'
 * @example minorToMajorString(1650, 'USD', 5) // '16.50'
 */
export function minorToMajorString(
  minorUnits: number | null | undefined,
  currencyCode = 'USD',
  decimals?: number | null
): string {
  if (minorUnits === null || minorUnits === undefined) return ''
  const exponent = minorUnitExponent(currencyCode)
  const places = fractionalMinorPlaces(decimals, currencyCode)
  const major = minorUnits / 10 ** exponent
  if (places === 0) return major.toFixed(exponent)
  const full = major.toFixed(exponent + places)
  // Trim zeros past the exponent only: '16.50000' -> '16.50', '0.01594' stays.
  const keep = full.length - (exponent + places)
  let end = full.length
  while (end > keep + exponent && full[end - 1] === '0') end--
  if (full[end - 1] === '.') end--
  return full.slice(0, end)
}
