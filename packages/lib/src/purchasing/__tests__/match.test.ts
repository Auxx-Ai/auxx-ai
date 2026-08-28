// packages/lib/src/purchasing/__tests__/match.test.ts

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../errors'
import {
  DEFAULT_MATCH_TOLERANCE,
  describeAwaitingLine,
  describeAwaitingLines,
  describeMatchReason,
  describeMatchReasons,
  isAwaitingReceipt,
  isReceiptOverdue,
  matchBill,
  matchBillLine,
  matchVariance,
  priceAllowance,
} from '../match'
import type { MatchLine, MatchTolerance } from '../types'

// Prices are integer minor units (cents): 10_000 = $100.00.

const LOOSE_QUANTITY: MatchTolerance = { ...DEFAULT_MATCH_TOLERANCE, quantityExact: false }

/**
 * "Now" is an argument everywhere in `match.ts`, never a clock — so every test
 * pins it. `NOW` and the two dates around it are the whole aging fixture:
 * `EXPECTED` plus the default 7 day grace lands exactly on `NOW`, which makes the
 * boundary case a one-character change rather than an arithmetic puzzle.
 */
const NOW = new Date('2026-08-28T12:00:00.000Z')
/** `NOW` minus exactly the 7 day default grace — the last instant still forgiven. */
const EXPECTED = new Date('2026-08-21T12:00:00.000Z')
/** One millisecond earlier, so the grace has run out by `NOW`. */
const EXPECTED_OVERDUE = new Date('2026-08-21T11:59:59.999Z')

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
  it('is 2% or $5, whichever is larger, exact quantities, and a 7 day receipt grace', () => {
    expect(DEFAULT_MATCH_TOLERANCE).toEqual({
      pricePercent: 2,
      priceAbsolute: 500,
      quantityExact: true,
      receiptGraceDays: 7,
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
    expect(matchBill([], NOW, DEFAULT_MATCH_TOLERANCE)).toEqual({ outcome: 'matched' })
  })

  it('matches when every line agrees exactly', () => {
    expect(matchBill([line(), line()], NOW, DEFAULT_MATCH_TOLERANCE)).toEqual({
      outcome: 'matched',
    })
  })

  it('defaults the tolerance when none is supplied', () => {
    expect(matchBill([line({ unitPriceBilled: 10_500 })], NOW)).toEqual({ outcome: 'matched' })
  })

  it('matches a zero-quantity line whose prices agree', () => {
    expect(
      matchBill([line({ quantityBilled: 0, quantityReceived: 0 })], NOW, DEFAULT_MATCH_TOLERANCE)
    ).toEqual({ outcome: 'matched' })
  })

  it('is unchanged by an expected date on a fully received bill', () => {
    // The aging rule must not touch a line that arrived. An order expected months
    // ago whose goods are all in is still simply `matched`.
    expect(matchBill([line({ expectedAt: EXPECTED_OVERDUE })], NOW)).toEqual({
      outcome: 'matched',
    })
  })
})

