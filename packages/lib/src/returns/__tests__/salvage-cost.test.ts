// packages/lib/src/returns/__tests__/salvage-cost.test.ts

/**
 * `returns/salvage-cost.ts` - plan section 6.4's arithmetic.
 *
 * Pure numbers in, pure numbers out, so there is nothing to stub. The cases
 * that matter are the boundaries (0, 100, 101) and the zero standard cost,
 * which is the one that gets through a guard written as `== null` and freezes
 * $0 onto a ledger nothing can restate.
 */

import { describe, expect, it } from 'vitest'
import {
  computeSalvageUnitCost,
  isUsableSalvagePercent,
  isUsableStandardCost,
} from '../salvage-cost'
import { MissingStandardCostError } from '../salvage-errors'

/** $201.00 as the minor units a `part_standard_cost` is stored in. */
const STANDARD = 20100

function unitCost(standardCost: number | null | undefined, salvagePercent: number) {
  return computeSalvageUnitCost({
    partId: 'p1',
    partName: 'Hydraulic cylinder',
    standardCost,
    salvagePercent,
  })
}

describe('isUsableStandardCost', () => {
  it('accepts a positive cost', () => {
    expect(isUsableStandardCost(1)).toBe(true)
    expect(isUsableStandardCost(0.001)).toBe(true)
  })

  it('rejects null, undefined, zero, negatives and non-finite values', () => {
    expect(isUsableStandardCost(null)).toBe(false)
    expect(isUsableStandardCost(undefined)).toBe(false)
    expect(isUsableStandardCost(0)).toBe(false)
    expect(isUsableStandardCost(-1)).toBe(false)
    expect(isUsableStandardCost(Number.NaN)).toBe(false)
    expect(isUsableStandardCost(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('isUsableSalvagePercent', () => {
  it('accepts the open-closed range (0, 100]', () => {
    expect(isUsableSalvagePercent(0.5)).toBe(true)
    expect(isUsableSalvagePercent(60)).toBe(true)
    expect(isUsableSalvagePercent(100)).toBe(true)
  })

  it('rejects 0, negatives, anything past 100, and non-finite values', () => {
    expect(isUsableSalvagePercent(0)).toBe(false)
    expect(isUsableSalvagePercent(-10)).toBe(false)
    expect(isUsableSalvagePercent(100.01)).toBe(false)
    expect(isUsableSalvagePercent(101)).toBe(false)
    expect(isUsableSalvagePercent(Number.NaN)).toBe(false)
    expect(isUsableSalvagePercent(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('computeSalvageUnitCost', () => {
  it('takes the percentage of the standard cost', () => {
    const result = unitCost(STANDARD, 60)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe(12060)
  })

  it('returns the standard cost unchanged at 100 percent', () => {
    const result = unitCost(STANDARD, 100)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe(STANDARD)
  })

  it('keeps fractional cents rather than collapsing a rate to whole cents', () => {
    // A 1.594-cent fastener recovered at 50% is worth 0.797 cents, not 1.
    const result = unitCost(1.594, 50)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBeCloseTo(0.797, 5)
  })

  it('rounds once, to a RATE precision', () => {
    const result = unitCost(1, 33.3333)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe(0.333)
  })

  it('refuses a percentage of zero: a worthless part is scrap, which writes nothing', () => {
    const result = unitCost(STANDARD, 0)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.reason).toBe('salvage_percent_out_of_range')
      expect(result.error.statusCode).toBe(422)
    }
  })

  it('refuses a negative percentage', () => {
    const result = unitCost(STANDARD, -20)
    expect(result.isErr()).toBe(true)
  })

  it('refuses a percentage past 100: salvage is never worth more than new', () => {
    const result = unitCost(STANDARD, 101)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.reason).toBe('salvage_percent_out_of_range')
      expect(result.error.message).toContain('Hydraulic cylinder')
    }
  })

  it('refuses a null standard cost, naming the part', () => {
    const result = unitCost(null, 60)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.reason).toBe('missing_standard_cost')
      expect(result.error.message).toContain('Hydraulic cylinder')
      expect(result.error).toBeInstanceOf(MissingStandardCostError)
      if (result.error instanceof MissingStandardCostError) {
        expect(result.error.standardCost).toBeNull()
      }
    }
  })

  it('refuses a standard cost of exactly zero', () => {
    const result = unitCost(0, 60)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.reason).toBe('missing_standard_cost')
      if (result.error instanceof MissingStandardCostError) {
        expect(result.error.standardCost).toBe(0)
      }
    }
  })

  it('refuses an undefined and a negative standard cost', () => {
    expect(unitCost(undefined, 60).isErr()).toBe(true)
    expect(unitCost(-100, 60).isErr()).toBe(true)
  })

  it('refuses the percentage first when both inputs are bad', () => {
    const result = unitCost(null, 0)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.reason).toBe('salvage_percent_out_of_range')
  })

  it('never throws', () => {
    expect(() => unitCost(Number.NaN, Number.NaN)).not.toThrow()
  })
})
