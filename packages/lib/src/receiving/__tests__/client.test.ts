// packages/lib/src/receiving/__tests__/client.test.ts
// Pure landed-cost math and the money rounding rules.
// Nothing here touches a database, the org cache or the logger.

import { roundMinorUnits } from '@auxx/utils/currency'
import { describe, expect, it } from 'vitest'
import {
  computeReceiptLandedBreakdown,
  computeReceiptLandedCost,
  formatLandedCostSummary,
  type ReceiptCostInputs,
} from '../client'

const terms = (overrides: Partial<ReceiptCostInputs> = {}): ReceiptCostInputs => ({
  unitPrice: 4000,
  shippingCost: null,
  tariffRate: null,
  otherCost: null,
  ...overrides,
})

describe('computeReceiptLandedCost', () => {
  it('sums base, freight, tariff and other costs', () => {
    expect(computeReceiptLandedCost(terms({ shippingCost: 500, tariffRate: 10, otherCost: 100 })))
      // 4000 + 500 + 400 + 100
      .toBe(5000)
  })

  it('is the bare unit price when the supplier row carries no adders', () => {
    expect(computeReceiptLandedCost(terms())).toBe(4000)
  })

  it('treats absent adders as zero, not as missing', () => {
    expect(computeReceiptLandedCost({ unitPrice: 4000 })).toBe(4000)
  })

  it('returns null for an unpriced supplier row rather than zero', () => {
    // The distinction the whole zero-cost guard rests on: an unpriced row is a
    // row that cannot value a receipt, not a free part.
    expect(computeReceiptLandedCost(terms({ unitPrice: null }))).toBeNull()
  })

  it('does NOT round the tariff term', () => {
    // 4133 at 7.5% is 309.975, so the exact total carries a fractional cent.
    // This is why the write path must round, and why it must round once.
    expect(computeReceiptLandedCost(terms({ unitPrice: 4133, tariffRate: 7.5 }))).toBeCloseTo(
      4442.975,
      6
    )
  })
})

describe('computeReceiptLandedBreakdown', () => {
  it('names the raw supplier price `base` and the shipping cost `freight`', () => {
    const parts = computeReceiptLandedBreakdown(
      terms({ unitPrice: 4400, shippingCost: 120, tariffRate: 4.3 })
    )
    expect(parts).toEqual({
      base: 4400,
      freight: 120,
      tariff: 189, // round(4400 * 0.043) = round(189.2)
      tariffRate: 4.3,
      other: 0,
      landed: 4709,
    })
  })

  it('always has parts that sum exactly to its own total', () => {
    const cases: ReceiptCostInputs[] = [
      { unitPrice: 4133, shippingCost: 77, tariffRate: 7.5, otherCost: 13 },
      { unitPrice: 1, shippingCost: 0, tariffRate: 33.333, otherCost: 0 },
      { unitPrice: 99999, shippingCost: 1, tariffRate: 0.001, otherCost: 5 },
      { unitPrice: 0, shippingCost: 250, tariffRate: 10, otherCost: 0 },
    ]
    for (const input of cases) {
      const parts = computeReceiptLandedBreakdown(input)!
      expect(parts.base + parts.freight + parts.tariff + parts.other).toBe(parts.landed)
    }
  })

  it('lands on the same whole minor unit as rounding the exact total', () => {
    const input = terms({ unitPrice: 4133, shippingCost: 77, tariffRate: 7.5, otherCost: 13 })
    expect(computeReceiptLandedBreakdown(input)!.landed).toBe(
      Math.round(computeReceiptLandedCost(input)!)
    )
  })

  it('returns null for an unpriced row, matching computeReceiptLandedCost', () => {
    expect(computeReceiptLandedBreakdown(terms({ unitPrice: null }))).toBeNull()
  })
})

describe('formatLandedCostSummary', () => {
  it('renders the breakdown the Receive form shows under the price input', () => {
    const parts = computeReceiptLandedBreakdown(
      terms({ unitPrice: 4400, shippingCost: 120, tariffRate: 4.3 })
    )!
    expect(formatLandedCostSummary(parts)).toBe(
      '$47.09 = $44.00 + $1.20 freight + $1.89 tariff (4.3%)'
    )
  })

  it('omits zero terms instead of printing $0.00', () => {
    const parts = computeReceiptLandedBreakdown(terms({ unitPrice: 4400, shippingCost: 120 }))!
    expect(formatLandedCostSummary(parts)).toBe('$45.20 = $44.00 + $1.20 freight')
  })

  it('renders a bare total when nothing is capitalised onto the price', () => {
    const parts = computeReceiptLandedBreakdown(terms({ unitPrice: 4400 }))!
    expect(formatLandedCostSummary(parts)).toBe('$44.00')
  })

  it('includes an `other` term when the supplier row carries one', () => {
    const parts = computeReceiptLandedBreakdown(terms({ unitPrice: 4400, otherCost: 190 }))!
    expect(formatLandedCostSummary(parts)).toBe('$45.90 = $44.00 + $1.90 other')
  })

  it('groups thousands and pads cents', () => {
    const parts = computeReceiptLandedBreakdown({ unitPrice: 123456789, shippingCost: 5 })!
    expect(formatLandedCostSummary(parts)).toBe('$1,234,567.94 = $1,234,567.89 + $0.05 freight')
  })

  it('accepts a caller-supplied formatter for non-USD orgs', () => {
    const parts = computeReceiptLandedBreakdown(terms({ unitPrice: 4400, shippingCost: 120 }))!
    expect(formatLandedCostSummary(parts, (n) => `${n}c`)).toBe('4520c = 4400c + 120c freight')
  })
})

describe('roundMinorUnits - a RATE keeps five places, it does not round to a whole cent', () => {
  it('keeps a fractional cent that is already within RATE_DECIMALS', () => {
    expect(roundMinorUnits(4442.975)).toBe(4442.975)
    expect(roundMinorUnits(4442.4)).toBe(4442.4)
  })

  it('rounds a value beyond RATE_DECIMALS down to five places, still not to a whole cent', () => {
    expect(roundMinorUnits(4442.9754)).toBe(4442.975)
    expect(roundMinorUnits(0.0005)).toBe(0.001)
  })

  it('leaves whole minor units untouched', () => {
    expect(roundMinorUnits(4400)).toBe(4400)
    expect(roundMinorUnits(0)).toBe(0)
  })
})