describe('matchBill - price tolerance boundaries', () => {
  it('passes at exactly the absolute allowance', () => {
    // Expected $100.00, allowance $5.00 (the floor beats 2%).
    expect(matchBill([line({ unitPriceBilled: 10_500, unitPriceExpected: 10_000 })], NOW)).toEqual({
      outcome: 'matched',
    })
  })

  it('fails one minor unit outside the absolute allowance', () => {
    const result = matchBill([line({ unitPriceBilled: 10_501, unitPriceExpected: 10_000 })], NOW)

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
    expect(matchBill([line({ unitPriceBilled: 9500, unitPriceExpected: 10_000 })], NOW)).toEqual({
      outcome: 'matched',
    })
  })

  it('fails one minor unit under the absolute allowance', () => {
    const result = matchBill([line({ unitPriceBilled: 9499, unitPriceExpected: 10_000 })], NOW)

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]).toMatchObject({ code: 'price_variance', difference: -501 })
    expect(result.variance).toBe(-5010)
  })

  it('passes at exactly the percent allowance', () => {
    // Expected $1,000.00, 2% = $20.00, which beats the $5.00 floor.
    expect(
      matchBill([line({ unitPriceBilled: 102_000, unitPriceExpected: 100_000 })], NOW)
    ).toEqual({ outcome: 'matched' })
  })

  it('fails one minor unit outside the percent allowance', () => {
    const result = matchBill([line({ unitPriceBilled: 102_001, unitPriceExpected: 100_000 })], NOW)

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
    expect(matchBill([line({ unitPriceBilled: 500, unitPriceExpected: 0 })], NOW)).toEqual({
      outcome: 'matched',
    })

    const result = matchBill([line({ unitPriceBilled: 501, unitPriceExpected: 0 })], NOW)
    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]).toMatchObject({ code: 'price_variance', allowed: 500 })
  })

  it('flags any difference when both tolerance terms are zero', () => {
    const zero: MatchTolerance = {
      pricePercent: 0,
      priceAbsolute: 0,
      quantityExact: true,
      receiptGraceDays: 7,
    }

    expect(matchBill([line()], NOW, zero)).toEqual({ outcome: 'matched' })
    expect(matchBill([line({ unitPriceBilled: 10_001 })], NOW, zero).outcome).toBe('exception')
  })
})

describe('matchBill - awaiting receipt (P24)', () => {
  // 🛑 The rule this whole block pins: `billed > received` is NOT an exception.
  // Vendors here often will not ship until the invoice is paid, so it is the
  // normal state of a CORRECT bill for weeks.

  it('calls a wholly unreceived line awaiting, not an exception', () => {
    const result = matchBill([line({ quantityBilled: 10, quantityReceived: 0 })], NOW)

    expect(result).toEqual({
      outcome: 'awaiting_receipt',
      awaiting: [{ lineIndex: 0, quantityBilled: 10, quantityReceived: 0, expectedAt: null }],
      // Price-only, so a prepaid bill does NOT carry its entire value as variance.
      variance: 0,
    })
  })

  it('calls a partly received line awaiting too', () => {
    const result = matchBill([line({ quantityBilled: 10, quantityReceived: 4 })], NOW)

    expect(result.outcome).toBe('awaiting_receipt')
    if (result.outcome !== 'awaiting_receipt') throw new Error('unreachable')
    expect(result.awaiting).toEqual([
      { lineIndex: 0, quantityBilled: 10, quantityReceived: 4, expectedAt: null },
    ])
    expect(result.variance).toBe(0)
  })

  it('is awaiting under the loose quantity mode as well', () => {
    expect(
      matchBill([line({ quantityBilled: 10, quantityReceived: 4 })], NOW, LOOSE_QUANTITY).outcome
    ).toBe('awaiting_receipt')
  })

  it('reports price-only variance while the quantity is unjudgeable', () => {
    // Billed 10 x $101.00 against an agreed $100.00, nothing received. The $1.00
    // drift is inside the $5.00 allowance so this stays awaiting — and the
    // variance is the 10 x $1.00 of price drift, NOT the $1,010.00 the bill is
    // worth, which is what the old formula carried.
    const result = matchBill(
      [line({ quantityBilled: 10, quantityReceived: 0, unitPriceBilled: 10_100 })],
      NOW
    )

    expect(result.outcome).toBe('awaiting_receipt')
    if (result.outcome !== 'awaiting_receipt') throw new Error('unreachable')
    expect(result.variance).toBe(1000)
  })

  it('is an EXCEPTION when an awaiting line is also mispriced', () => {
    // Price is judgeable the moment the invoice arrives; quantity is not. So a
    // price failure outranks awaiting and the bill goes into the queue today.
    const result = matchBill(
      [line({ quantityBilled: 10, quantityReceived: 0, unitPriceBilled: 20_000 })],
      NOW
    )

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons.map((r) => r.code)).toEqual(['price_variance'])
    // Still price-only: 10 x (20_000 - 10_000).
    expect(result.variance).toBe(100_000)
  })

  it('lets one real reason on another line outrank every awaiting line', () => {
    const result = matchBill(
      [
        line({ quantityBilled: 10, quantityReceived: 0 }),
        line({ quantityBilled: 4, quantityReceived: 10 }),
      ],
      NOW
    )

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons.map((r) => r.code)).toEqual(['quantity_under_billed'])
  })

  it('reports every awaiting line, with its index', () => {
    const result = matchBill(
      [line(), line({ quantityBilled: 3, quantityReceived: 1 }), line({ quantityReceived: 2 })],
      NOW
    )

    expect(result.outcome).toBe('awaiting_receipt')
    if (result.outcome !== 'awaiting_receipt') throw new Error('unreachable')
    expect(result.awaiting.map((a) => a.lineIndex)).toEqual([1, 2])
  })

  it('carries the expected date through onto the awaiting line', () => {
    const result = matchBill(
      [line({ quantityBilled: 1, quantityReceived: 0, expectedAt: EXPECTED })],
      NOW
    )

    expect(result.outcome).toBe('awaiting_receipt')
    if (result.outcome !== 'awaiting_receipt') throw new Error('unreachable')
    expect(result.awaiting[0]?.expectedAt).toBe(EXPECTED)
  })
})

