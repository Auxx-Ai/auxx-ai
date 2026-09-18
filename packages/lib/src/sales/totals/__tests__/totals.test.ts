// packages/lib/src/sales/totals/__tests__/totals.test.ts

import { describe, expect, it } from 'vitest'
import type { LineForTotals } from '../../types'
import {
  allocateDiscountToLines,
  computeAllocatedDocumentTotals,
  computeDocumentTotals,
  computeLineTotal,
  roundCents,
} from '../totals'

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

describe('computeDocumentTotals — shipping (money plan 37 §6)', () => {
  it('defaults shipping to 0 when absent, matching the pre-shipping formula byte-for-byte', () => {
    const lines: LineForTotals[] = [{ lineTotal: 10_000, taxable: true }]
    const withoutShipping = computeDocumentTotals(lines, { taxRate: 10 })
    const explicitlyUndefined = computeDocumentTotals(lines, { taxRate: 10, shipping: undefined })
    expect(withoutShipping).toEqual({
      subtotal: 10_000,
      discountAmount: 0,
      taxTotal: 1000,
      total: 11_000,
    })
    expect(explicitlyUndefined).toEqual(withoutShipping)
  })

  it('defaults shipping to 0 when explicitly null', () => {
    const lines: LineForTotals[] = [{ lineTotal: 10_000, taxable: true }]
    const result = computeDocumentTotals(lines, { shipping: null })
    expect(result.total).toBe(10_000)
  })

  it('adds a stated shipping amount on top of subtotal - discount + tax', () => {
    const lines: LineForTotals[] = [{ lineTotal: 10_000, taxable: true }]
    const result = computeDocumentTotals(lines, { taxRate: 10, shipping: 500 })
    expect(result.subtotal).toBe(10_000)
    expect(result.taxTotal).toBe(1000)
    // 10000 - 0 discount + 1000 tax + 500 shipping
    expect(result.total).toBe(11_500)
  })

  it('shipping is never taxed and never discounted — it folds in after both', () => {
    const lines: LineForTotals[] = [{ lineTotal: 10_000, taxable: true }]
    const result = computeDocumentTotals(lines, {
      discountType: 'percent',
      discountValue: 50,
      taxRate: 10,
      shipping: 500,
    })
    // subtotal 10000, discount 5000, taxBase 5000, tax 500, total = 10000-5000+500+500 = 6000
    expect(result.discountAmount).toBe(5000)
    expect(result.taxTotal).toBe(500)
    expect(result.total).toBe(6000)
  })

  it('does not add a shipping key to the returned totals shape', () => {
    const result = computeDocumentTotals([], { shipping: 500 })
    expect(Object.keys(result).sort()).toEqual(['discountAmount', 'subtotal', 'taxTotal', 'total'])
    expect(result.total).toBe(500)
  })
})

