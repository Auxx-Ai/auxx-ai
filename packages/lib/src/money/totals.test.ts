// packages/lib/src/money/totals.test.ts

import { describe, expect, it } from 'vitest'
import { computeDocumentTotals, computeLineTotal, roundCents } from './totals'
import type { LineForTotals } from './types'

// All amounts are integer cents (the FieldType.CURRENCY storage convention) —
// e.g. 10_000 = $100.00. Percent inputs (percent discounts, taxRate) are plain
// percentages.

describe('roundCents', () => {
  it('rounds half up, correcting for float representation error', () => {
    expect(roundCents(100.5)).toBe(101)
    expect(roundCents(267.5)).toBe(268)
    expect(roundCents(1000.4999999999999)).toBe(1000)
  })

  it('leaves whole cents untouched', () => {
    expect(roundCents(1000)).toBe(1000)
    expect(roundCents(999)).toBe(999)
  })
})

describe('computeLineTotal', () => {
  it('multiplies qty * unitPrice and rounds to a whole cent', () => {
    expect(computeLineTotal(3, 1000)).toBe(3000)
    // fractional qty producing a fractional cent: 1.5 * 333 = 499.5 → 500
    expect(computeLineTotal(1.5, 333)).toBe(500)
  })

  it('returns null when unitPrice is null (line not yet priced)', () => {
    expect(computeLineTotal(2, null)).toBeNull()
  })
})

describe('computeDocumentTotals', () => {
  it('sums line totals with no billing inputs', () => {
    const lines: LineForTotals[] = [
      { lineTotal: 1000, taxable: true },
      { lineTotal: 2000, taxable: true },
    ]
    expect(computeDocumentTotals(lines, {})).toEqual({
      subtotal: 3000,
      discountAmount: 0,
      taxTotal: 0,
      total: 3000,
    })
  })

  it('excludes null lineTotals (unpriced lines) from the sum', () => {
    const lines: LineForTotals[] = [
      { lineTotal: 1000, taxable: true },
      { lineTotal: null, taxable: true },
      { lineTotal: 500, taxable: true },
    ]
    expect(computeDocumentTotals(lines, {}).subtotal).toBe(1500)
  })

  it('returns all-zero totals for an empty line set', () => {
    expect(computeDocumentTotals([], {})).toEqual({
      subtotal: 0,
      discountAmount: 0,
      taxTotal: 0,
      total: 0,
    })
  })

  it('applies a percent discount off the subtotal', () => {
    const lines: LineForTotals[] = [{ lineTotal: 10_000, taxable: true }]
    const result = computeDocumentTotals(lines, { discountType: 'percent', discountValue: 10 })
    expect(result.discountAmount).toBe(1000)
    expect(result.total).toBe(9000)
  })

  it('applies a flat-amount discount (cents)', () => {
    const lines: LineForTotals[] = [{ lineTotal: 10_000, taxable: true }]
    const result = computeDocumentTotals(lines, { discountType: 'amount', discountValue: 1500 })
    expect(result.discountAmount).toBe(1500)
    expect(result.total).toBe(8500)
  })

  it('clamps a flat-amount discount to the subtotal (cannot go negative)', () => {
    const lines: LineForTotals[] = [{ lineTotal: 10_000, taxable: true }]
    const result = computeDocumentTotals(lines, { discountType: 'amount', discountValue: 25_000 })
    expect(result.discountAmount).toBe(10_000)
    expect(result.total).toBe(0)
  })

  it('clamps a percent discount over 100% to the subtotal', () => {
    const lines: LineForTotals[] = [{ lineTotal: 10_000, taxable: true }]
    const result = computeDocumentTotals(lines, { discountType: 'percent', discountValue: 150 })
    expect(result.discountAmount).toBe(10_000)
    expect(result.total).toBe(0)
  })

  it('applies flat tax when all lines are taxable and there is no discount', () => {
    const lines: LineForTotals[] = [{ lineTotal: 10_000, taxable: true }]
    const result = computeDocumentTotals(lines, { taxRate: 10 })
    expect(result.taxTotal).toBe(1000)
    expect(result.total).toBe(11_000)
  })

  it('excludes non-taxable lines from the tax base', () => {
    const lines: LineForTotals[] = [
      { lineTotal: 10_000, taxable: true },
      { lineTotal: 10_000, taxable: false },
    ]
    const result = computeDocumentTotals(lines, { taxRate: 10 })
    // subtotal 20000, taxable subtotal 10000, no discount -> taxBase = 10000
    expect(result.taxTotal).toBe(1000)
    expect(result.total).toBe(21_000)
  })

  it('pro-rates the discount across taxable and non-taxable lines before taxing', () => {
    // subtotal 20000 (10000 taxable + 10000 non-taxable), 50% discount -> discountAmount 10000
    // taxBase = taxableSubtotal * (1 - discountAmount/subtotal) = 10000 * (1 - 10000/20000) = 5000
    // taxTotal = 5000 * 10% = 500; total = 20000 - 10000 + 500 = 10500
    const lines: LineForTotals[] = [
      { lineTotal: 10_000, taxable: true },
      { lineTotal: 10_000, taxable: false },
    ]
    const result = computeDocumentTotals(lines, {
      discountType: 'percent',
      discountValue: 50,
      taxRate: 10,
    })
    expect(result.subtotal).toBe(20_000)
    expect(result.discountAmount).toBe(10_000)
    expect(result.taxTotal).toBe(500)
    expect(result.total).toBe(10_500)
  })

  it('rounds a fractional-cent tax to a whole cent', () => {
    // 3333 cents * 7.25% = 241.6425 -> 242
    const lines: LineForTotals[] = [{ lineTotal: 3333, taxable: true }]
    const result = computeDocumentTotals(lines, { taxRate: 7.25 })
    expect(result.taxTotal).toBe(242)
    expect(result.total).toBe(3575)
  })

  it('treats a missing discountType as no discount even if discountValue is set', () => {
    const lines: LineForTotals[] = [{ lineTotal: 10_000, taxable: true }]
    const result = computeDocumentTotals(lines, { discountValue: 1000 })
    expect(result.discountAmount).toBe(0)
  })
})