describe('matchBill - aging an awaiting line off the purchase order', () => {
  const overdue = () =>
    matchBill(
      [line({ quantityBilled: 10, quantityReceived: 4, expectedAt: EXPECTED_OVERDUE })],
      NOW
    )

  it('becomes a receipt_overdue exception once the grace period runs out', () => {
    const result = overdue()

    expect(result).toEqual({
      outcome: 'exception',
      reasons: [
        {
          code: 'receipt_overdue',
          lineIndex: 0,
          quantityBilled: 10,
          quantityReceived: 4,
          expectedAt: EXPECTED_OVERDUE,
          graceDays: 7,
        },
      ],
      // No longer awaiting, so the full formula is back: 10 x $100.00 billed
      // against 4 x $100.00 received.
      variance: 60_000,
    })
  })

  it('is still awaiting EXACTLY at the grace boundary', () => {
    // `EXPECTED` + 7 days is `NOW` to the millisecond. Strictly past, not on — the
    // same forgiving direction the price allowance takes.
    const result = matchBill(
      [line({ quantityBilled: 10, quantityReceived: 4, expectedAt: EXPECTED })],
      NOW
    )

    expect(result.outcome).toBe('awaiting_receipt')
  })

  it('is overdue one millisecond past the boundary', () => {
    expect(overdue().outcome).toBe('exception')
  })

  it('honours a shorter grace period', () => {
    const impatient: MatchTolerance = { ...DEFAULT_MATCH_TOLERANCE, receiptGraceDays: 0 }
    const result = matchBill(
      [line({ quantityBilled: 1, quantityReceived: 0, expectedAt: EXPECTED })],
      NOW,
      impatient
    )

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]).toMatchObject({ code: 'receipt_overdue', graceDays: 0 })
  })

  it('stays awaiting FOREVER when the order carries no expected date', () => {
    // ⚠️ The deliberate direction (P24): a line nobody agreed a date for cannot be
    // judged late, and falling back to `exception` would put every bill on a
    // dateless order into the queue permanently — the exact false-positive flood
    // this change removes. `purchase_order_expected_at` is nullable with nothing
    // prefilling it, so that fallback would be the common case, not the edge one.
    const farFuture = new Date('2099-01-01T00:00:00.000Z')
    const result = matchBill(
      [line({ quantityBilled: 10, quantityReceived: 0, expectedAt: null })],
      farFuture
    )

    expect(result.outcome).toBe('awaiting_receipt')
    expect(matchBill([line({ quantityBilled: 10, quantityReceived: 0 })], farFuture).outcome).toBe(
      'awaiting_receipt'
    )
  })

  it('treats an unparseable expected date as no date at all', () => {
    const result = matchBill(
      [line({ quantityBilled: 1, quantityReceived: 0, expectedAt: new Date('not a date') })],
      NOW
    )

    expect(result.outcome).toBe('awaiting_receipt')
  })

  it('never ages a line that was fully received', () => {
    expect(
      isReceiptOverdue(line({ expectedAt: EXPECTED_OVERDUE }), DEFAULT_MATCH_TOLERANCE, NOW)
    ).toBe(false)
    expect(
      isAwaitingReceipt(line({ expectedAt: EXPECTED_OVERDUE }), DEFAULT_MATCH_TOLERANCE, NOW)
    ).toBe(false)
  })

  it('is awaiting and overdue as mutually exclusive states', () => {
    const early = line({ quantityBilled: 1, quantityReceived: 0, expectedAt: EXPECTED })
    const late = line({ quantityBilled: 1, quantityReceived: 0, expectedAt: EXPECTED_OVERDUE })

    expect([
      isAwaitingReceipt(early, DEFAULT_MATCH_TOLERANCE, NOW),
      isReceiptOverdue(early, DEFAULT_MATCH_TOLERANCE, NOW),
    ]).toEqual([true, false])
    expect([
      isAwaitingReceipt(late, DEFAULT_MATCH_TOLERANCE, NOW),
      isReceiptOverdue(late, DEFAULT_MATCH_TOLERANCE, NOW),
    ]).toEqual([false, true])
  })
})

