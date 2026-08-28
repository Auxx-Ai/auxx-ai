// packages/lib/src/purchasing/__tests__/match.test.ts

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../errors'
import {
  DEFAULT_MATCH_TOLERANCE,
  describeMatchReason,
  describeMatchReasons,
  matchBill,
  matchBillLine,
  matchVariance,
  priceAllowance,
} from '../match'
import type { MatchLine, MatchTolerance } from '../types'

// Prices are integer minor units (cents): 10_000 = $100.00.

const LOOSE_QUANTITY: MatchTolerance = { ...DEFAULT_MATCH_TOLERANCE, quantityExact: false }

function line(partial: Partial<MatchLine> = {}): MatchLine {
  return {
    quantityBilled: 10,
    quantityReceived: 10,
    unitPriceBilled: 10_000,
    unitPriceExpected: 10_000,
    ...partial,
  }
}

describe('DEFAULT_MATCH_TOLERANCE', () => {
  it('is 2% or $5, whichever is larger, with exact quantities', () => {
    expect(DEFAULT_MATCH_TOLERANCE).toEqual({
      pricePercent: 2,
      priceAbsolute: 500,
      quantityExact: true,
    })
  })
})

describe('priceAllowance', () => {
  it('takes the absolute floor when the percent term is smaller', () => {
    // 2% of $100.00 is $2.00, below the $5.00 floor.
    expect(priceAllowance(10_000, DEFAULT_MATCH_TOLERANCE)).toBe(500)
  })

  it('takes the percent term once it exceeds the floor', () => {
    // 2% of $1,000.00 is $20.00.
    expect(priceAllowance(100_000, DEFAULT_MATCH_TOLERANCE)).toBe(2000)
  })

  it('is exactly the floor at the crossover price', () => {
    expect(priceAllowance(25_000, DEFAULT_MATCH_TOLERANCE)).toBe(500)
    expect(priceAllowance(25_100, DEFAULT_MATCH_TOLERANCE)).toBe(502)
  })

  it('degenerates to the absolute term when the expected price is zero', () => {
    const allowed = priceAllowance(0, DEFAULT_MATCH_TOLERANCE)
    expect(allowed).toBe(500)
    expect(Number.isNaN(allowed)).toBe(false)
  })

  it('gives a credit line the same allowance as a charge line', () => {
    expect(priceAllowance(-100_000, DEFAULT_MATCH_TOLERANCE)).toBe(2000)
  })

  it('keeps fractional allowances rather than rounding them up', () => {
    // 2% of 12345 is 246.9, so an integer difference of 246 passes and 247 fails.
    expect(priceAllowance(12_345, { ...DEFAULT_MATCH_TOLERANCE, priceAbsolute: 0 })).toBeCloseTo(
      246.9,
      10
    )
  })
})

describe('matchBill - the clean cases', () => {
  it('matches an empty bill - there is nothing that can fail', () => {
    expect(matchBill([], DEFAULT_MATCH_TOLERANCE)).toEqual({ outcome: 'matched' })
  })

  it('matches when every line agrees exactly', () => {
    expect(matchBill([line(), line()], DEFAULT_MATCH_TOLERANCE)).toEqual({ outcome: 'matched' })
  })

  it('defaults the tolerance when none is supplied', () => {
    expect(matchBill([line({ unitPriceBilled: 10_500 })])).toEqual({ outcome: 'matched' })
  })

  it('matches a zero-quantity line whose prices agree', () => {
    expect(
      matchBill([line({ quantityBilled: 0, quantityReceived: 0 })], DEFAULT_MATCH_TOLERANCE)
    ).toEqual({ outcome: 'matched' })
  })
})

describe('matchBill - price tolerance boundaries', () => {
  it('passes at exactly the absolute allowance', () => {
    // Expected $100.00, allowance $5.00 (the floor beats 2%).
    expect(matchBill([line({ unitPriceBilled: 10_500, unitPriceExpected: 10_000 })])).toEqual({
      outcome: 'matched',
    })
  })

  it('fails one minor unit outside the absolute allowance', () => {
    const result = matchBill([line({ unitPriceBilled: 10_501, unitPriceExpected: 10_000 })])

    expect(result).toEqual({
      outcome: 'exception',
      reasons: [
        {
          code: 'price_variance',
          lineIndex: 0,
          unitPriceBilled: 10_501,
          unitPriceExpected: 10_000,
          difference: 501,
          allowed: 500,
        },
      ],
      variance: 5010,
    })
  })

  it('passes at exactly the absolute allowance on the cheap side', () => {
    expect(matchBill([line({ unitPriceBilled: 9500, unitPriceExpected: 10_000 })])).toEqual({
      outcome: 'matched',
    })
  })

  it('fails one minor unit under the absolute allowance', () => {
    const result = matchBill([line({ unitPriceBilled: 9499, unitPriceExpected: 10_000 })])

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]).toMatchObject({ code: 'price_variance', difference: -501 })
    expect(result.variance).toBe(-5010)
  })

  it('passes at exactly the percent allowance', () => {
    // Expected $1,000.00, 2% = $20.00, which beats the $5.00 floor.
    expect(matchBill([line({ unitPriceBilled: 102_000, unitPriceExpected: 100_000 })])).toEqual({
      outcome: 'matched',
    })
  })

  it('fails one minor unit outside the percent allowance', () => {
    const result = matchBill([line({ unitPriceBilled: 102_001, unitPriceExpected: 100_000 })])

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]).toMatchObject({
      code: 'price_variance',
      difference: 2001,
      allowed: 2000,
    })
  })

  it('falls back to the absolute term when the expected price is zero', () => {
    // The percent term degenerates to zero here; nothing divides by zero.
    expect(matchBill([line({ unitPriceBilled: 500, unitPriceExpected: 0 })])).toEqual({
      outcome: 'matched',
    })

    const result = matchBill([line({ unitPriceBilled: 501, unitPriceExpected: 0 })])
    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]).toMatchObject({ code: 'price_variance', allowed: 500 })
  })

  it('flags any difference when both tolerance terms are zero', () => {
    const zero: MatchTolerance = { pricePercent: 0, priceAbsolute: 0, quantityExact: true }

    expect(matchBill([line()], zero)).toEqual({ outcome: 'matched' })
    expect(matchBill([line({ unitPriceBilled: 10_001 })], zero).outcome).toBe('exception')
  })
})

