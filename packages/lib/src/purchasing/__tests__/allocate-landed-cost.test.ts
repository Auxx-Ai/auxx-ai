// packages/lib/src/purchasing/__tests__/allocate-landed-cost.test.ts

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../errors'
import {
  allocateCapitalisedCost,
  allocateLandedCost,
  capitalisableAmount,
} from '../allocate-landed-cost'
import type { AllocationHeader, AllocationLine } from '../types'

// Every amount is integer minor units (cents): 100000 = $1,000.00.

const NO_HEADER: AllocationHeader = { shipping: 0, tax: 0, discount: 0, taxRecoverable: false }

function header(partial: Partial<AllocationHeader>): AllocationHeader {
  return { ...NO_HEADER, ...partial }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

describe('capitalisableAmount', () => {
  it('capitalises shipping plus non-recoverable tax, less the header discount', () => {
    expect(capitalisableAmount(header({ shipping: 1000, tax: 500, discount: 200 }))).toBe(1300)
  })

  it('excludes tax when it is recoverable', () => {
    expect(capitalisableAmount(header({ shipping: 1000, tax: 500, taxRecoverable: true }))).toBe(
      1000
    )
  })

  it('can be negative when the discount exceeds shipping and tax', () => {
    expect(capitalisableAmount(header({ shipping: 100, discount: 400 }))).toBe(-300)
  })

  it('rejects a non-integer header amount', () => {
    expect(() => capitalisableAmount(header({ shipping: 10.5 }))).toThrow(BadRequestError)
  })
})

describe('allocateLandedCost - worked examples from the costing plan', () => {
  // plans/products/11-costing-and-stock-improvements.md section 4.1, purchase HZRA2W.
  it('lands the $1 line of a $1,000 + $1 purchase with $10,000 freight at $10.99', () => {
    const lines: AllocationLine[] = [
      { lineTotal: 100_000, quantity: 1 },
      { lineTotal: 100, quantity: 1 },
    ]
    const purchase = header({ shipping: 1_000_000 })

    // Exact share of the $1 line is 1 + 10000 x (1/1001) = $10.99001, which is
    // 1099.000999 minor units. roundCents (round-half-up) gives 1099 = $10.99.
    expect(allocateLandedCost(lines, purchase, 'value')).toEqual([1_099_001, 1099])

    // And the adders tie back to the freight invoice to the cent.
    const adders = allocateCapitalisedCost(lines, purchase, 'value')
    expect(adders).toEqual([999_001, 999])
    expect(sum(adders)).toBe(1_000_000)
  })

  // Same section, purchase 22GHGD: $100,000 + $5,000, shipping $1,000, tax $5,000.
  it('lands the $100,000 line of a $100,000 + $5,000 purchase at $105,714.29', () => {
    const lines: AllocationLine[] = [
      { lineTotal: 10_000_000, quantity: 1 },
      { lineTotal: 500_000, quantity: 1 },
    ]
    const purchase = header({ shipping: 100_000, tax: 500_000 })

    // Exact figure is $105,714.2857; 10571429 minor units after rounding.
    expect(allocateLandedCost(lines, purchase, 'value')).toEqual([10_571_429, 528_571])
    expect(sum(allocateCapitalisedCost(lines, purchase, 'value'))).toBe(600_000)
  })

  it('does not capitalise the tax of that purchase when it is recoverable', () => {
    const lines: AllocationLine[] = [
      { lineTotal: 10_000_000, quantity: 1 },
      { lineTotal: 500_000, quantity: 1 },
    ]
    const purchase = header({ shipping: 100_000, tax: 500_000, taxRecoverable: true })

    expect(sum(allocateCapitalisedCost(lines, purchase, 'value'))).toBe(100_000)
    expect(allocateLandedCost(lines, purchase, 'value')).toEqual([10_095_238, 504_762])
  })
})

describe('allocateCapitalisedCost - rounding reconciles to the header', () => {
  it('pushes the residual cent onto the heaviest line when the split is not even', () => {
    const lines: AllocationLine[] = [
      { lineTotal: 100_000, quantity: 1 },
      { lineTotal: 100_000, quantity: 1 },
      { lineTotal: 100_000, quantity: 1 },
    ]
    const adders = allocateCapitalisedCost(lines, header({ shipping: 100 }), 'value')

    // 100 / 3 = 33.33 each; three rounds give 99, and the stray cent goes to the
    // heaviest line (ties resolve to the first).
    expect(adders).toEqual([34, 33, 33])
    expect(sum(adders)).toBe(100)
    expect(allocateLandedCost(lines, header({ shipping: 100 }), 'value')).toEqual([
      100_034, 100_033, 100_033,
    ])
  })

  it('gives the residual to the largest line, not the first', () => {
    const lines: AllocationLine[] = [
      { lineTotal: 100, quantity: 1 },
      { lineTotal: 100, quantity: 1 },
      { lineTotal: 100_000, quantity: 1 },
    ]
    const adders = allocateCapitalisedCost(lines, header({ shipping: 1000 }), 'value')

    expect(adders[2] ?? 0).toBeGreaterThan(adders[0] ?? 0)
    expect(sum(adders)).toBe(1000)
  })

  it('reconciles exactly across a spread of awkward line counts and freight amounts', () => {
    for (let lineCount = 1; lineCount <= 9; lineCount++) {
      for (const shipping of [1, 7, 99, 100, 1001, 123_457]) {
        const lines: AllocationLine[] = Array.from({ length: lineCount }, (_, index) => ({
          lineTotal: 1000 + index * 37,
          quantity: 1 + index,
        }))
        const purchase = header({ shipping, tax: 13, discount: 7 })
        for (const basis of ['value', 'quantity'] as const) {
          expect(sum(allocateCapitalisedCost(lines, purchase, basis))).toBe(
            capitalisableAmount(purchase)
          )
        }
      }
    }
  })

  it('reconciles a negative capitalised amount (discount larger than freight)', () => {
    const lines: AllocationLine[] = [
      { lineTotal: 333, quantity: 1 },
      { lineTotal: 333, quantity: 1 },
      { lineTotal: 333, quantity: 1 },
    ]
    const purchase = header({ shipping: 100, discount: 200 })
    const adders = allocateCapitalisedCost(lines, purchase, 'value')

    expect(sum(adders)).toBe(-100)
  })
})

describe('allocateLandedCost - bases', () => {
  const lines: AllocationLine[] = [
    { lineTotal: 100_000, quantity: 1, weight: 1 },
    { lineTotal: 100, quantity: 9, weight: 99 },
  ]

  it('value weighting sends nearly all the freight to the expensive line', () => {
    const adders = allocateCapitalisedCost(lines, header({ shipping: 10_000 }), 'value')
    expect(adders).toEqual([9990, 10])
  })

  it('quantity weighting sends it to the line with the most units', () => {
    const adders = allocateCapitalisedCost(lines, header({ shipping: 10_000 }), 'quantity')
    expect(adders).toEqual([1000, 9000])
  })

  it('weight weighting sends it to the heavy line', () => {
    const adders = allocateCapitalisedCost(lines, header({ shipping: 10_000 }), 'weight')
    expect(adders).toEqual([100, 9900])
  })

  it('divides the landed line total by the line quantity', () => {
    // Quantity basis: line 1 takes 9000 of the freight over 9 units = 1000/unit,
    // on top of 100/9 = 11.11 of goods -> 1011 per unit after rounding.
    expect(allocateLandedCost(lines, header({ shipping: 10_000 }), 'quantity')).toEqual([
      101_000, 1011,
    ])
  })

  it('treats a missing weight as zero', () => {
    const mixed: AllocationLine[] = [
      { lineTotal: 100, quantity: 1, weight: 10 },
      { lineTotal: 100, quantity: 1 },
    ]
    expect(allocateCapitalisedCost(mixed, header({ shipping: 500 }), 'weight')).toEqual([500, 0])
  })

  it('ignores a negative line total when weighting by value', () => {
    const withCredit: AllocationLine[] = [
      { lineTotal: -100, quantity: 1 },
      { lineTotal: 100, quantity: 1 },
    ]
    expect(allocateCapitalisedCost(withCredit, header({ shipping: 500 }), 'value')).toEqual([
      0, 500,
    ])
  })
})

describe('allocateLandedCost - degenerate inputs', () => {
  it('returns an empty vector for no lines', () => {
    expect(allocateLandedCost([], header({ shipping: 10_000 }), 'value')).toEqual([])
    expect(allocateCapitalisedCost([], header({ shipping: 10_000 }), 'value')).toEqual([])
  })

  it('falls back to an equal split when no line carries a weight', () => {
    const lines: AllocationLine[] = [
      { lineTotal: 100_000, quantity: 1 },
      { lineTotal: 100, quantity: 1 },
    ]
    const adders = allocateCapitalisedCost(lines, header({ shipping: 1000 }), 'weight')

    expect(adders).toEqual([500, 500])
    expect(sum(adders)).toBe(1000)
  })

  it('falls back to an equal split when every line total is zero', () => {
    const lines: AllocationLine[] = [
      { lineTotal: 0, quantity: 1 },
      { lineTotal: 0, quantity: 2 },
      { lineTotal: 0, quantity: 3 },
    ]
    const adders = allocateCapitalisedCost(lines, header({ shipping: 100 }), 'value')

    expect(adders).toEqual([34, 33, 33])
    expect(sum(adders)).toBe(100)
  })

  it('falls back to an equal split when every weight is explicitly zero', () => {
    const lines: AllocationLine[] = [
      { lineTotal: 100, quantity: 1, weight: 0 },
      { lineTotal: 100, quantity: 1, weight: 0 },
    ]
    expect(allocateCapitalisedCost(lines, header({ shipping: 1000 }), 'weight')).toEqual([500, 500])
  })

  it('allocates nothing when the header is empty', () => {
    const lines: AllocationLine[] = [{ lineTotal: 100, quantity: 2 }]
    expect(allocateCapitalisedCost(lines, NO_HEADER, 'value')).toEqual([0])
    expect(allocateLandedCost(lines, NO_HEADER, 'value')).toEqual([50])
  })

  it('handles a single line by giving it the whole header amount', () => {
    const lines: AllocationLine[] = [{ lineTotal: 100, quantity: 4 }]
    expect(allocateCapitalisedCost(lines, header({ shipping: 1001 }), 'value')).toEqual([1001])
    // (100 + 1001) / 4 = 275.25 -> 275
    expect(allocateLandedCost(lines, header({ shipping: 1001 }), 'value')).toEqual([275])
  })
})

describe('allocateLandedCost - invalid input', () => {
  it('rejects a negative quantity', () => {
    expect(() =>
      allocateLandedCost([{ lineTotal: 100, quantity: -1 }], NO_HEADER, 'value')
    ).toThrow(BadRequestError)
  })

  it('rejects a zero quantity - there is no unit to carry a unit cost', () => {
    expect(() => allocateLandedCost([{ lineTotal: 100, quantity: 0 }], NO_HEADER, 'value')).toThrow(
      BadRequestError
    )
  })

  it('rejects a non-integer line total', () => {
    expect(() =>
      allocateLandedCost([{ lineTotal: 100.5, quantity: 1 }], NO_HEADER, 'value')
    ).toThrow(BadRequestError)
  })

  it('rejects a negative weight', () => {
    expect(() =>
      allocateLandedCost([{ lineTotal: 100, quantity: 1, weight: -1 }], NO_HEADER, 'weight')
    ).toThrow(BadRequestError)
  })

  it('rejects a non-finite quantity', () => {
    expect(() =>
      allocateLandedCost([{ lineTotal: 100, quantity: Number.NaN }], NO_HEADER, 'value')
    ).toThrow(BadRequestError)
  })

  it('rejects an unknown basis', () => {
    expect(() =>
      allocateLandedCost(
        [{ lineTotal: 100, quantity: 1 }],
        NO_HEADER,
        'cubic_volume' as unknown as 'value'
      )
    ).toThrow(BadRequestError)
  })
})
