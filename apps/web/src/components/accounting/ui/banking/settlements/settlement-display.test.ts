// apps/web/src/components/accounting/ui/banking/settlements/settlement-display.test.ts
import { describe, expect, it } from 'vitest'
import { settlementDepositTotals, settlementDisplay } from './settlement-display'

const legacy = { depositedMinor: 0, currency: 'USD', status: 'in_transit' }
const source = {
  ...legacy,
  sourceSummary: { amountMinor: '142301', currency: 'USD', currencyExponent: 2, status: 'paid' },
}
describe('settlement display', () => {
  it('displays reported amount and status over structural accounting defaults', () => {
    expect(settlementDisplay(source)).toEqual(source.sourceSummary)
  })
  it('preserves missing amounts instead of falling back to zero', () => {
    expect(
      settlementDisplay({
        ...source,
        sourceSummary: { ...source.sourceSummary, amountMinor: null },
      }).amountMinor
    ).toBeNull()
  })
  it('sums exact amounts and keeps currencies separate', () => {
    expect(
      settlementDepositTotals([
        source,
        { ...source, sourceSummary: { ...source.sourceSummary, amountMinor: '9007199254740993' } },
        {
          ...source,
          sourceSummary: {
            ...source.sourceSummary,
            amountMinor: '500',
            currency: 'JPY',
            currencyExponent: 0,
          },
        },
        { ...source, sourceSummary: { ...source.sourceSummary, status: 'failed' } },
      ])
    ).toEqual([
      { amountMinor: '9007199254883294', currency: 'USD', currencyExponent: 2 },
      { amountMinor: '500', currency: 'JPY', currencyExponent: 0 },
    ])
  })
  it('keeps existing posted payouts readable', () => {
    expect(settlementDisplay({ ...legacy, depositedMinor: 9700, status: 'paid' })).toEqual({
      amountMinor: '9700',
      currency: 'USD',
      currencyExponent: 2,
      status: 'paid',
    })
  })
  it('does not invent a zero total when paid source amounts are unknown', () => {
    expect(
      settlementDepositTotals([
        { ...source, sourceSummary: { ...source.sourceSummary, amountMinor: null } },
      ])
    ).toEqual([])
  })
})
