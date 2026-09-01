// packages/lib/src/import/resolution/resolvers/__tests__/number.test.ts

import { describe, expect, it } from 'vitest'
import type { ResolutionConfig } from '../../../types/resolution'
import { resolveDecimal, resolveInteger } from '../number'

const none: ResolutionConfig = {}
const comma: ResolutionConfig = { numberDecimalSeparator: ',' }

/** The resolved number, or a marker so a failure reads clearly. */
function read(
  resolve: typeof resolveInteger,
  raw: string,
  config: ResolutionConfig = none
): number | string | null | undefined {
  const result = resolve(raw, config)
  return result.type === 'error' ? `ERROR: ${result.error}` : (result.value as number | null)
}

describe('resolveInteger — the truncation this exists to stop', () => {
  it('refuses a fraction instead of dropping it', () => {
    // `parseInt('7.5')` is 7: a 7.5% tariff rate imported as 7%, silently.
    expect(read(resolveInteger, '7.5')).toMatch(/not a whole number/)
  })

  it('refuses a fractional minor unit on a raw-cents column', () => {
    // A per-thousand price list exported in cents carries `1.594` for the
    // nut; `parseInt` made it 1 cent.
    expect(read(resolveInteger, '1.594')).toMatch(/not a whole number/)
  })

  it('refuses trailing text instead of reading the numeric prefix', () => {
    expect(read(resolveInteger, '12abc')).toMatch(/Invalid integer/)
  })

  it('points the user at the type that keeps the fraction', () => {
    expect(read(resolveInteger, '2.5')).toMatch(/Decimal number/)
  })
})

describe('resolveInteger — what it accepts', () => {
  it('reads a plain, signed, or grouped whole number', () => {
    expect(read(resolveInteger, '42')).toBe(42)
    expect(read(resolveInteger, '-42')).toBe(-42)
    expect(read(resolveInteger, '+42')).toBe(42)
    expect(read(resolveInteger, '1,234,567')).toBe(1234567)
    expect(read(resolveInteger, '1 234')).toBe(1234)
  })

  it('reads a blank cell as null', () => {
    expect(read(resolveInteger, '')).toBeNull()
    expect(read(resolveInteger, '   ')).toBeNull()
  })

  it('drops a trailing percent sign', () => {
    expect(read(resolveInteger, '25%')).toBe(25)
  })

  it('accepts a lossless zero fraction', () => {
    expect(read(resolveInteger, '12.0')).toBe(12)
    expect(read(resolveInteger, '12.00')).toBe(12)
    expect(read(resolveInteger, '12.10')).toMatch(/not a whole number/)
  })

  it('reads a comma decimal column by its configured separator', () => {
    expect(read(resolveInteger, '1.234', comma)).toBe(1234)
    expect(read(resolveInteger, '1,5', comma)).toMatch(/not a whole number/)
  })

  it('refuses a value too large to store exactly', () => {
    expect(read(resolveInteger, '99999999999999999999')).toMatch(/too large/)
  })
})

describe('resolveDecimal', () => {
  it('keeps the fraction', () => {
    expect(read(resolveDecimal, '7.5')).toBe(7.5)
    expect(read(resolveDecimal, '453.592')).toBe(453.592)
    expect(read(resolveDecimal, '.5')).toBe(0.5)
    expect(read(resolveDecimal, '-0.25')).toBe(-0.25)
  })

  it('reads a percent cell as its number', () => {
    // "Tariff Rate (%)" stores 7.5 for 7.5%.
    expect(read(resolveDecimal, '7.5%')).toBe(7.5)
  })

  it('strips grouping under the default separator', () => {
    expect(read(resolveDecimal, '1,234.56')).toBe(1234.56)
  })

  it('reads a comma decimal column by its configured separator', () => {
    expect(read(resolveDecimal, '1.234,56', comma)).toBe(1234.56)
    expect(read(resolveDecimal, '7,5', comma)).toBe(7.5)
  })

  it('refuses text instead of reading the numeric prefix', () => {
    // `parseFloat('12abc')` is 12.
    expect(read(resolveDecimal, '12abc')).toMatch(/Invalid number/)
    expect(read(resolveDecimal, 'abc')).toMatch(/Invalid number/)
    expect(read(resolveDecimal, '1.2.3')).toMatch(/Invalid number/)
  })

  it('reads a blank cell as null', () => {
    expect(read(resolveDecimal, '')).toBeNull()
  })
})
