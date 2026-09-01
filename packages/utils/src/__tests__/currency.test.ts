// packages/utils/src/__tests__/currency.test.ts

import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatCurrencyCompact,
  fractionalMinorPlaces,
  isAtPrecision,
  minorToMajorString,
  minorUnitExponent,
  parseMajorToMinor,
  roundMinor,
} from '../currency'

describe('formatCurrencyCompact', () => {
  it('drops cents on small values', () => {
    expect(formatCurrencyCompact(36000)).toBe('$360')
    expect(formatCurrencyCompact(36050)).toBe('$360.5')
  })

  it('compacts thousands / millions', () => {
    expect(formatCurrencyCompact(1_200_000)).toBe('$12K')
    expect(formatCurrencyCompact(1_234_500)).toBe('$12.3K')
    expect(formatCurrencyCompact(230_000_000_000)).toBe('$2.3B')
    expect(formatCurrencyCompact(230_000_000)).toBe('$2.3M')
  })

  it('honors the currency code', () => {
    expect(formatCurrencyCompact(1_200_000, { currencyCode: 'EUR' })).toBe('€12K')
  })

  it('handles negatives and nullish values', () => {
    expect(formatCurrencyCompact(-1_200_000)).toBe('-$12K')
    expect(formatCurrencyCompact(null)).toBe('-')
    expect(formatCurrencyCompact(undefined)).toBe('-')
  })

  it("stays shorter than formatCurrency's two-decimal compact display mode", () => {
    // The existing field display mode keeps `.00`; the axis variant must not.
    expect(formatCurrency(1_200_000, { currencyDisplay: 'compact' })).toBe('$12.00K')
    expect(formatCurrencyCompact(1_200_000)).toBe('$12K')
  })
})

describe('minorUnitExponent', () => {
  it('derives the ISO 4217 exponent from the code', () => {
    expect(minorUnitExponent('USD')).toBe(2)
    expect(minorUnitExponent('EUR')).toBe(2)
    expect(minorUnitExponent('JPY')).toBe(0)
    expect(minorUnitExponent('KWD')).toBe(3)
  })

  it('is case-insensitive and falls back to 2 for junk', () => {
    expect(minorUnitExponent('usd')).toBe(2)
    expect(minorUnitExponent('ZZZ')).toBe(2)
    expect(minorUnitExponent(null)).toBe(2)
  })
})

describe('formatCurrency scale follows the code', () => {
  it('is unchanged for exponent-2 currencies', () => {
    expect(formatCurrency(2000, { currencyCode: 'USD' })).toBe('$20.00')
    expect(formatCurrency(3229, { currencyCode: 'USD' })).toBe('$32.29')
  })

  it('does not divide a zero-exponent currency by 100', () => {
    // 100000 minor units of JPY is ¥100,000 — not ¥1,000.00
    expect(formatCurrency(100_000, { currencyCode: 'JPY' })).toBe('¥100,000')
  })

  it('uses thousandths for a three-exponent currency', () => {
    expect(formatCurrency(1234, { currencyCode: 'KWD' })).toContain('1.234')
  })
})

describe('parseMajorToMinor / minorToMajorString', () => {
  it('round-trips through the code exponent', () => {
    expect(parseMajorToMinor('19.99', 'USD')).toBe(1999)
    expect(parseMajorToMinor('1000', 'JPY')).toBe(1000)
    expect(parseMajorToMinor('1.234', 'KWD')).toBe(1234)
    expect(minorToMajorString(1999, 'USD')).toBe('19.99')
    expect(minorToMajorString(1000, 'JPY')).toBe('1000')
  })

  it('strips currency symbols and grouping', () => {
    expect(parseMajorToMinor('$1,234.56', 'USD')).toBe(123456)
  })

  it('returns null for junk rather than NaN', () => {
    expect(parseMajorToMinor('', 'USD')).toBeNull()
    expect(parseMajorToMinor('abc', 'USD')).toBeNull()
    expect(parseMajorToMinor(null, 'USD')).toBeNull()
  })
})

