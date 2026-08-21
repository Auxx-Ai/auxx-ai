// packages/lib/src/conditions/view-config-currency.test.ts

import { describe, expect, it } from 'vitest'
import { columnFormattingSchema, currencyFormattingSchema } from './view-config'

/**
 * A column formats money; it does not denominate it.
 *
 * `currencyCode` was briefly a column override, and across exponents it does not
 * relabel the amount — it RESCALES it. `formatCurrency` derives the divisor from
 * the code, so a USD field holding 20000 ($200.00) rendered through a JPY
 * override reads ¥20,000 (100x high) and through KWD reads KWD 20.000 (1000x
 * low). `decimals`, `useGrouping` and `currencyDisplay` cannot do that.
 */
describe('currencyFormattingSchema', () => {
  it('does NOT admit a currencyCode', () => {
    expect(Object.keys(currencyFormattingSchema.shape)).not.toContain('currencyCode')
  })

  it('drops a legacy stored currencyCode instead of failing to parse', () => {
    // No data migration: Zod strips undeclared keys, so configs written before
    // the reversal still load and shed the key on their next write.
    const parsed = currencyFormattingSchema.parse({
      type: 'currency',
      currencyCode: 'JPY',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'compact',
    })
    expect(parsed).not.toHaveProperty('currencyCode')
    expect(parsed).toEqual({
      type: 'currency',
      decimals: 2,
      useGrouping: true,
      currencyDisplay: 'compact',
    })
  })

  it('leaves decimals undefined so the code drives fraction digits', () => {
    // Undefined means "derive from the code" — 0 for JPY, 3 for KWD. Stamping a
    // `?? 2` anywhere in the dialog round-trip freezes a JPY column at ¥1,234.00.
    const parsed = currencyFormattingSchema.parse({ type: 'currency', useGrouping: false })
    expect(parsed.decimals).toBeUndefined()
  })

  it('still resolves through the columnFormatting union', () => {
    const parsed = columnFormattingSchema.parse({ type: 'currency', currencyCode: 'EUR' })
    expect(parsed).toEqual({ type: 'currency' })
  })
})