describe('matchBill - quantity', () => {
  it('flags paying for what never arrived', () => {
    const result = matchBill([line({ quantityBilled: 10, quantityReceived: 4 })])

    expect(result).toEqual({
      outcome: 'exception',
      reasons: [
        {
          code: 'quantity_over_billed',
          lineIndex: 0,
          quantityBilled: 10,
          quantityReceived: 4,
        },
      ],
      variance: 60_000,
    })
  })

  it('flags over-billing even when the quantity check is loose', () => {
    const result = matchBill([line({ quantityBilled: 10, quantityReceived: 4 })], LOOSE_QUANTITY)

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]?.code).toBe('quantity_over_billed')
  })

  it('flags an under-billed line when quantities must be exact', () => {
    const result = matchBill([line({ quantityBilled: 4, quantityReceived: 10 })])

    expect(result).toEqual({
      outcome: 'exception',
      reasons: [
        {
          code: 'quantity_under_billed',
          lineIndex: 0,
          quantityBilled: 4,
          quantityReceived: 10,
        },
      ],
      variance: -60_000,
    })
  })

  it('allows an under-billed line when the quantity check is loose', () => {
    expect(matchBill([line({ quantityBilled: 4, quantityReceived: 10 })], LOOSE_QUANTITY)).toEqual({
      outcome: 'matched',
    })
  })

  it('flags billing for a line that was received but shows zero billed quantity', () => {
    const result = matchBill([line({ quantityBilled: 0, quantityReceived: 3 })])

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]?.code).toBe('quantity_under_billed')
  })

  it('flags billing for a line that never arrived at all', () => {
    const result = matchBill([line({ quantityBilled: 3, quantityReceived: 0 })])

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]?.code).toBe('quantity_over_billed')
    expect(result.variance).toBe(30_000)
  })

  it('handles fractional quantities', () => {
    expect(matchBill([line({ quantityBilled: 2.5, quantityReceived: 2.5 })])).toEqual({
      outcome: 'matched',
    })
  })
})

describe('matchBill - roll-up across lines', () => {
  it('reports every reason rather than stopping at the first', () => {
    const result = matchBill([
      line({ quantityBilled: 10, quantityReceived: 4, unitPriceBilled: 12_000 }),
      line(),
      line({ unitPriceBilled: 20_000 }),
    ])

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons.map((reason) => [reason.code, reason.lineIndex])).toEqual([
      ['quantity_over_billed', 0],
      ['price_variance', 0],
      ['price_variance', 2],
    ])
  })

  it('names both failures on a line that is wrong in both dimensions', () => {
    const result = matchBill([
      line({ quantityBilled: 12, quantityReceived: 10, unitPriceBilled: 1 }),
    ])

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      'quantity_over_billed',
      'price_variance',
    ])
  })

  it('does not let an over-billed quantity net out against an under-priced line', () => {
    // Billed 12 x $1.00 = $12.00; received 10 at the agreed $100.00 = $1,000.00.
    const result = matchBill([
      line({ quantityBilled: 12, quantityReceived: 10, unitPriceBilled: 100 }),
    ])

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.variance).toBe(1200 - 100_000)
  })
})

describe('matchVariance', () => {
  it('is billed minus what is owed for what actually arrived', () => {
    expect(
      matchVariance([
        line({ quantityBilled: 10, quantityReceived: 10, unitPriceBilled: 10_100 }),
        line({ quantityBilled: 5, quantityReceived: 4 }),
      ])
    ).toBe(1000 + 10_000)
  })

  it('is zero for an empty bill', () => {
    expect(matchVariance([])).toBe(0)
  })

  it('rounds each line product to a whole minor unit', () => {
    expect(
      matchVariance([line({ quantityBilled: 0.5, quantityReceived: 0, unitPriceBilled: 101 })])
    ).toBe(51)
  })
})