describe('parseMajorToMinor honours decimals with the exponent floor', () => {
  it('decimals never removes precision below the exponent (USD)', () => {
    // decimals: 0 on a two-exponent currency is still a display choice on
    // parse: the floor is max(decimals, exponent), so this still parses to
    // whole cents, not whole dollars.
    expect(parseMajorToMinor('10.99', 'USD', 0)).toBe(1099)
    expect(parseMajorToMinor('10.99', 'USD', 2)).toBe(1099)
  })

  it('decimals: 5 keeps the fractional cent a rate field needs', () => {
    expect(parseMajorToMinor('0.01594', 'USD', 5)).toBeCloseTo(1.594, 6)
  })

  it('decimals: 2 rounds the same sub-cent price back to whole cents', () => {
    expect(parseMajorToMinor('0.01594', 'USD', 2)).toBe(2)
  })

  it('decimals: 0 on a zero-exponent currency (JPY) is a no-op floor', () => {
    expect(parseMajorToMinor('1000', 'JPY', 0)).toBe(1000)
  })

  it('decimals: 5 on JPY admits fractional yen', () => {
    expect(parseMajorToMinor('15.935', 'JPY', 5)).toBeCloseTo(15.935, 6)
  })
})

describe('formatCurrency splits minimum (exponent) from maximum (decimals)', () => {
  it('renders a whole-cent value with only its exponent digits, even at decimals: 5', () => {
    expect(formatCurrency(1650, { decimals: 5 })).toBe('$16.50')
  })

  it('renders the extra digits only when the value needs them', () => {
    expect(formatCurrency(1650.63, { decimals: 5 })).toBe('$16.5063')
  })

  it('renders a fractional-cent rate at full precision', () => {
    expect(formatCurrency(1.594, { decimals: 5 })).toBe('$0.01594')
  })

  it('decimals: 0 still pins both min and max, as before', () => {
    expect(formatCurrency(1099, { decimals: 0 })).toBe('$11')
  })
})

describe('minorToMajorString at field precision', () => {
  it('renders full stored precision for a fractional-cent rate', () => {
    expect(minorToMajorString(1.594, 'USD', 5)).toBe('0.01594')
  })

  it('trims trailing zeros past the exponent for a whole-cent value', () => {
    expect(minorToMajorString(1650, 'USD', 5)).toBe('16.50')
  })

  it('trims trailing zeros on a fractional JPY rate', () => {
    expect(minorToMajorString(1.5, 'JPY', 5)).toBe('1.5')
  })
})

describe('roundMinor', () => {
  it('rounds to whole minor units with no decimals declared', () => {
    expect(roundMinor(1.6)).toBe(2)
  })

  it('keeps fractional cents at RATE_DECIMALS', () => {
    expect(roundMinor(1.5939, 5, 'USD')).toBeCloseTo(1.594, 6)
  })

  it('preserves sign on negative values', () => {
    expect(roundMinor(-1.5939, 5, 'USD')).toBeCloseTo(-1.594, 6)
    expect(roundMinor(-1.6)).toBe(-2)
  })
})

describe('isAtPrecision', () => {
  it('accepts a value exactly at the field precision', () => {
    expect(isAtPrecision(1.594, 5, 'USD')).toBe(true)
  })

  it('refuses a value one digit past the field precision', () => {
    expect(isAtPrecision(1.5941, 5, 'USD')).toBe(false)
  })

  it('holds for negative values too', () => {
    expect(isAtPrecision(-1.594, 5, 'USD')).toBe(true)
    expect(isAtPrecision(-1.5941, 5, 'USD')).toBe(false)
  })

  it('refuses a fraction when no decimals are declared', () => {
    expect(isAtPrecision(1.5)).toBe(false)
    expect(isAtPrecision(2)).toBe(true)
  })

  it('rejects NaN outright', () => {
    expect(isAtPrecision(Number.NaN, 5, 'USD')).toBe(false)
  })
})

describe('fractionalMinorPlaces', () => {
  it('is 0 when decimals is unset, null, or NaN', () => {
    expect(fractionalMinorPlaces(undefined, 'USD')).toBe(0)
    expect(fractionalMinorPlaces(null, 'USD')).toBe(0)
    expect(fractionalMinorPlaces(Number.NaN, 'USD')).toBe(0)
  })

  it('never goes negative when decimals is below the exponent', () => {
    expect(fractionalMinorPlaces(0, 'USD')).toBe(0)
    expect(fractionalMinorPlaces(-3, 'USD')).toBe(0)
  })

  it('is decimals minus the exponent once above it', () => {
    expect(fractionalMinorPlaces(5, 'USD')).toBe(3)
    expect(fractionalMinorPlaces(5, 'JPY')).toBe(5)
  })
})
