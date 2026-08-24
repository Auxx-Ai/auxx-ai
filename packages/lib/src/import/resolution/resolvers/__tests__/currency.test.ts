// packages/lib/src/import/resolution/resolvers/__tests__/currency.test.ts

import { describe, expect, it } from 'vitest'
import type { ResolutionConfig } from '../../../types/resolution'
import { parseCurrencyMajorToMinor, resolveCurrencyMajor } from '../currency'

const usd: ResolutionConfig = { currencyCode: 'USD' }
const jpy: ResolutionConfig = { currencyCode: 'JPY' }
const kwd: ResolutionConfig = { currencyCode: 'KWD' }

/** The resolved minor-unit integer, or a marker so a failure reads clearly. */
function minor(raw: string, config: ResolutionConfig = usd): number | string | null | undefined {
  const result = resolveCurrencyMajor(raw, config)
  return result.type === 'error' ? `ERROR: ${result.error}` : (result.value as number | null)
}

describe('resolveCurrencyMajor — the bug this exists to fix', () => {
  it('imports a cell with cents instead of throwing at write time', () => {
    // `number:decimal` resolved this to 12.34, which `field-value-helpers`
    // rejects: "CURRENCY values are integer minor units".
    expect(minor('12.34')).toBe(1234)
  })

  it('reads a whole number as whole DOLLARS, not as 12 cents', () => {
    // `number:integer` on the same cell stored 12 — twelve cents.
    expect(minor('12')).toBe(1200)
  })
})

describe('resolveCurrencyMajor — cents and whole numbers', () => {
  it.each([
    ['12.34', 1234],
    ['0.99', 99],
    ['0', 0],
    ['12.00', 1200],
    ['12.3', 1230],
    ['.50', 50],
    ['  12.34  ', 1234],
    ['$12.34', 1234],
    ['12.34 USD', 1234],
    ['USD 12.34', 1234],
    ['$ 12.34', 1234],
  ])('%s → %i', (raw, expected) => {
    expect(minor(raw)).toBe(expected)
  })

  it('scales by shifting the digit string, never by float multiplication', () => {
    // `major * 10 ** exponent` is where a cent goes missing: 8.29 * 100 is
    // 828.9999999999999 and 1234567.89 * 100 is 123456788.99999999.
    expect(minor('8.29')).toBe(829)
    expect(minor('1234567.89')).toBe(123456789)
    expect(minor('0.07')).toBe(7)
    expect(minor('4.35')).toBe(435)
  })

  it('accepts excess decimals only when they are lossless zeros', () => {
    expect(minor('12.3400')).toBe(1234)
    expect(minor('12.3456')).toMatch(/more decimals than USD supports/)
  })
})

describe('resolveCurrencyMajor — thousands separators, both conventions', () => {
  it.each([
    ['1,234.56', 123456],
    ['1.234,56', 123456],
    ['1 234,56', 123456],
    ["1'234.56", 123456],
    ['1,234,567.89', 123456789],
    ['1.234.567,89', 123456789],
    ['1.234.567', 123456700],
    ['1,234,567', 123456700],
  ])('%s → %i', (raw, expected) => {
    expect(minor(raw)).toBe(expected)
  })

  it('reads a lone COMMA group of three as grouping — the decimal reading needs 3 places USD lacks', () => {
    expect(minor('1,234')).toBe(123400)
    expect(minor('1,234,567')).toBe(123456700)
  })

  it('refuses a lone DOT group of three — "." is the en-US decimal point, so 1.234 may be a unit cost', () => {
    // Calling this grouping would turn a $1.234 unit cost into $1,234.00.
    expect(minor('1.234')).toMatch(/Ambiguous currency amount/)
    expect(minor('12.345')).toMatch(/Ambiguous currency amount/)
    // Two dots can only be grouping, so that stays readable.
    expect(minor('1.234.567')).toBe(123456700)
    // And the column setting settles it either way.
    expect(minor('1.234', { currencyCode: 'USD', numberDecimalSeparator: ',' })).toBe(123400)
  })

  it('honours an explicit column decimal separator over the convention', () => {
    expect(minor('1,234', { currencyCode: 'USD', numberDecimalSeparator: ',' })).toMatch(
      /more decimals than USD supports/
    )
    expect(minor('1,23', { currencyCode: 'USD', numberDecimalSeparator: ',' })).toBe(123)
  })

  it('rejects malformed grouping rather than silently dropping the separator', () => {
    expect(minor('1,23,4')).toMatch(/malformed thousands grouping/)
    expect(minor('12,3456.78')).toMatch(/malformed thousands grouping/)
  })
})

