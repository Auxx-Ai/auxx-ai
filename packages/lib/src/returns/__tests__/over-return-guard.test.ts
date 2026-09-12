// packages/lib/src/returns/__tests__/over-return-guard.test.ts

/**
 * `returns/over-return-guard.ts` - plan section 3.5's ceiling.
 *
 * Plain arithmetic over plain arrays, so nothing is stubbed. Two cases carry
 * the weight: the **edit** path, where a row must not count its own prior
 * quantity against itself, and the **negative quantity**, which passes every
 * ceiling comparison and would then restock parts for units that never left.
 *
 * The ceiling is an input throughout. These tests pass sold quantities today
 * and will pass shipped quantities when task 55 lands, with no change here.
 */

import { describe, expect, it } from 'vitest'
import {
  checkOverReturn,
  type ReturnedQuantityClaim,
  remainingReturnableQuantity,
  sumReturnedQuantity,
} from '../over-return-guard'

const LINE = 'line_item_1'

function claims(...pairs: [string, number][]): ReturnedQuantityClaim[] {
  return pairs.map(([returnLineId, quantity]) => ({ returnLineId, quantity }))
}

function check(args: {
  ceiling: number
  existing?: ReturnedQuantityClaim[]
  quantity: number
  returnLineId?: string | null
}) {
  return checkOverReturn({
    lineItemId: LINE,
    ceiling: args.ceiling,
    existing: args.existing ?? [],
    candidate: { returnLineId: args.returnLineId, quantity: args.quantity },
  })
}

describe('sumReturnedQuantity', () => {
  it('is zero for no claims', () => {
    expect(sumReturnedQuantity([])).toBe(0)
  })

  it('sums every claim', () => {
    expect(sumReturnedQuantity(claims(['a', 1], ['b', 2], ['c', 3]))).toBe(6)
  })

  it('excludes one row by id, for the edit path', () => {
    expect(sumReturnedQuantity(claims(['a', 1], ['b', 2]), 'b')).toBe(1)
  })

  it('ignores an exclusion id that is not present', () => {
    expect(sumReturnedQuantity(claims(['a', 1]), 'zz')).toBe(1)
  })
})

describe('remainingReturnableQuantity', () => {
  it('is the ceiling when nothing has come back', () => {
    expect(remainingReturnableQuantity({ lineItemId: LINE, ceiling: 5, existing: [] })).toBe(5)
  })

  it('subtracts what is already claimed', () => {
    expect(
      remainingReturnableQuantity({ lineItemId: LINE, ceiling: 5, existing: claims(['a', 2]) })
    ).toBe(3)
  })

  it('excludes the row being edited', () => {
    expect(
      remainingReturnableQuantity({
        lineItemId: LINE,
        ceiling: 5,
        existing: claims(['a', 2]),
        candidate: { returnLineId: 'a' },
      })
    ).toBe(5)
  })

  it('never goes negative on an already over-returned line', () => {
    expect(
      remainingReturnableQuantity({ lineItemId: LINE, ceiling: 2, existing: claims(['a', 5]) })
    ).toBe(0)
  })
})

describe('checkOverReturn', () => {
  it('accepts a first return of the whole line', () => {
    expect(check({ ceiling: 2, quantity: 2 }).isOk()).toBe(true)
  })

  it('accepts a partial return', () => {
    expect(check({ ceiling: 2, quantity: 1 }).isOk()).toBe(true)
  })

  it('refuses more than the line ever let out', () => {
    const result = check({ ceiling: 2, quantity: 3 })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.reason).toBe('over_return')
      expect(result.error.statusCode).toBe(422)
    }
  })

  it('sums across every return pointing at the line, not just this one', () => {
    // Two lifts sold, one already returned on RMA-1, one on RMA-2, and a
    // third would be a unit that never shipped.
    expect(check({ ceiling: 2, existing: claims(['a', 1]), quantity: 1 }).isOk()).toBe(true)
    const result = check({ ceiling: 2, existing: claims(['a', 1], ['b', 1]), quantity: 1 })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        lineItemId: LINE,
        ceiling: 2,
        alreadyReturned: 2,
        requested: 1,
      })
    }
  })

  it('refuses divergent condition rows that together exceed the line', () => {
    // The grain is one row per sold line PER CONDITION, so several rows share
    // one line_item and only the sum is bounded.
    const existing = claims(['pristine', 1], ['wrecked', 1])
    expect(check({ ceiling: 3, existing, quantity: 1 }).isOk()).toBe(true)
    expect(check({ ceiling: 2, existing, quantity: 1 }).isErr()).toBe(true)
  })

  it('does not count an edited row against itself', () => {
    // Saving a row of 2 unchanged must not read as 4 against a line of 2.
    const existing = claims(['r1', 2])
    expect(check({ ceiling: 2, existing, quantity: 2, returnLineId: 'r1' }).isOk()).toBe(true)
  })

  it('still bounds an edit that raises the quantity', () => {
    const result = check({
      ceiling: 2,
      existing: claims(['r1', 2]),
      quantity: 3,
      returnLineId: 'r1',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toMatchObject({ alreadyReturned: 0, requested: 3 })
  })

  it('refuses everything against a line that shipped nothing', () => {
    // The ceiling a shipped bound produces for an unfulfilled line.
    expect(check({ ceiling: 0, quantity: 1 }).isErr()).toBe(true)
  })

  it('refuses a quantity of zero or below, which no ceiling would catch', () => {
    for (const quantity of [0, -1, -100]) {
      const result = check({ ceiling: 2, quantity })
      expect(result.isErr()).toBe(true)
      if (result.isErr()) expect(result.error.reason).toBe('invalid_return_quantity')
    }
  })

  it('refuses a non-finite quantity', () => {
    expect(check({ ceiling: 2, quantity: Number.NaN }).isErr()).toBe(true)
    expect(check({ ceiling: 2, quantity: Number.POSITIVE_INFINITY }).isErr()).toBe(true)
  })

  it('accepts a fractional quantity that fits, since a return line is a NUMBER field', () => {
    expect(check({ ceiling: 2, quantity: 0.5 }).isOk()).toBe(true)
  })

  it('never throws', () => {
    expect(() => check({ ceiling: Number.NaN, quantity: 1 })).not.toThrow()
  })
})