describe('computeDocumentTotals — optional lines (money plan 18)', () => {
  it('excludes a deselected optional line from subtotal, taxable subtotal, and discount base', () => {
    const lines: LineForTotals[] = [
      { lineTotal: 5000, taxable: true },
      { lineTotal: 2000, taxable: true, optional: true, optionalSelected: false },
    ]
    const result = computeDocumentTotals(lines, { taxRate: 10 })
    expect(result.subtotal).toBe(5000)
    expect(result.taxTotal).toBe(500)
    expect(result.total).toBe(5500)
  })

  it('includes a selected optional line normally', () => {
    const lines: LineForTotals[] = [
      { lineTotal: 5000, taxable: true },
      { lineTotal: 2000, taxable: true, optional: true, optionalSelected: true },
    ]
    const result = computeDocumentTotals(lines, {})
    expect(result.subtotal).toBe(7000)
    expect(result.total).toBe(7000)
  })

  it('produces byte-for-byte identical output when optional/optionalSelected are absent vs explicitly undefined', () => {
    const withoutFlags: LineForTotals[] = [
      { lineTotal: 10_000, taxable: true },
      { lineTotal: 10_000, taxable: false },
    ]
    const withUndefinedFlags: LineForTotals[] = [
      { lineTotal: 10_000, taxable: true, optional: undefined, optionalSelected: undefined },
      { lineTotal: 10_000, taxable: false, optional: undefined, optionalSelected: undefined },
    ]
    const billing = { discountType: 'percent' as const, discountValue: 50, taxRate: 10 }
    expect(computeDocumentTotals(withUndefinedFlags, billing)).toEqual(
      computeDocumentTotals(withoutFlags, billing)
    )
  })

  it('matches every pre-existing (required-only) case exactly when optional is unset', () => {
    // Re-run a sample of the pre-optional-lines cases above through the same assertions —
    // proves the new exclusion filter is a strict no-op for documents with no optional flags.
    const flat: LineForTotals[] = [
      { lineTotal: 10_000, taxable: true },
      { lineTotal: 10_000, taxable: false },
    ]
    expect(
      computeDocumentTotals(flat, { discountType: 'percent', discountValue: 50, taxRate: 10 })
    ).toEqual({ subtotal: 20_000, discountAmount: 10_000, taxTotal: 500, total: 10_500 })

    const single: LineForTotals[] = [{ lineTotal: 3333, taxable: true }]
    expect(computeDocumentTotals(single, { taxRate: 7.25 })).toEqual({
      subtotal: 3333,
      discountAmount: 0,
      taxTotal: 242,
      total: 3575,
    })
  })

  it('returns all-zero totals when every line is an optional deselected line', () => {
    const lines: LineForTotals[] = [
      { lineTotal: 5000, taxable: true, optional: true, optionalSelected: false },
      { lineTotal: 2000, taxable: false, optional: true, optionalSelected: false },
    ]
    expect(computeDocumentTotals(lines, { taxRate: 10 })).toEqual({
      subtotal: 0,
      discountAmount: 0,
      taxTotal: 0,
      total: 0,
    })
  })

  it('pro-rates discount + tax across a mixed selection (required, selected option, deselected option)', () => {
    // required 10000 (taxable) + selected option 5000 (taxable) = subtotal 15000; the
    // deselected 8000 (taxable) option is excluded entirely, including from taxableSubtotal.
    // 20% discount -> discountAmount 3000. taxBase = 15000 * (1 - 3000/15000) = 12000.
    // taxTotal = 12000 * 10% = 1200. total = 15000 - 3000 + 1200 = 13200.
    const lines: LineForTotals[] = [
      { lineTotal: 10_000, taxable: true },
      { lineTotal: 5000, taxable: true, optional: true, optionalSelected: true },
      { lineTotal: 8000, taxable: true, optional: true, optionalSelected: false },
    ]
    const result = computeDocumentTotals(lines, {
      discountType: 'percent',
      discountValue: 20,
      taxRate: 10,
    })
    expect(result.subtotal).toBe(15_000)
    expect(result.discountAmount).toBe(3000)
    expect(result.taxTotal).toBe(1200)
    expect(result.total).toBe(13_200)
  })

  it('contributes normally for optional:true/optionalSelected:true and the nonsensical optional:false/optionalSelected:false combo', () => {
    const lines: LineForTotals[] = [
      { lineTotal: 5000, taxable: true, optional: true, optionalSelected: true },
      { lineTotal: 3000, taxable: true, optional: false, optionalSelected: false },
    ]
    const result = computeDocumentTotals(lines, {})
    expect(result.subtotal).toBe(8000)
    expect(result.total).toBe(8000)
  })
})

