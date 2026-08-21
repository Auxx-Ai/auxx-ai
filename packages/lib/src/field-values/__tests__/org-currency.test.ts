// packages/lib/src/field-values/__tests__/org-currency.test.ts

import { describe, expect, it } from 'vitest'
import { withOrgCurrency } from '../org-currency'

describe('withOrgCurrency', () => {
  it('layers the org code under a CURRENCY field that picked none', () => {
    expect(withOrgCurrency({ decimals: undefined }, 'CURRENCY', 'EUR')).toEqual({
      decimals: undefined,
      currencyCode: 'EUR',
    })
  })

  it('leaves a field that DID pick a code alone', () => {
    expect(withOrgCurrency({ currencyCode: 'JPY' }, 'CURRENCY', 'EUR')).toEqual({
      currencyCode: 'JPY',
    })
  })

  it('is a no-op for every other field type', () => {
    // Display paths wrap unconditionally rather than branching per call site,
    // so a NUMBER or TEXT field must come back untouched — including the same
    // absent-vs-present key set.
    const numberOptions = { decimals: 2, useGrouping: true }
    expect(withOrgCurrency(numberOptions, 'NUMBER', 'EUR')).toBe(numberOptions)
    expect(withOrgCurrency(undefined, 'TEXT', 'EUR')).toBeUndefined()
  })

  it('resolves to USD when the org code is missing or malformed', () => {
    expect(withOrgCurrency({}, 'CURRENCY', undefined)).toEqual({ currencyCode: 'USD' })
    expect(withOrgCurrency({}, 'CURRENCY', 'DOLLARS')).toEqual({ currencyCode: 'USD' })
  })

  it('never mutates the options it was handed', () => {
    // The resolved code must not leak back into `field.options` — that is what
    // would pin a field and stop it following the setting.
    const options = { decimals: 0 }
    withOrgCurrency(options, 'CURRENCY', 'EUR')
    expect(options).toEqual({ decimals: 0 })
    expect(options).not.toHaveProperty('currencyCode')
  })
})
