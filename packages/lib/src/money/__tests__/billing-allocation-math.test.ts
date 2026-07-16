// packages/lib/src/money/__tests__/billing-allocation-math.test.ts

import { describe, expect, it } from 'vitest'
import { allocateProportionally, resolveFixedInvoiceAmount } from '../billing-allocation-math'

describe('fixed-contract allocation math', () => {
  it('allocates percentage billing over remaining source value with exact cents', () => {
    expect(
      allocateProportionally(
        [
          { sourceLineItemId: 'labor', amount: 6_000 },
          { sourceLineItemId: 'materials', amount: 4_000 },
        ],
        2_500
      )
    ).toEqual([
      { sourceLineItemId: 'labor', amount: 1_500 },
      { sourceLineItemId: 'materials', amount: 1_000 },
    ])
  })

  it('places rounding cents deterministically on the largest remaining line', () => {
    expect(
      allocateProportionally(
        [
          { sourceLineItemId: 'small', amount: 1 },
          { sourceLineItemId: 'large', amount: 2 },
        ],
        2
      )
    ).toEqual([{ sourceLineItemId: 'large', amount: 2 }])
  })

  it('rejects over-allocation', () => {
    expect(() => allocateProportionally([{ sourceLineItemId: 'line', amount: 100 }], 101)).toThrow(
      'exceeds'
    )
  })

  it('resolves percentages against the full contract and caps them at remaining value', () => {
    expect(
      resolveFixedInvoiceAmount({
        selection: { type: 'percentage', value: 25 },
        contractValue: 10_000,
        remainingValue: 10_000,
      })
    ).toBe(2_500)
    expect(() =>
      resolveFixedInvoiceAmount({
        selection: { type: 'percentage', value: 80 },
        contractValue: 10_000,
        remainingValue: 5_000,
      })
    ).toThrow('exceeds')
  })
})