describe('matchBill - quantity', () => {
  it('flags an under-billed line when quantities must be exact', () => {
    const result = matchBill([line({ quantityBilled: 4, quantityReceived: 10 })], NOW)

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
    expect(
      matchBill([line({ quantityBilled: 4, quantityReceived: 10 })], NOW, LOOSE_QUANTITY)
    ).toEqual({ outcome: 'matched' })
  })

  it('flags billing for a line that was received but shows zero billed quantity', () => {
    const result = matchBill([line({ quantityBilled: 0, quantityReceived: 3 })], NOW)

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons[0]?.code).toBe('quantity_under_billed')
  })

  it('handles fractional quantities', () => {
    expect(matchBill([line({ quantityBilled: 2.5, quantityReceived: 2.5 })], NOW)).toEqual({
      outcome: 'matched',
    })
  })
})

describe('matchBill - roll-up across lines', () => {
  it('reports every reason rather than stopping at the first', () => {
    const result = matchBill(
      [
        line({
          quantityBilled: 10,
          quantityReceived: 4,
          unitPriceBilled: 12_000,
          expectedAt: EXPECTED_OVERDUE,
        }),
        line(),
        line({ unitPriceBilled: 20_000 }),
      ],
      NOW
    )

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons.map((reason) => [reason.code, reason.lineIndex])).toEqual([
      ['receipt_overdue', 0],
      ['price_variance', 0],
      ['price_variance', 2],
    ])
  })

  it('names both failures on a line that is wrong in both dimensions', () => {
    const result = matchBill(
      [
        line({
          quantityBilled: 12,
          quantityReceived: 10,
          unitPriceBilled: 1,
          expectedAt: EXPECTED_OVERDUE,
        }),
      ],
      NOW
    )

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      'receipt_overdue',
      'price_variance',
    ])
  })

  it('does not let an OVERDUE quantity net out against an under-priced line', () => {
    // The original argument for `quantityReceived` on the expected side, which is
    // untouched for every line that is not awaiting: billed 12 x $1.00 = $12.00,
    // received 10 at the agreed $100.00 = $1,000.00.
    const result = matchBill(
      [
        line({
          quantityBilled: 12,
          quantityReceived: 10,
          unitPriceBilled: 100,
          expectedAt: EXPECTED_OVERDUE,
        }),
      ],
      NOW
    )

    expect(result.outcome).toBe('exception')
    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(result.variance).toBe(1200 - 100_000)
  })
})