describe('matchBillLine - invalid input', () => {
  it('rejects a negative billed quantity', () => {
    expect(() => matchBillLine(line({ quantityBilled: -1 }), DEFAULT_MATCH_TOLERANCE, 0)).toThrow(
      BadRequestError
    )
  })

  it('rejects a negative received quantity', () => {
    expect(() => matchBillLine(line({ quantityReceived: -1 }), DEFAULT_MATCH_TOLERANCE, 0)).toThrow(
      BadRequestError
    )
  })

  it('rejects a non-integer price', () => {
    expect(() =>
      matchBillLine(line({ unitPriceBilled: 10.5 }), DEFAULT_MATCH_TOLERANCE, 0)
    ).toThrow(BadRequestError)
  })

  it('allows a negative price - a credit line on a vendor bill is real', () => {
    expect(
      matchBillLine(
        line({ unitPriceBilled: -10_000, unitPriceExpected: -10_000 }),
        DEFAULT_MATCH_TOLERANCE,
        0
      )
    ).toEqual([])
  })

  it('rejects a negative tolerance term', () => {
    expect(() => matchBill([line()], { ...DEFAULT_MATCH_TOLERANCE, pricePercent: -1 })).toThrow(
      BadRequestError
    )
    expect(() => matchBill([line()], { ...DEFAULT_MATCH_TOLERANCE, priceAbsolute: -1 })).toThrow(
      BadRequestError
    )
  })

  it('carries the line index through from the bill roll-up', () => {
    const result = matchBill([line(), line(), line({ unitPriceBilled: 99_999 })])

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]?.lineIndex).toBe(2)
  })
})

describe('describeMatchReason', () => {
  it('renders money in major units, not the stored minor ones', () => {
    // The whole point: `10000` on the exception queue is a number nobody reads
    // as $100.00.
    const [reason] = matchBillLine(
      line({ unitPriceBilled: 0, unitPriceExpected: 10_000 }),
      DEFAULT_MATCH_TOLERANCE,
      0
    )

    expect(describeMatchReason(reason!)).toBe(
      'Line 1: unit price 0.00 billed against an agreed 100.00 (off by -100.00)'
    )
  })

  it('names the price leg, so a price failure cannot read as a quantity one', () => {
    const [price] = matchBillLine(
      line({ unitPriceBilled: 12_000, unitPriceExpected: 10_000 }),
      DEFAULT_MATCH_TOLERANCE,
      0
    )
    const [quantity] = matchBillLine(
      line({ quantityBilled: 3, quantityReceived: 2 }),
      DEFAULT_MATCH_TOLERANCE,
      0
    )

    expect(describeMatchReason(price!)).toContain('unit price')
    expect(describeMatchReason(quantity!)).not.toContain('unit price')
  })

  it('scales by the currency exponent rather than assuming cents', () => {
    const [reason] = matchBillLine(
      line({ unitPriceBilled: 1000, unitPriceExpected: 2000 }),
      DEFAULT_MATCH_TOLERANCE,
      0
    )

    // JPY has no minor unit — 1000 yen is 1000, not 10.00.
    expect(describeMatchReason(reason!, 'JPY')).toBe(
      'Line 1: unit price 1000 billed against an agreed 2000 (off by -1000)'
    )
  })

  it('carries no currency symbol — the string is stored, the symbol is not', () => {
    const [reason] = matchBillLine(
      line({ unitPriceBilled: 0, unitPriceExpected: 10_000 }),
      DEFAULT_MATCH_TOLERANCE,
      0
    )

    expect(describeMatchReason(reason!, 'EUR')).not.toMatch(/[$€¥£]/)
  })

  it('keeps the quantity wording the exception queue already reads', () => {
    const [over] = matchBillLine(
      line({ quantityBilled: 10, quantityReceived: 4 }),
      DEFAULT_MATCH_TOLERANCE,
      0
    )

    expect(describeMatchReason(over!)).toBe('Line 1: billed 10 but only 4 received')
  })

  it('numbers lines from 1, because the human is holding the paper invoice', () => {
    const result = matchBill([line(), line({ quantityBilled: 3, quantityReceived: 2 })])

    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(describeMatchReason(result.reasons[0]!)).toContain('Line 2:')
  })
})

describe('describeMatchReasons', () => {
  it('joins with the `; ` the Match card splits on', () => {
    const result = matchBill([line({ quantityBilled: 3, quantityReceived: 2, unitPriceBilled: 0 })])

    if (result.outcome !== 'exception') throw new Error('unreachable')
    const notes = describeMatchReasons(result.reasons)

    expect(notes.split('; ')).toHaveLength(2)
    expect(notes.split('; ')).toEqual(result.reasons.map((r) => describeMatchReason(r)))
  })

  it('is the empty string for a clean bill, never a sentence claiming success', () => {
    expect(describeMatchReasons([])).toBe('')
  })

  it('passes the currency through to every reason', () => {
    const result = matchBill([line({ unitPriceBilled: 0, unitPriceExpected: 10_000 })])

    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(describeMatchReasons(result.reasons, 'JPY')).toContain('an agreed 10000')
  })
})
