// packages/lib/src/field-values/__tests__/currency-converter.test.ts

import type { NumberFieldValue } from '@auxx/types/field-value'
import { describe, expect, it } from 'vitest'
import {
  currencyConverter,
  normalizeCurrencyCode,
  readCurrency,
  resolveCurrencyCode,
} from '../converters/currency'

function typed(value: number): NumberFieldValue {
  return { type: 'number', value } as NumberFieldValue
}

describe('currencyConverter.toRawValue', () => {
  it('returns a BARE NUMBER of minor units, unscaled', () => {
    expect(currencyConverter.toRawValue(typed(3229))).toBe(3229)
  })

  it('passes a bare number straight through', () => {
    expect(currencyConverter.toRawValue(2000)).toBe(2000)
  })

  it('is SYMMETRIC with what the input commits', () => {
    // Load-bearing, not cosmetic. When the read shape was `{ code?, amount }`
    // and the write shape a bare number, `hasValueChanged` compared "20000"
    // against "[object Object]" and reported a change on every blur — so an
    // untouched field committed forever and never converged. It also turned
    // every `=== null`, `> 0` and `+` downstream into a silent wrong answer.
    const raw = currencyConverter.toRawValue(typed(20_000))
    expect(typeof raw).toBe('number')
    expect(currencyConverter.toTypedInput(raw)).toEqual({ type: 'number', value: 20_000 })
  })

  it('returns null rather than NaN for an unreadable value', () => {
    expect(currencyConverter.toRawValue(null)).toBeNull()
    expect(currencyConverter.toRawValue({ nope: 1 })).toBeNull()
  })
})

describe('currencyConverter.toTypedInput', () => {
  it('accepts a bare number', () => {
    expect(currencyConverter.toTypedInput(10_000)).toEqual({ type: 'number', value: 10_000 })
  })

  it('accepts a numeric string without rescaling it', () => {
    expect(currencyConverter.toTypedInput('2000')).toEqual({ type: 'number', value: 2000 })
  })

  it('IGNORES a currency code on the input — a value never carries one', () => {
    // The denomination is the field's. A per-row code would let one column mix
    // exponents inside a single SUM, sort and range filter, silently.
    expect(currencyConverter.toTypedInput({ amount: 3229, currency: 'eur' })).toEqual({
      type: 'number',
      value: 3229,
    })
    expect(currencyConverter.toTypedInput({ code: 'JPY', amount: 500 })).toEqual({
      type: 'number',
      value: 500,
    })
  })

  it('NEVER converts units — 600 stays 600, whatever it might have meant', () => {
    // 600 could be $6.00 or $600 and the converter cannot know. Guessing is what
    // produced 100x-wrong stored data.
    expect(currencyConverter.toTypedInput(600)).toEqual({ type: 'number', value: 600 })
  })

  it('round-trips its own toRawValue output', () => {
    const raw = currencyConverter.toRawValue(typed(3229))
    expect(currencyConverter.toTypedInput(raw)).toEqual({ type: 'number', value: 3229 })
  })
})

describe('currencyConverter.toDisplayValue', () => {
  it('renders minor units without the historical 100x inflation', () => {
    // The bug: toDisplayValue used to do Math.round(num * 100) before handing
    // the value to formatCurrency, which divides by 100 — so 2000 rendered as
    // $2,000.00 in every CSV, PDF and persisted display column.
    expect(currencyConverter.toDisplayValue(typed(2000), { currencyCode: 'USD' })).toBe('$20.00')
  })

  it("takes the code from the FIELD's options", () => {
    const out = currencyConverter.toDisplayValue(typed(2000), { currencyCode: 'EUR' })
    expect(out).toContain('20.00')
    expect(out).not.toContain('$')
  })

  it('derives fraction digits from the code when the field pins none', () => {
    expect(currencyConverter.toDisplayValue(typed(100_000), { currencyCode: 'JPY' })).toBe(
      '¥100,000'
    )
  })

  it('falls back to USD for a malformed field code rather than throwing', () => {
    expect(currencyConverter.toDisplayValue(typed(2000), { currencyCode: 'DOLLARS' })).toBe(
      '$20.00'
    )
  })
})

describe('readCurrency', () => {
  it('narrows the shapes that actually reach a render site', () => {
    expect(readCurrency(2000)).toBe(2000)
    expect(readCurrency('2000')).toBe(2000)
    expect(readCurrency({ amount: 2000 })).toBe(2000)
  })

  it('returns null — an empty cell — rather than NaN', () => {
    for (const bad of [null, undefined, '', 'abc', {}, { amount: 'x' }, Number.NaN]) {
      expect(readCurrency(bad)).toBeNull()
    }
  })
})

describe('normalizeCurrencyCode', () => {
  it('uppercases and validates ISO 4217 shape', () => {
    expect(normalizeCurrencyCode('usd')).toBe('USD')
    expect(normalizeCurrencyCode(' eur ')).toBe('EUR')
  })

  it('rejects anything that is not three letters', () => {
    for (const bad of ['US', 'USDD', 'US1', '', 'DOLLARS', 42, null, undefined, {}]) {
      expect(normalizeCurrencyCode(bad)).toBeNull()
    }
  })
})

/**
 * The org rung: field → org → USD.
 *
 * `organization.currency` already resolves to 'USD' for every org without a
 * settings row (`getAllUserSettings` seeds each catalog key from its
 * `defaultValue`), so this rung is a no-op until someone changes the setting —
 * and then it has to move every field that never picked a code, and no others.
 */
describe('resolveCurrencyCode', () => {
  it('prefers the FIELD code over the org', () => {
    expect(resolveCurrencyCode('EUR', 'JPY')).toBe('EUR')
  })

  it('falls back to the ORG code when the field asserted none', () => {
    // This is the case that makes the setting worth having: the ~213 fields
    // that never picked a code follow the org and move with it.
    expect(resolveCurrencyCode(undefined, 'JPY')).toBe('JPY')
    expect(resolveCurrencyCode(null, 'EUR')).toBe('EUR')
  })

  it('falls back to USD when neither asserts one', () => {
    expect(resolveCurrencyCode(undefined, undefined)).toBe('USD')
  })

  it('normalizes case and whitespace at either rung', () => {
    expect(resolveCurrencyCode('  eur ', undefined)).toBe('EUR')
    expect(resolveCurrencyCode(undefined, 'jpy')).toBe('JPY')
  })

  it('falls THROUGH a malformed code rather than blanking the cell', () => {
    // A bad setting must not take out every money cell in the org.
    expect(resolveCurrencyCode('DOLLARS', 'EUR')).toBe('EUR')
    expect(resolveCurrencyCode(undefined, 'DOLLARS')).toBe('USD')
  })
})