describe('matchVariance', () => {
  it('is billed minus what is owed for what actually arrived', () => {
    expect(
      matchVariance(
        [
          line({ quantityBilled: 10, quantityReceived: 10, unitPriceBilled: 10_100 }),
          // Awaiting (5 billed, 4 received, no date), so price-only — and the prices
          // agree, so it contributes nothing.
          line({ quantityBilled: 5, quantityReceived: 4 }),
        ],
        NOW
      )
    ).toBe(1000)
  })

  it('keeps the received-side formula for a line that is not awaiting', () => {
    expect(matchVariance([line({ quantityBilled: 4, quantityReceived: 10 })], NOW)).toBe(
      4 * 10_000 - 10 * 10_000
    )
  })

  it('is zero for an empty bill', () => {
    expect(matchVariance([], NOW)).toBe(0)
  })

  it('rounds each line product to a whole minor unit', () => {
    // Awaiting (0.5 billed, 0 received), so expected uses the BILLED quantity:
    // round(0.5 x 101) - round(0.5 x 10_000).
    expect(
      matchVariance([line({ quantityBilled: 0.5, quantityReceived: 0, unitPriceBilled: 101 })], NOW)
    ).toBe(51 - 5000)
  })

  it('drops an awaiting line to zero when only its quantity is outstanding', () => {
    expect(matchVariance([line({ quantityBilled: 10, quantityReceived: 0 })], NOW)).toBe(0)
  })

  it('goes back to the full formula once the line is overdue', () => {
    expect(
      matchVariance(
        [line({ quantityBilled: 10, quantityReceived: 0, expectedAt: EXPECTED_OVERDUE })],
        NOW
      )
    ).toBe(100_000)
  })
})

describe('matchBillLine - invalid input', () => {
  it('rejects a negative billed quantity', () => {
    expect(() =>
      matchBillLine(line({ quantityBilled: -1 }), DEFAULT_MATCH_TOLERANCE, 0, NOW)
    ).toThrow(BadRequestError)
  })

  it('rejects a negative received quantity', () => {
    expect(() =>
      matchBillLine(line({ quantityReceived: -1 }), DEFAULT_MATCH_TOLERANCE, 0, NOW)
    ).toThrow(BadRequestError)
  })

  it('rejects a non-integer price', () => {
    expect(() =>
      matchBillLine(line({ unitPriceBilled: 10.5 }), DEFAULT_MATCH_TOLERANCE, 0, NOW)
    ).toThrow(BadRequestError)
  })

  it('allows a negative price - a credit line on a vendor bill is real', () => {
    expect(
      matchBillLine(
        line({ unitPriceBilled: -10_000, unitPriceExpected: -10_000 }),
        DEFAULT_MATCH_TOLERANCE,
        0,
        NOW
      )
    ).toEqual([])
  })

  it('rejects a negative tolerance term', () => {
    expect(() =>
      matchBill([line()], NOW, { ...DEFAULT_MATCH_TOLERANCE, pricePercent: -1 })
    ).toThrow(BadRequestError)
    expect(() =>
      matchBill([line()], NOW, { ...DEFAULT_MATCH_TOLERANCE, priceAbsolute: -1 })
    ).toThrow(BadRequestError)
    expect(() =>
      matchBill([line()], NOW, { ...DEFAULT_MATCH_TOLERANCE, receiptGraceDays: -1 })
    ).toThrow(BadRequestError)
  })

  it('carries the line index through from the bill roll-up', () => {
    const result = matchBill([line(), line(), line({ unitPriceBilled: 99_999 })], NOW)

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
      0,
      NOW
    )

    expect(describeMatchReason(reason!)).toBe(
      'Line 1: unit price 0.00 billed against an agreed 100.00 (off by -100.00)'
    )
  })

  it('names the price leg, so a price failure cannot read as a quantity one', () => {
    const [price] = matchBillLine(
      line({ unitPriceBilled: 12_000, unitPriceExpected: 10_000 }),
      DEFAULT_MATCH_TOLERANCE,
      0,
      NOW
    )
    const [quantity] = matchBillLine(
      line({ quantityBilled: 2, quantityReceived: 3 }),
      DEFAULT_MATCH_TOLERANCE,
      0,
      NOW
    )

    expect(describeMatchReason(price!)).toContain('unit price')
    expect(describeMatchReason(quantity!)).not.toContain('unit price')
  })

  it('scales by the currency exponent rather than assuming cents', () => {
    const [reason] = matchBillLine(
      line({ unitPriceBilled: 1000, unitPriceExpected: 2000 }),
      DEFAULT_MATCH_TOLERANCE,
      0,
      NOW
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
      0,
      NOW
    )

    expect(describeMatchReason(reason!, 'EUR')).not.toMatch(/[$€¥£]/)
  })

  it('names the deadline and the grace an overdue receipt outlived', () => {
    const [reason] = matchBillLine(
      line({ quantityBilled: 10, quantityReceived: 4, expectedAt: EXPECTED_OVERDUE }),
      DEFAULT_MATCH_TOLERANCE,
      0,
      NOW
    )

    expect(describeMatchReason(reason!)).toBe(
      'Line 1: billed 10 but only 4 received, more than 7 days past the expected 2026-08-21'
    )
  })

  it('renders the date as an ISO day, with no locale and no symbol', () => {
    const [reason] = matchBillLine(
      line({ quantityBilled: 1, quantityReceived: 0, expectedAt: EXPECTED_OVERDUE }),
      DEFAULT_MATCH_TOLERANCE,
      0,
      NOW
    )

    expect(describeMatchReason(reason!, 'EUR')).toMatch(/\d{4}-\d{2}-\d{2}$/)
  })

  it('numbers lines from 1, because the human is holding the paper invoice', () => {
    const result = matchBill([line(), line({ quantityBilled: 2, quantityReceived: 3 })], NOW)

    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(describeMatchReason(result.reasons[0]!)).toContain('Line 2:')
  })
})

