// packages/utils/src/__tests__/currency.test.ts

import { describe, expect, it } from 'vitest'
import { formatCurrency, formatCurrencyCompact } from '../currency'

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