describe('resolveCurrencyMajor — zero-decimal and three-decimal currencies', () => {
  it('treats JPY as whole units, never cents', () => {
    expect(minor('1000', jpy)).toBe(1000)
    expect(minor('1,000', jpy)).toBe(1000)
    expect(minor('1000.00', jpy)).toBe(1000)
    expect(minor('¥1,234,567', jpy)).toBe(1234567)
  })

  it('rejects a JPY amount that claims sub-yen precision', () => {
    expect(minor('1000.50', jpy)).toMatch(/more decimals than JPY supports \(0\)/)
  })

  it('scales KWD by 1000, not 100', () => {
    expect(minor('12.34', kwd)).toBe(12340)
    expect(minor('12', kwd)).toBe(12000)
    expect(minor('1,234.567', kwd)).toBe(1234567)
    expect(minor('12.345', { currencyCode: 'KWD', numberDecimalSeparator: '.' })).toBe(12345)
  })

  it('refuses a lone group of three for KWD, where both readings are valid', () => {
    // 1.234 KWD is 1234 fils; read as grouping it is 1,234 dinar = 1234000 fils.
    expect(minor('1,234', kwd)).toMatch(/Ambiguous currency amount/)
    expect(minor('1.234', kwd)).toMatch(/Ambiguous currency amount/)
  })
})

describe('resolveCurrencyMajor — negatives', () => {
  it.each([
    ['-12.34', -1234],
    ['- 12.34', -1234],
    ['-$12.34', -1234],
    ['$-12.34', -1234],
    ['12.34-', -1234],
    ['(12.34)', -1234],
    ['(1,234.56)', -123456],
    ['+12.34', 1234],
  ])('%s → %i', (raw, expected) => {
    expect(minor(raw)).toBe(expected)
  })

  it('never produces negative zero', () => {
    expect(Object.is(minor('-0.00'), 0)).toBe(true)
  })

  it('rejects two signs', () => {
    expect(minor('(-12.34)')).toMatch(/two signs/)
  })
})

describe('resolveCurrencyMajor — rejection of garbage', () => {
  it('returns null for a blank cell, matching the number resolvers', () => {
    expect(resolveCurrencyMajor('', usd)).toEqual({ type: 'value', value: null })
    expect(resolveCurrencyMajor('   ', usd)).toEqual({ type: 'value', value: null })
  })

  it.each([
    'n/a',
    'call for pricing',
    'twelve dollars',
    '12.34.56.78',
    '12.',
    '12,',
    '.',
    '--12',
    '1e6',
    '12 34 56 78 USD extra',
  ])('rejects %s', (raw) => {
    const result = resolveCurrencyMajor(raw, usd)
    expect(result.type).toBe('error')
    expect(result.error).toBeTruthy()
  })

  it('rejects a currency code that disagrees with the field', () => {
    expect(minor('12.34 EUR')).toMatch(/is in EUR, but this field stores USD/)
    expect(minor('12.34 EUR', { currencyCode: 'EUR' })).toBe(1234)
  })

  it('rejects an amount too large to hold exactly', () => {
    expect(minor('999999999999999999.99')).toMatch(/too large to store exactly/)
  })
})

describe('parseCurrencyMajorToMinor — defaults', () => {
  it('falls back to USD when no code is configured', () => {
    expect(parseCurrencyMajorToMinor('12.34')).toEqual({ ok: true, minorUnits: 1234 })
  })

  it('reports why, not just that, a cell failed', () => {
    const result = parseCurrencyMajorToMinor('12.3456', { currencyCode: 'USD' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('12.3456')
  })
})