describe('describeMatchReasons', () => {
  it('joins with the `; ` the Match card splits on', () => {
    const result = matchBill(
      [
        line({
          quantityBilled: 3,
          quantityReceived: 2,
          unitPriceBilled: 0,
          expectedAt: EXPECTED_OVERDUE,
        }),
      ],
      NOW
    )

    if (result.outcome !== 'exception') throw new Error('unreachable')
    const notes = describeMatchReasons(result.reasons)

    expect(notes.split('; ')).toHaveLength(2)
    expect(notes.split('; ')).toEqual(result.reasons.map((r) => describeMatchReason(r)))
  })

  it('is the empty string for a clean bill, never a sentence claiming success', () => {
    expect(describeMatchReasons([])).toBe('')
  })

  it('passes the currency through to every reason', () => {
    const result = matchBill([line({ unitPriceBilled: 0, unitPriceExpected: 10_000 })], NOW)

    if (result.outcome !== 'exception') throw new Error('unreachable')
    expect(describeMatchReasons(result.reasons, 'JPY')).toContain('an agreed 10000')
  })
})

describe('describeAwaitingLine', () => {
  it('says what is outstanding and when it was promised', () => {
    expect(
      describeAwaitingLine({
        lineIndex: 0,
        quantityBilled: 10,
        quantityReceived: 4,
        expectedAt: EXPECTED,
      })
    ).toBe('Line 1: awaiting receipt of 6 of 10 billed (expected 2026-08-21)')
  })

  it('says so when nothing will ever age the line', () => {
    expect(
      describeAwaitingLine({
        lineIndex: 2,
        quantityBilled: 1,
        quantityReceived: 0,
        expectedAt: null,
      })
    ).toBe('Line 3: awaiting receipt of 1 of 1 billed (no expected date on the order)')
  })

  it('carries no money — an awaiting quantity is exactly what is not judgeable', () => {
    const prose = describeAwaitingLine({
      lineIndex: 0,
      quantityBilled: 10,
      quantityReceived: 0,
      expectedAt: EXPECTED,
    })

    expect(prose).not.toMatch(/[$€¥£]/)
    expect(prose).not.toContain('.00')
  })

  it('joins with the same `; ` the reasons use, and is empty for none', () => {
    const result = matchBill(
      [line({ quantityReceived: 2 }), line({ quantityBilled: 3, quantityReceived: 0 })],
      NOW
    )

    if (result.outcome !== 'awaiting_receipt') throw new Error('unreachable')
    expect(describeAwaitingLines(result.awaiting).split('; ')).toHaveLength(2)
    expect(describeAwaitingLines([])).toBe('')
  })
})
