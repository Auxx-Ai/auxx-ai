// packages/lib/src/receiving/__tests__/client.test.ts
// Pure landed-cost math, the GL account map and the money rounding rules.
// Nothing here touches a database, the org cache or the logger.

import { describe, expect, it } from 'vitest'
import {
  computeExtendedCost,
  computeReceiptLandedBreakdown,
  computeReceiptLandedCost,
  DEFAULT_RECEIPT_GL_ACCOUNT,
  formatLandedCostSummary,
  GL_ACCOUNT_BY_PART_KIND,
  type ReceiptCostInputs,
  resolveGlAccountForPartKind,
  roundMinorUnits,
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

describe('resolveGlAccountForPartKind', () => {
  it('puts components and subassemblies in Raw Materials', () => {
    expect(resolveGlAccountForPartKind('component')).toBe('1310')
    expect(resolveGlAccountForPartKind('subassembly')).toBe('1310')
  })

  it('puts finished goods in Finished Goods', () => {
    expect(resolveGlAccountForPartKind('finished_good')).toBe('1330')
  })

  it('reads NULL as component, the conservative default', () => {
    expect(resolveGlAccountForPartKind(null)).toBe('1310')
    expect(resolveGlAccountForPartKind(undefined)).toBe('1310')
    expect(resolveGlAccountForPartKind('')).toBe('1310')
  })

  it('falls back rather than throwing on an unrecognised kind', () => {
    // A receipt is not the place to discover a fourth part kind: a movement
    // stamped 1310 is correctable, a receipt that failed to write is a pallet
    // nobody counted.
    expect(resolveGlAccountForPartKind('work_in_process')).toBe(DEFAULT_RECEIPT_GL_ACCOUNT)
  })

  it('never resolves to 1320 — receiving does not produce work in process', () => {
    expect(Object.values(GL_ACCOUNT_BY_PART_KIND)).not.toContain('1320')
  })

  it('exposes a frozen map so a caller cannot rewrite the chart of accounts', () => {
    expect(Object.isFrozen(GL_ACCOUNT_BY_PART_KIND)).toBe(true)
  })
})

describe('roundMinorUnits', () => {
  it('rounds a fractional cent to a whole one', () => {
    expect(roundMinorUnits(4442.975)).toBe(4443)
    expect(roundMinorUnits(4442.4)).toBe(4442)
  })

  it('rounds a half cent up, matching Math.round', () => {
    expect(roundMinorUnits(0.5)).toBe(1)
    expect(roundMinorUnits(1.5)).toBe(2)
  })

  it('leaves whole minor units untouched', () => {
    expect(roundMinorUnits(4400)).toBe(4400)
    expect(roundMinorUnits(0)).toBe(0)
  })
})

describe('computeExtendedCost', () => {
  it('multiplies before rounding, not after', () => {
    // Rounding the unit first and multiplying would give 10000 * 45 = 450000.
    // Multiplying first gives round(444.5 * 10000) = 4445000, a $50 difference
    // on one line against the vendor's invoice.
    expect(computeExtendedCost(444.5, 10000)).toBe(4445000)
  })

  it('is signed like the quantity so the subledger sums to the balance', () => {
    expect(computeExtendedCost(4400, 10)).toBe(44000)
    expect(computeExtendedCost(4400, -10)).toBe(-44000)
  })

  it('is zero for a zero quantity', () => {
    expect(computeExtendedCost(4400, 0)).toBe(0)
  })
})
