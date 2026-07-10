// packages/lib/src/money/totals.test.ts

import { describe, expect, it } from 'vitest'
import { computeDocumentTotals, computeLineTotal, round2 } from './totals'
import type { LineForTotals } from './types'

describe('round2', () => {
  it('rounds half up, correcting for float representation error', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(2.675)).toBe(2.68)
    expect(round2(10.005)).toBe(10.01)
  })

  it('leaves already-precise values untouched', () => {
    expect(round2(10)).toBe(10)
    expect(round2(9.99)).toBe(9.99)
  })
})

describe('computeLineTotal', () => {
  it('multiplies qty * unitPrice and rounds', () => {
    expect(computeLineTotal(3, 10)).toBe(30)
    expect(computeLineTotal(2, 5.005)).toBe(10.01)
  })

  it('returns null when unitPrice is null (line not yet priced)', () => {
    expect(computeLineTotal(2, null)).toBeNull()
  })
})

describe('computeDocumentTotals', () => {
  it('sums line totals with no billing inputs', () => {
    const lines: LineForTotals[] = [
      { lineTotal: 10, taxable: true },
      { lineTotal: 20, taxable: true },
    ]
    expect(computeDocumentTotals(lines, {})).toEqual({
      subtotal: 30,
      discountAmount: 0,
      taxTotal: 0,
      total: 30,
    })
  })

  it('excludes null lineTotals (unpriced lines) from the sum', () => {
    const lines: LineForTotals[] = [
      { lineTotal: 10, taxable: true },
      { lineTotal: null, taxable: true },
      { lineTotal: 5, taxable: true },
    ]
    expect(computeDocumentTotals(lines, {}).subtotal).toBe(15)
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
    const lines: LineForTotals[] = [{ lineTotal: 100, taxable: true }]
    const result = computeDocumentTotals(lines, { discountType: 'percent', discountValue: 10 })
    expect(result.discountAmount).toBe(10)
    expect(result.total).toBe(90)
  })

  it('applies a flat-amount discount', () => {
    const lines: LineForTotals[] = [{ lineTotal: 100, taxable: true }]
    const result = computeDocumentTotals(lines, { discountType: 'amount', discountValue: 15 })
    expect(result.discountAmount).toBe(15)
    expect(result.total).toBe(85)
  })

  it('clamps a flat-amount discount to the subtotal (cannot go negative)', () => {
    const lines: LineForTotals[] = [{ lineTotal: 100, taxable: true }]
    const result = computeDocumentTotals(lines, { discountType: 'amount', discountValue: 250 })
    expect(result.discountAmount).toBe(100)
    expect(result.total).toBe(0)
  })

  it('clamps a percent discount over 100% to the subtotal', () => {
    const lines: LineForTotals[] = [{ lineTotal: 100, taxable: true }]
    const result = computeDocumentTotals(lines, { discountType: 'percent', discountValue: 150 })
    expect(result.discountAmount).toBe(100)
    expect(result.total).toBe(0)
  })

  it('applies flat tax when all lines are taxable and there is no discount', () => {
    const lines: LineForTotals[] = [{ lineTotal: 100, taxable: true }]
    const result = computeDocumentTotals(lines, { taxRate: 10 })
    expect(result.taxTotal).toBe(10)
    expect(result.total).toBe(110)
  })

  it('excludes non-taxable lines from the tax base', () => {
    const lines: LineForTotals[] = [
      { lineTotal: 100, taxable: true },
      { lineTotal: 100, taxable: false },
    ]
    const result = computeDocumentTotals(lines, { taxRate: 10 })
    // subtotal 200, taxable subtotal 100, no discount -> taxBase = 100
    expect(result.taxTotal).toBe(10)
    expect(result.total).toBe(210)
  })

  it('pro-rates the discount across taxable and non-taxable lines before taxing', () => {
    // subtotal 200 (100 taxable + 100 non-taxable), 50% discount -> discountAmount 100
    // taxBase = taxableSubtotal * (1 - discountAmount/subtotal) = 100 * (1 - 100/200) = 50
    // taxTotal = 50 * 10% = 5; total = 200 - 100 + 5 = 105
    const lines: LineForTotals[] = [
      { lineTotal: 100, taxable: true },
      { lineTotal: 100, taxable: false },
    ]
    const result = computeDocumentTotals(lines, {
      discountType: 'percent',
      discountValue: 50,
      taxRate: 10,
    })
    expect(result.subtotal).toBe(200)
    expect(result.discountAmount).toBe(100)
    expect(result.taxTotal).toBe(5)
    expect(result.total).toBe(105)
  })

  it('treats a missing discountType as no discount even if discountValue is set', () => {
    const lines: LineForTotals[] = [{ lineTotal: 100, taxable: true }]
    const result = computeDocumentTotals(lines, { discountValue: 10 })
    expect(result.discountAmount).toBe(0)
  })
})