describe('allocateDiscountToLines (29 §12 item 7)', () => {
  const two: LineForTotals[] = [
    { lineTotal: 10_000, taxable: true },
    { lineTotal: 5_000, taxable: true },
  ]

  it('splits a percent discount that divides evenly, with nothing left to hand out', () => {
    const { lines, discountAmount } = allocateDiscountToLines(two, {
      discountType: 'percent',
      discountValue: 10,
    })
    expect(discountAmount).toBe(1_500)
    expect(lines.map((line) => line.lineTotal)).toEqual([9_000, 4_500])
  })

  it('hands the odd cent of a flat discount to the largest fractional share, earliest first', () => {
    // 700 x 10000/15000 = 466.67, 700 x 5000/15000 = 233.33: floors 466 + 233 leave one
    // cent, and the first line's .67 beats the second's .33.
    const { lines, discountAmount } = allocateDiscountToLines(two, {
      discountType: 'amount',
      discountValue: 700,
    })
    expect(discountAmount).toBe(700)
    expect(lines.map((line) => line.lineTotal)).toEqual([9_533, 4_767])
    expect(lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)).toBe(14_300)
  })

  it('breaks a tie on the fraction in line order', () => {
    // 1 cent over two equal lines: .5 and .5, the first line takes it.
    const equal: LineForTotals[] = [
      { lineTotal: 100, taxable: true },
      { lineTotal: 100, taxable: true },
    ]
    const { lines } = allocateDiscountToLines(equal, { discountType: 'amount', discountValue: 1 })
    expect(lines.map((line) => line.lineTotal)).toEqual([99, 100])
  })

  it('always sums to the discounted subtotal exactly, whatever the shares', () => {
    const odd: LineForTotals[] = [
      { lineTotal: 3_333, taxable: true },
      { lineTotal: 1_111, taxable: true },
      { lineTotal: 7_777, taxable: false },
      { lineTotal: 1, taxable: true },
    ]
    for (const discountValue of [1, 7, 333, 1_234, 12_221]) {
      const { lines, discountAmount } = allocateDiscountToLines(odd, {
        discountType: 'amount',
        discountValue,
      })
      expect(lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)).toBe(
        12_222 - discountAmount
      )
      for (const line of lines) expect(line.lineTotal).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns the lines untouched when there is no discount to allocate', () => {
    expect(allocateDiscountToLines(two, {}).lines).toEqual(two)
    expect(allocateDiscountToLines(two, { discountValue: 500 }).lines).toEqual(two)
    expect(
      allocateDiscountToLines(two, { discountType: 'percent', discountValue: 0 }).lines
    ).toEqual(two)
  })

  it('gives no share to an unpriced, zero or deselected line and leaves it as it was', () => {
    const mixed: LineForTotals[] = [
      { lineTotal: 10_000, taxable: true },
      { lineTotal: null, taxable: true },
      { lineTotal: 0, taxable: true },
      { lineTotal: 5_000, taxable: true, optional: true, optionalSelected: false },
    ]
    const { lines, discountAmount } = allocateDiscountToLines(mixed, {
      discountType: 'percent',
      discountValue: 10,
    })
    // The base is the 10_000 that contributes; the other three are not discounted.
    expect(discountAmount).toBe(1_000)
    expect(lines.map((line) => line.lineTotal)).toEqual([9_000, null, 0, 5_000])
  })

  it('clamps a discount over the subtotal so every contributing line nets to zero', () => {
    const { lines, discountAmount } = allocateDiscountToLines(two, {
      discountType: 'amount',
      discountValue: 99_999,
    })
    expect(discountAmount).toBe(15_000)
    expect(lines.map((line) => line.lineTotal)).toEqual([0, 0])
  })

  it('keeps the caller extra fields on every line', () => {
    const tagged = [
      { lineTotal: 10_000, taxable: true, lineInstanceId: 'a' },
      { lineTotal: 5_000, taxable: true, lineInstanceId: 'b' },
    ]
    const { lines } = allocateDiscountToLines(tagged, {
      discountType: 'percent',
      discountValue: 10,
    })
    expect(lines.map((line) => line.lineInstanceId)).toEqual(['a', 'b'])
  })
})

describe('computeAllocatedDocumentTotals (29 §12 item 7)', () => {
  const two: LineForTotals[] = [
    { lineTotal: 10_000, taxable: true },
    { lineTotal: 5_000, taxable: true },
  ]

  it('a 10% header discount on 100 and 50: lines 90 and 45, subtotal 135, total 135', () => {
    const { totals, lines } = computeAllocatedDocumentTotals(two, {
      discountType: 'percent',
      discountValue: 10,
    })
    expect(lines.map((line) => line.lineTotal)).toEqual([9_000, 4_500])
    expect(totals).toEqual({ subtotal: 13_500, discountAmount: 1_500, taxTotal: 0, total: 13_500 })
  })

  it('a flat 7 off: lines 95.33 and 47.67, subtotal 143', () => {
    const { totals, lines } = computeAllocatedDocumentTotals(two, {
      discountType: 'amount',
      discountValue: 700,
    })
    expect(lines.map((line) => line.lineTotal)).toEqual([9_533, 4_767])
    expect(totals.subtotal).toBe(14_300)
    expect(totals.discountAmount).toBe(700)
    expect(totals.total).toBe(14_300)
  })

  it('subtotal is Σ the net lines and total is subtotal + tax + shipping, with no discount left to subtract', () => {
    const { totals, lines } = computeAllocatedDocumentTotals(two, {
      discountType: 'percent',
      discountValue: 10,
      taxRate: 10,
      shipping: 500,
    })
    const sum = lines.reduce((acc, line) => acc + (line.lineTotal ?? 0), 0)
    expect(totals.subtotal).toBe(sum)
    // Tax is on the NET lines directly: 13500 x 10% = 1350.
    expect(totals.taxTotal).toBe(1_350)
    expect(totals.total).toBe(13_500 + 1_350 + 500)
  })

  it('agrees with the header formula on the total when the shares divide evenly', () => {
    const billing = {
      discountType: 'percent' as const,
      discountValue: 10,
      taxRate: 10,
      shipping: 500,
    }
    expect(computeAllocatedDocumentTotals(two, billing).totals.total).toBe(
      computeDocumentTotals(two, billing).total
    )
  })

  it('is computeDocumentTotals byte for byte when there is no discount', () => {
    const billing = { taxRate: 7.25, shipping: 250 }
    expect(computeAllocatedDocumentTotals(two, billing).totals).toEqual(
      computeDocumentTotals(two, billing)
    )
  })
})
