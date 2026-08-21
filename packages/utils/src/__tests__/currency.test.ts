// packages/utils/src/__tests__/currency.test.ts

import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatCurrencyCompact,
  minorToMajorString,
  minorUnitExponent,
  parseMajorToMinor,
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
